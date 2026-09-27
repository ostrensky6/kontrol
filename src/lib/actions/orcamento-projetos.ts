"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { calcularTodas } from "@/lib/costing/loader";
import { precoCatalogoMascarado } from "@/lib/cadastros/salario";
import { registrarEvento } from "./eventos";
import {
  calcularQuantidadeViagem,
  classificarDespesaViagem,
  normalizarViagemInputs,
  type ViagemInputs,
} from "@/lib/project-budget/travel";
import { ratesDoOrcamentoProjeto } from "@/lib/orcamento/parametros-proposta";
import { validarParametrosProjetoGrossUp } from "@/lib/project-budget/orcamento-projeto";
import { linhasViagemFaltantes, normalizarMeses } from "@/lib/project-budget/editor";
import { registrarVersaoParametrosEconomicos } from "@/lib/orcamento/parametros-versionamento";
import { exigirPapelOrcamento } from "@/lib/orcamento/governanca";
import { recusaSemPermissao } from "@/lib/orcamento/permissao-acao";
import { moduloBloqueadoParaEdicao } from "@/lib/orcamento/ciclo-vida-modulo";
import { falha, mensagemDoBanco, sucesso, type EstadoAcao } from "@/lib/erros";

const pathDemandas = "/orcamento/demandas";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type ProjetoCarregado = {
  status?: string | null;
  demanda_id?: number | null;
  project_months?: number | null;
  travel_inputs?: unknown;
};

const RUBRICAS_VALIDAS = new Set(["PE", "MC", "MP", "ST", "VD", "OU"]);

/** Endereço da etapa da proposta que hospeda o orçamento de projeto. */
function caminhoEtapa(demandaId: number | null | undefined, etapa = "projeto") {
  return demandaId ? `${pathDemandas}/${demandaId}?etapa=${etapa}` : pathDemandas;
}

function comParametro(url: string, chave: string, valor: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${chave}=${encodeURIComponent(valor)}`;
}

/** O editor de custos vive em /orcamento/demandas/[id]?etapa=projeto (o endereço antigo só redireciona). */
function revalidarEtapaProjeto(demandaId: number | null | undefined) {
  if (demandaId) revalidatePath(`${pathDemandas}/${demandaId}`);
  revalidatePath(pathDemandas);
}

async function carregarProjeto(supabase: Supabase, orcamentoProjetoId: number) {
  const { data } = await supabase
    .from("orcamento_projetos")
    .select("status, demanda_id, project_months")
    .eq("id", orcamentoProjetoId)
    .single();
  return (data ?? null) as ProjetoCarregado | null;
}

/** Demanda do projeto: a do banco prevalece; o campo do formulário é só reserva. */
function demandaDe(projeto: ProjetoCarregado | null, formData: FormData) {
  if (projeto?.demanda_id) return Number(projeto.demanda_id);
  const valor = Number(formData.get("demanda_id"));
  return Number.isInteger(valor) && valor > 0 ? valor : null;
}

// Validação defensiva de servidor: impede edição direta de orçamento de projeto
// revisado/enviado/aprovado/cancelado (Fase 5). Não confiar só no botão da UI.
// Devolve o projeto carregado (status, demanda, meses) para evitar outra consulta.
async function assegurarProjetoEditavel(supabase: Supabase, orcamentoProjetoId: number) {
  const projeto = await carregarProjeto(supabase, orcamentoProjetoId);
  const bloqueio = moduloBloqueadoParaEdicao({ status: projeto?.status });
  if (bloqueio.bloqueado) {
    throw new Error(bloqueio.motivo ?? "Edição bloqueada.");
  }
  return projeto;
}

function texto(formData: FormData, chave: string) {
  const valor = String(formData.get(chave) ?? "").trim();
  return valor || null;
}

function numero(formData: FormData, chave: string, fallback = 0) {
  const valor = Number(formData.get(chave));
  return Number.isFinite(valor) ? valor : fallback;
}

function inteiroArray(formData: FormData, chave: string) {
  return formData
    .getAll(chave)
    .map((valor) => Number(valor))
    .filter((valor) => Number.isInteger(valor) && valor > 0);
}

function categoriaPorRubrica(rubrica: string) {
  switch (rubrica) {
    case "PE":
      return "mao_obra";
    case "MC":
      return "materiais";
    case "MP":
      return "equipamentos";
    case "ST":
      return "terceiros";
    case "VD":
      return "deslocamento";
    default:
      return "outros";
  }
}

function etapaPorRubrica(rubrica: string) {
  switch (rubrica) {
    case "PE":
      return "Equipe";
    case "VD":
      return "Campo e logistica";
    case "MC":
      return "Materiais e consumo";
    case "MP":
      return "Equipamentos";
    case "ST":
      return "Terceiros";
    default:
      return "Projeto";
  }
}

function categoriaInstitucionalPorRubrica(rubrica: string) {
  switch (rubrica) {
    case "PE":
      return "Pessoal";
    case "MC":
      return "Material de consumo";
    case "MP":
      return "Material permanente";
    case "ST":
      return "Servicos de terceiros";
    case "VD":
      return "Viagens e diarias";
    default:
      return "Outros custos";
  }
}

async function carregarCliente(clienteId: number | null) {
  if (!clienteId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("clientes")
    .select("nome, cnpj, contato, email, telefone")
    .eq("id", clienteId)
    .single();
  return data;
}

export async function criarOrcamentoProjeto(formData: FormData) {
  await exigirPapelOrcamento("preencher_custos");
  const demandaId = formData.get("demanda_id") ? Number(formData.get("demanda_id")) : null;
  if (!demandaId) {
    redirect("/orcamento/demandas");
  }

  const supabase = await createClient();
  const projetoId = formData.get("projeto_id") ? Number(formData.get("projeto_id")) : null;
  const titulo = texto(formData, "titulo") || "Novo custo de projeto";

  let projeto: { nome: string; cliente_id: number | null } | null = null;
  if (projetoId) {
    const { data } = await supabase
      .from("projetos")
      .select("nome, cliente_id")
      .eq("id", projetoId)
      .single();
    projeto = data;
  }

  const clienteId = projeto?.cliente_id ?? null;
  const cliente = await carregarCliente(clienteId);

  const { error } = await supabase
    .from("orcamento_projetos")
    .insert({
      demanda_id: demandaId,
      projeto_id: projetoId,
      cliente_id: clienteId,
      titulo: titulo === "Novo custo de projeto" && projeto?.nome ? projeto.nome : titulo,
      cliente_nome: cliente?.nome ?? null,
      cliente_cnpj: cliente?.cnpj ?? null,
      cliente_contato: cliente?.contato || cliente?.email || cliente?.telefone || null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  revalidarEtapaProjeto(demandaId);
  redirect(caminhoEtapa(demandaId));
}

export async function salvarOrcamentoProjeto(formData: FormData) {
  await exigirPapelOrcamento("preencher_custos");
  const id = numero(formData, "orcamento_projeto_id");
  if (!id) return;

  const supabase = await createClient();
  const projetoId = formData.get("projeto_id") ? Number(formData.get("projeto_id")) : null;
  const clienteId = formData.get("cliente_id") ? Number(formData.get("cliente_id")) : null;
  const cliente = await carregarCliente(clienteId);
  const { data: anterior } = await supabase
    .from("orcamento_projetos")
    .select("status, demanda_id")
    .eq("id", id)
    .single();

  const novoStatus = texto(formData, "status") || "rascunho";
  const patch = {
    projeto_id: projetoId,
    cliente_id: clienteId,
    titulo: texto(formData, "titulo") || "Custos de projeto",
    cliente_nome: cliente?.nome ?? texto(formData, "cliente_nome"),
    cliente_cnpj: cliente?.cnpj ?? texto(formData, "cliente_cnpj"),
    cliente_contato: cliente?.contato || cliente?.email || cliente?.telefone || texto(formData, "cliente_contato"),
    data_orcamento: texto(formData, "data_orcamento") ?? undefined,
    validade_dias: numero(formData, "validade_dias", 30),
    responsavel: texto(formData, "responsavel"),
    escopo: texto(formData, "escopo"),
    cronograma: texto(formData, "cronograma"),
    observacoes: texto(formData, "observacoes"),
    numero: texto(formData, "numero"),
    cliente_email: texto(formData, "cliente_email"),
    cliente_telefone: texto(formData, "cliente_telefone"),
    cliente_endereco: texto(formData, "cliente_endereco"),
    cliente_detalhes: texto(formData, "cliente_detalhes"),
    coordenador: texto(formData, "coordenador"),
    proprietario: texto(formData, "proprietario"),
    projeto_sem_custo_justificativa: texto(formData, "projeto_sem_custo_justificativa"),
  };

  if (anterior && anterior.status !== novoStatus && ["enviado", "aprovado", "cancelado"].includes(novoStatus)) {
    await exigirPapelOrcamento("revisar_modulo");
  }

  const { error } = await supabase.from("orcamento_projetos").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  if (anterior && anterior.status !== novoStatus) {
    const { error: transicaoError } = await supabase.rpc("transicionar_orcamento_projeto", {
      p_orcamento_projeto_id: id,
      p_status_destino: novoStatus,
      p_observacao: "Status alterado durante a atualização do orçamento de projeto.",
    });
    if (transicaoError) throw new Error(transicaoError.message);
  }
  revalidarEtapaProjeto(demandaDe(anterior, formData));
}

export async function salvarParametrosEconomicosProjeto(formData: FormData) {
  await exigirPapelOrcamento("editar_parametros");
  const id = numero(formData, "orcamento_projeto_id");
  if (!id) return;

  const patch = {
    margem_lucro: numero(formData, "margem_lucro"),
    impostos: numero(formData, "impostos"),
    project_months: numero(formData, "project_months", 12),
    impostos_legacy: numero(formData, "impostos_legacy"),
    incubacao: numero(formData, "incubacao"),
    reserva: numero(formData, "reserva"),
    investimentos: numero(formData, "investimentos"),
    lucro: numero(formData, "lucro"),
  };

  const validacao = validarParametrosProjetoGrossUp(patch);
  if (!validacao.ok) {
    redirect(comParametro(caminhoEtapa(demandaDe(null, formData), "parametros"), "erro_parametros", validacao.message));
  }
  const supabase = await createClient();
  const projeto = await assegurarProjetoEditavel(supabase, id);
  const { error } = await supabase.from("orcamento_projetos").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  await registrarVersaoParametrosEconomicos(supabase, {
    escopo: "projeto",
    orcamentoProjetoId: id,
    parametros: patch,
    origem: "orcamento/projetos",
  });
  await registrarEvento(
    "orcamento_parametros",
    id,
    "projeto",
    "alterado",
    "Parâmetros econômicos do orçamento de projeto atualizados com nova versão.",
  );
  revalidarEtapaProjeto(demandaDe(projeto, formData));
}

async function adicionarAnaliseProjetoInterno(formData: FormData) {
  await exigirPapelOrcamento("preencher_custos");
  const id = numero(formData, "orcamento_projeto_id");
  const codigo = texto(formData, "codigo_analise");
  const nAmostras = numero(formData, "n_amostras", 1);
  if (!id || !codigo || nAmostras <= 0) return;

  const supabase = await createClient();
  const { data: analise } = await supabase
    .from("analises")
    .select("ativo, ofertavel")
    .eq("codigo", codigo)
    .single();
  if (!analise?.ativo || !analise?.ofertavel) {
    throw new Error("Análise inativa ou fora da oferta; não pode entrar em novos orçamentos.");
  }
  const { breakdowns } = await calcularTodas();
  const breakdown = breakdowns.find((x) => x.codigo === codigo);
  const projeto = await assegurarProjetoEditavel(supabase, id);
  const { error } = await supabase.from("orcamento_projeto_analises").insert({
    orcamento_projeto_id: id,
    codigo_analise: codigo,
    n_amostras: nAmostras,
    custo_unitario: breakdown?.custoTotal ?? 0,
    preco_unitario: breakdown?.preco ?? 0,
  });
  if (error) throw new Error(error.message);
  revalidarEtapaProjeto(demandaDe(projeto, formData));
}

async function adicionarCustoProjetoInterno(formData: FormData) {
  await exigirPapelOrcamento("preencher_custos");
  const id = numero(formData, "orcamento_projeto_id");
  const descricao = texto(formData, "descricao");
  if (!id || !descricao) return;

  const quantidade = numero(formData, "quantidade", 1);
  const custoUnitario = numero(formData, "custo_unitario");
  const rubrica = texto(formData, "rubrica") || "OU";
  const categoria = texto(formData, "categoria") || categoriaPorRubrica(rubrica);

  if (!RUBRICAS_VALIDAS.has(rubrica)) throw new Error("Rubrica inválida.");
  if (!(quantidade > 0)) throw new Error("A quantidade precisa ser maior que zero.");
  if (custoUnitario < 0) throw new Error("O custo unitário não pode ser negativo.");

  const supabase = await createClient();
  const projeto = await assegurarProjetoEditavel(supabase, id);
  const { error } = await supabase.from("orcamento_projeto_custos").insert({
    orcamento_projeto_id: id,
    categoria,
    rubrica,
    descricao,
    quantidade,
    unidade: texto(formData, "unidade"),
    custo_unitario: custoUnitario,
    preco_unitario: custoUnitario,
    meses_selecionados: normalizarMeses(inteiroArray(formData, "meses_selecionados"), Number(projeto?.project_months ?? 12)),
    origem: "manual",
    etapa: texto(formData, "etapa") || etapaPorRubrica(rubrica),
    atividade: texto(formData, "atividade") || categoria,
    entrega: texto(formData, "entrega") || "Entrega principal",
    categoria_institucional: texto(formData, "categoria_institucional") || categoriaInstitucionalPorRubrica(rubrica),
    nomenclatura_origem: "kontrol",
  });
  if (error) throw new Error(error.message);
  revalidarEtapaProjeto(demandaDe(projeto, formData));
}

/**
 * Edita uma linha de custo existente (descrição, unidade, quantidade, custo e classificação).
 * Rubrica, origem e vínculo com o catálogo não mudam: para trocar de rubrica, remova e adicione.
 */
async function atualizarCustoProjetoInterno(formData: FormData) {
  await exigirPapelOrcamento("preencher_custos");
  const id = numero(formData, "orcamento_projeto_id");
  const itemId = numero(formData, "item_id");
  const descricao = texto(formData, "descricao");
  if (!id || !itemId || !descricao) return;

  const quantidade = numero(formData, "quantidade", NaN);
  const custoUnitario = numero(formData, "custo_unitario", NaN);
  if (!(quantidade > 0)) throw new Error("A quantidade precisa ser maior que zero.");
  if (!(custoUnitario >= 0)) throw new Error("O custo unitário não pode ser negativo.");

  const supabase = await createClient();
  const projeto = await assegurarProjetoEditavel(supabase, id);
  const { error } = await supabase
    .from("orcamento_projeto_custos")
    .update({
      descricao,
      unidade: texto(formData, "unidade"),
      quantidade,
      custo_unitario: custoUnitario,
      preco_unitario: custoUnitario,
      etapa: texto(formData, "etapa"),
      atividade: texto(formData, "atividade"),
      entrega: texto(formData, "entrega"),
    })
    .eq("id", itemId)
    .eq("orcamento_projeto_id", id);
  if (error) throw new Error(error.message);
  revalidarEtapaProjeto(demandaDe(projeto, formData));
}

/**
 * Grava a grade de meses do Pessoal (PE). Cada linha envia `meses_<id>` com os meses marcados.
 * O total da linha passa a ser meses × valor mensal; com meses marcados, a quantidade acompanha
 * a contagem (como no app antigo). Sem meses, a quantidade anterior é mantida (a coluna exige > 0).
 */
async function salvarMesesPessoalProjetoInterno(formData: FormData) {
  await exigirPapelOrcamento("preencher_custos");
  const id = numero(formData, "orcamento_projeto_id");
  if (!id) return;

  const supabase = await createClient();
  const projeto = await assegurarProjetoEditavel(supabase, id);
  const mesesProjeto = Number(projeto?.project_months ?? 12);
  const { data: itens, error: itensError } = await supabase
    .from("orcamento_projeto_custos")
    .select("id, quantidade, meses_selecionados")
    .eq("orcamento_projeto_id", id)
    .eq("rubrica", "PE");
  if (itensError) throw new Error(itensError.message);

  for (const item of (itens ?? []) as Array<{ id: number; quantidade: number; meses_selecionados: number[] | null }>) {
    if (!formData.has(`linha_${item.id}`)) continue;
    const meses = normalizarMeses(formData.getAll(`meses_${item.id}`), mesesProjeto);
    const atuais = normalizarMeses(item.meses_selecionados ?? [], mesesProjeto);
    if (meses.join(",") === atuais.join(",")) continue;
    const { error } = await supabase
      .from("orcamento_projeto_custos")
      .update({
        meses_selecionados: meses,
        quantidade: meses.length > 0 ? meses.length : Number(item.quantidade) || 1,
      })
      .eq("id", item.id)
      .eq("orcamento_projeto_id", id);
    if (error) throw new Error(error.message);
  }
  revalidarEtapaProjeto(demandaDe(projeto, formData));
}

/**
 * Altera a duração do projeto (1 a 60 meses, como no app antigo). Meses do pessoal que
 * ficarem fora do novo prazo são retirados das linhas PE para o total não contar mês inexistente.
 */
async function salvarDuracaoProjetoInterno(formData: FormData) {
  await exigirPapelOrcamento("preencher_custos");
  const id = numero(formData, "orcamento_projeto_id");
  if (!id) return;
  const meses = numero(formData, "project_months", NaN);
  if (!Number.isInteger(meses) || meses < 1 || meses > 60) {
    throw new Error("A duração do projeto deve ser um número inteiro de 1 a 60 meses.");
  }

  const supabase = await createClient();
  const projeto = await assegurarProjetoEditavel(supabase, id);
  const { error } = await supabase.from("orcamento_projetos").update({ project_months: meses }).eq("id", id);
  if (error) throw new Error(error.message);

  const { data: itens, error: itensError } = await supabase
    .from("orcamento_projeto_custos")
    .select("id, quantidade, meses_selecionados")
    .eq("orcamento_projeto_id", id)
    .eq("rubrica", "PE");
  if (itensError) throw new Error(itensError.message);
  for (const item of (itens ?? []) as Array<{ id: number; quantidade: number; meses_selecionados: number[] | null }>) {
    const atuais = item.meses_selecionados ?? [];
    const dentro = normalizarMeses(atuais, meses);
    if (dentro.length === atuais.length) continue;
    const { error: itemError } = await supabase
      .from("orcamento_projeto_custos")
      .update({ meses_selecionados: dentro, quantidade: dentro.length > 0 ? dentro.length : Number(item.quantidade) || 1 })
      .eq("id", item.id)
      .eq("orcamento_projeto_id", id);
    if (itemError) throw new Error(itemError.message);
  }
  revalidarEtapaProjeto(demandaDe(projeto, formData));
}

/**
 * Conclui a revisão dos custos de projeto (rascunho → enviado pelo RPC transacional).
 * É o que marca o módulo como "revisado" e libera parâmetros e emissão da proposta.
 */
async function concluirRevisaoCustosProjetoInterno(formData: FormData) {
  await exigirPapelOrcamento("revisar_modulo");
  const id = numero(formData, "orcamento_projeto_id");
  if (!id) return;

  const supabase = await createClient();
  const { data: projeto } = await supabase
    .from("orcamento_projetos")
    .select("status, demanda_id, projeto_sem_custo_justificativa, orcamento_projeto_custos(id), orcamento_projeto_analises(id)")
    .eq("id", id)
    .single();
  const atual = projeto as (ProjetoCarregado & {
    projeto_sem_custo_justificativa?: string | null;
    orcamento_projeto_custos?: unknown[] | null;
    orcamento_projeto_analises?: unknown[] | null;
  }) | null;
  if (!atual) throw new Error("Orçamento de projeto não encontrado.");
  if (atual.status !== "rascunho") {
    throw new Error("Só é possível concluir a revisão de custos que estão em edição.");
  }
  const itens = (atual.orcamento_projeto_custos?.length ?? 0) + (atual.orcamento_projeto_analises?.length ?? 0);
  if (itens === 0 && !atual.projeto_sem_custo_justificativa) {
    throw new Error("Adicione ao menos um custo ou análise antes de concluir a revisão.");
  }

  const { error } = await supabase.rpc("transicionar_orcamento_projeto", {
    p_orcamento_projeto_id: id,
    p_status_destino: "enviado",
    p_observacao: texto(formData, "observacao") ?? "Revisão dos custos de projeto concluída.",
  });
  if (error) throw new Error(error.message);
  revalidarEtapaProjeto(demandaDe(atual, formData));
}

/** Reabre custos recusados para edição (recusado → rascunho). "Enviado" não volta a rascunho no RPC. */
async function reabrirCustosProjetoInterno(formData: FormData) {
  await exigirPapelOrcamento("revisar_modulo");
  const id = numero(formData, "orcamento_projeto_id");
  if (!id) return;

  const supabase = await createClient();
  const projeto = await carregarProjeto(supabase, id);
  if (projeto?.status !== "recusado") {
    throw new Error("Só custos recusados podem ser reabertos para edição.");
  }
  const { error } = await supabase.rpc("transicionar_orcamento_projeto", {
    p_orcamento_projeto_id: id,
    p_status_destino: "rascunho",
    p_observacao: "Custos de projeto reabertos para edição.",
  });
  if (error) throw new Error(error.message);
  revalidarEtapaProjeto(demandaDe(projeto, formData));
}

async function adicionarCustoCatalogoProjetoInterno(formData: FormData) {
  await exigirPapelOrcamento("preencher_custos");
  const id = numero(formData, "orcamento_projeto_id");
  const catalogoId = texto(formData, "catalogo_item_id");
  if (!id || !catalogoId) return;

  const supabase = await createClient();
  // O preço não é mais legível direto da tabela (migration 0112): a RPC devolve
  // o catálogo com o preço de PE mascarado para quem não tem permissão.
  const { data: catalogo, error: itemError } = await supabase.rpc("orcamento_projeto_catalogo_listar");
  if (itemError) throw new Error(itemError.message);
  const item = (catalogo ?? []).find((linha) => linha.id === catalogoId);
  if (!item) return;
  if (precoCatalogoMascarado(item)) {
    // Copiar o valor de PE para o orçamento o revelaria na linha de custo.
    throw new Error(
      "Valores de pessoal (PE) do catálogo exigem a permissão “Ver salário dos técnicos”. Lance o custo manualmente ou peça a quem tem a permissão.",
    );
  }

  const projeto = await assegurarProjetoEditavel(supabase, id);
  const quantidade = numero(formData, "quantidade", 1);
  if (!(quantidade > 0)) throw new Error("A quantidade precisa ser maior que zero.");
  const mesesSelecionados = normalizarMeses(
    inteiroArray(formData, "meses_selecionados"),
    Number(projeto?.project_months ?? 12),
  );
  const { error } = await supabase.from("orcamento_projeto_custos").insert({
    orcamento_projeto_id: id,
    categoria: categoriaPorRubrica(item.rubrica),
    rubrica: item.rubrica,
    catalogo_item_id: item.id,
    descricao: item.descricao,
    quantidade,
    unidade: item.unidade,
    custo_unitario: Number(item.preco_unitario ?? 0),
    preco_unitario: Number(item.preco_unitario ?? 0),
    meses_selecionados: mesesSelecionados,
    origem: "catalogo",
    etapa: texto(formData, "etapa") || etapaPorRubrica(item.rubrica),
    atividade: texto(formData, "atividade") || item.categoria || categoriaPorRubrica(item.rubrica),
    entrega: texto(formData, "entrega") || "Entrega principal",
    categoria_institucional: texto(formData, "categoria_institucional") || categoriaInstitucionalPorRubrica(item.rubrica),
    nomenclatura_origem: item.id.includes("-") ? "orcamento_projetos_antigo" : "catalogo_institucional",
  });
  if (error) throw new Error(error.message);
  revalidarEtapaProjeto(demandaDe(projeto, formData));
}

async function salvarViagensProjetoInterno(formData: FormData) {
  await exigirPapelOrcamento("preencher_custos");
  const id = numero(formData, "orcamento_projeto_id");
  if (!id) return;

  const inputs: ViagemInputs = normalizarViagemInputs({
    pessoas: numero(formData, "pessoas"),
    dias_campo: numero(formData, "dias_campo"),
    fator_risco_dias: numero(formData, "fator_risco_dias"),
    diarias_hospedagem: numero(formData, "diarias_hospedagem"),
    quartos: numero(formData, "quartos"),
    veiculos: numero(formData, "veiculos"),
    distancia_km: numero(formData, "distancia_km"),
    consumo_km_l: numero(formData, "consumo_km_l", 10),
    pedagios: numero(formData, "pedagios"),
    passagens_aereas: numero(formData, "passagens_aereas"),
  });

  const supabase = await createClient();
  const projeto = await assegurarProjetoEditavel(supabase, id);
  const { error: inputsError } = await supabase
    .from("orcamento_projetos")
    .update({ travel_inputs: inputs as unknown as Json })
    .eq("id", id);
  if (inputsError) throw new Error(inputsError.message);

  // Recalcula a quantidade das linhas VD automatizáveis a partir dos parâmetros.
  const { data: vdItens } = await supabase
    .from("orcamento_projeto_custos")
    .select("id, descricao, categoria, catalogo_item_id")
    .eq("orcamento_projeto_id", id)
    .eq("rubrica", "VD");
  for (const item of vdItens ?? []) {
    const despesa = classificarDespesaViagem(item.descricao, item.categoria);
    const quantidade = calcularQuantidadeViagem(despesa, inputs);
    if (quantidade != null && quantidade > 0) {
      const { error } = await supabase
        .from("orcamento_projeto_custos")
        .update({ quantidade })
        .eq("id", item.id)
        .eq("orcamento_projeto_id", id);
      if (error) throw new Error(error.message);
    }
  }

  // Opcional: cria as linhas padrão de viagem do catálogo que ainda faltam (quantidade > 0).
  if (formData.get("criar_linhas_padrao") === "1") {
    // RPC da 0112 (SELECT direto do preço é negado); VD nunca é mascarado.
    const { data: catalogoTodo, error: catalogoError } = await supabase.rpc("orcamento_projeto_catalogo_listar");
    if (catalogoError) throw new Error(catalogoError.message);
    const catalogoVD = ((catalogoTodo ?? []) as Array<{ rubrica: string; ativo: boolean | null }>).filter(
      (item) => item.rubrica === "VD" && item.ativo !== false,
    );
    const catalogo = catalogoVD as unknown as Array<{
      id: string;
      descricao: string;
      unidade: string | null;
      preco_unitario: number | null;
      categoria: string | null;
    }>;
    const faltantes = linhasViagemFaltantes(catalogo, vdItens ?? [], inputs);
    if (faltantes.length > 0) {
      const { error } = await supabase.from("orcamento_projeto_custos").insert(
        faltantes.map(({ item, quantidade }) => ({
          orcamento_projeto_id: id,
          categoria: categoriaPorRubrica("VD"),
          rubrica: "VD",
          catalogo_item_id: item.id,
          descricao: item.descricao,
          quantidade,
          unidade: item.unidade,
          custo_unitario: Number(item.preco_unitario ?? 0),
          preco_unitario: Number(item.preco_unitario ?? 0),
          meses_selecionados: [],
          origem: "catalogo",
          etapa: etapaPorRubrica("VD"),
          atividade: item.categoria || categoriaPorRubrica("VD"),
          entrega: "Entrega principal",
          categoria_institucional: categoriaInstitucionalPorRubrica("VD"),
          nomenclatura_origem: item.id.includes("-") ? "orcamento_projetos_antigo" : "catalogo_institucional",
        })),
      );
      if (error) throw new Error(error.message);
    }
  }
  revalidarEtapaProjeto(demandaDe(projeto, formData));
}

export async function removerAnaliseProjeto(formData: FormData) {
  await exigirPapelOrcamento("preencher_custos");
  const id = numero(formData, "orcamento_projeto_id");
  const itemId = numero(formData, "item_id");
  if (!id || !itemId) return;
  const supabase = await createClient();
  const projeto = await assegurarProjetoEditavel(supabase, id);
  const { error } = await supabase
    .from("orcamento_projeto_analises")
    .delete()
    .eq("id", itemId)
    .eq("orcamento_projeto_id", id);
  if (error) throw new Error(error.message);
  revalidarEtapaProjeto(demandaDe(projeto, formData));
}

export async function removerCustoProjeto(formData: FormData) {
  await exigirPapelOrcamento("preencher_custos");
  const id = numero(formData, "orcamento_projeto_id");
  const itemId = numero(formData, "item_id");
  if (!id || !itemId) return;
  const supabase = await createClient();
  const projeto = await assegurarProjetoEditavel(supabase, id);
  const { error } = await supabase
    .from("orcamento_projeto_custos")
    .delete()
    .eq("id", itemId)
    .eq("orcamento_projeto_id", id);
  if (error) throw new Error(error.message);
  revalidarEtapaProjeto(demandaDe(projeto, formData));
}

/**
 * Item 12: as ações do editor de custos devolvem a recusa (permissão, módulo
 * travado, validação ou banco) para o FormAcao mostrar, em vez de lançar — em
 * produção o erro lançado vira a tela genérica e a mensagem se perde.
 * redirect()/notFound() continuam passando (unstable_rethrow).
 */
async function comRetorno(acao: () => Promise<void>): Promise<EstadoAcao | void> {
  try {
    await acao();
  } catch (erro) {
    unstable_rethrow(erro);
    return falha(mensagemDoBanco(erro instanceof Error ? erro.message : erro));
  }
}

export async function adicionarAnaliseProjeto(formData: FormData): Promise<EstadoAcao | void> {
  return comRetorno(() => adicionarAnaliseProjetoInterno(formData));
}

export async function adicionarCustoProjeto(formData: FormData): Promise<EstadoAcao | void> {
  return comRetorno(() => adicionarCustoProjetoInterno(formData));
}

export async function atualizarCustoProjeto(formData: FormData): Promise<EstadoAcao | void> {
  return comRetorno(() => atualizarCustoProjetoInterno(formData));
}

export async function salvarMesesPessoalProjeto(formData: FormData): Promise<EstadoAcao | void> {
  return comRetorno(() => salvarMesesPessoalProjetoInterno(formData));
}

export async function salvarDuracaoProjeto(formData: FormData): Promise<EstadoAcao | void> {
  return comRetorno(() => salvarDuracaoProjetoInterno(formData));
}

export async function concluirRevisaoCustosProjeto(formData: FormData): Promise<EstadoAcao | void> {
  return comRetorno(() => concluirRevisaoCustosProjetoInterno(formData));
}

export async function reabrirCustosProjeto(formData: FormData): Promise<EstadoAcao | void> {
  return comRetorno(() => reabrirCustosProjetoInterno(formData));
}

export async function adicionarCustoCatalogoProjeto(formData: FormData): Promise<EstadoAcao | void> {
  return comRetorno(() => adicionarCustoCatalogoProjetoInterno(formData));
}

export async function salvarViagensProjeto(formData: FormData): Promise<EstadoAcao | void> {
  return comRetorno(() => salvarViagensProjetoInterno(formData));
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

type EstadoLink = EstadoAcao & { caminho?: string };

/**
 * Gera o link público de aprovação de uma versão da proposta (ORC-2,
 * funcionalidade do app antigo restaurada). O código bruto volta uma única vez
 * para a tela; o banco guarda só o hash SHA-256. Mesma permissão na tela e no
 * banco (RLS): "Orçamentos: Emitir proposta".
 */
export async function criarLinkPublico(_estado: EstadoLink, formData: FormData): Promise<EstadoLink> {
  const recusa = await recusaSemPermissao("emitir_final");
  if (recusa) return recusa;
  const versaoId = numero(formData, "versao_id");
  if (!versaoId) return falha("Proposta não identificada.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: versao, error: versaoError } = await supabase
    .from("orcamento_final_versoes")
    .select("id, demanda_id, status, valido_ate")
    .eq("id", versaoId)
    .maybeSingle();
  if (versaoError || !versao) return falha("Proposta não encontrada.");
  if (!["emitido", "enviado", "alterado_reenviado"].includes(versao.status)) {
    return falha("Link de aprovação só existe para proposta emitida ou enviada, ainda não aprovada.");
  }
  // Módulo de projeto ativo, quando houver (o link também vale sem ele — 0126).
  const { data: projeto } = await supabase
    .from("orcamento_projetos")
    .select("id")
    .eq("demanda_id", versao.demanda_id)
    .neq("status", "cancelado")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  const token = randomBytes(24).toString("base64url");
  const { error } = await supabase.from("orcamento_projeto_links").insert({
    orcamento_projeto_id: projeto?.id ?? null,
    orcamento_final_versao_id: versao.id,
    token_hash: hashToken(token),
    criado_por: user?.id ?? null,
  });
  if (error) return falha(mensagemDoBanco(error));

  revalidatePath(`/orcamento/final/${versao.id}`);
  return { ok: true, message: "Link criado.", caminho: `/aprovar/${token}` };
}

export async function revogarLinkPublico(_estado: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  const recusa = await recusaSemPermissao("emitir_final");
  if (recusa) return recusa;
  const versaoId = numero(formData, "versao_id");
  const linkId = numero(formData, "link_id");
  if (!versaoId || !linkId) return falha("Link não identificado.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orcamento_projeto_links")
    .update({ revogado: true })
    .eq("id", linkId)
    .eq("orcamento_final_versao_id", versaoId)
    .select("id");
  if (error) return falha(mensagemDoBanco(error));
  if (!data?.length) return falha("O link não foi revogado: ele não existe mais ou seu perfil não pode alterá-lo.");
  revalidatePath(`/orcamento/final/${versaoId}`);
  return sucesso("Link revogado. Quem tiver o endereço não consegue mais abrir a proposta.");
}

const MOTIVOS_APROVACAO_PUBLICA = new Set(["vencida", "outra_aprovada", "versao_nova"]);

/** Aprovação pública (sem login) via RPC SECURITY DEFINER validando o token. */
export async function aprovarOrcamentoPublico(formData: FormData) {
  const token = texto(formData, "token");
  const nome = texto(formData, "nome");
  if (!token) return;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("aprovar_orcamento_publico", {
    p_token: token,
    p_nome: nome ?? "",
  });
  const resultado = data as {
    aprovado?: boolean;
    repetido?: boolean;
    versao_id?: number;
    motivo?: string;
  } | null;
  if (error || !resultado?.aprovado || !resultado.versao_id) {
    const motivo = resultado?.motivo && MOTIVOS_APROVACAO_PUBLICA.has(resultado.motivo)
      ? resultado.motivo
      : "link_indisponivel";
    redirect(`/aprovar/${token}?erro=${motivo}`);
  }
  revalidatePath(`/aprovar/${token}`);
  revalidatePath(`/orcamento/final/${resultado.versao_id}`);
}

type CustoTemplate = {
  categoria: string;
  etapa?: string | null;
  atividade?: string | null;
  entrega?: string | null;
  categoria_institucional?: string | null;
  nomenclatura_origem?: string | null;
  rubrica: string | null;
  descricao: string;
  quantidade: number;
  unidade: string | null;
  custo_unitario: number;
  preco_unitario: number;
  meses_selecionados: number[] | null;
};

type ParametrosTemplate = {
  project_months?: number;
  impostos_legacy?: number;
  incubacao?: number;
  reserva?: number;
  investimentos?: number;
  lucro?: number;
  travel_inputs?: unknown;
};

/** Salva o orçamento atual como template reutilizável (parâmetros + rubricas).
 *  Análises de laboratório não entram (são específicas de cada cotação).
 *  Usa o schema existente (0012): parâmetros e itens em colunas jsonb. */
export async function salvarComoTemplate(formData: FormData) {
  await exigirPapelOrcamento("gerir_modelos");
  const id = numero(formData, "orcamento_projeto_id");
  const nome = texto(formData, "nome");
  if (!id || !nome) return;

  const supabase = await createClient();

  const { data: orc } = await supabase
    .from("orcamento_projetos")
    .select(
      "demanda_id, project_months, impostos_legacy, incubacao, reserva, investimentos, lucro, margem_lucro, impostos, travel_inputs",
    )
    .eq("id", id)
    .single();
  if (!orc) return;

  const { data: custos } = await supabase
    .from("orcamento_projeto_custos")
    .select("categoria, etapa, atividade, entrega, categoria_institucional, nomenclatura_origem, rubrica, descricao, quantidade, unidade, custo_unitario, preco_unitario, meses_selecionados")
    .eq("orcamento_projeto_id", id);

  const parametros: ParametrosTemplate = {
    project_months: Number(orc.project_months ?? 12),
    ...ratesDoOrcamentoProjeto(orc),
    travel_inputs: orc.travel_inputs ?? {},
  };

  const { error } = await supabase.from("orcamento_projeto_templates").insert({
    nome,
    descricao: texto(formData, "descricao"),
    origem: "kontrol",
    itens: (custos ?? []) as unknown as Json,
    parametros: parametros as unknown as Json,
  });
  if (error) throw new Error(error.message);
  revalidarEtapaProjeto(demandaDe(orc, formData));
  revalidatePath("/orcamento/modelos");
}

/** Cria um novo orçamento de projeto a partir de um template. */
export async function criarProjetoDeTemplate(formData: FormData) {
  await exigirPapelOrcamento("preencher_custos");
  const templateId = numero(formData, "template_id");
  if (!templateId) return;

  const supabase = await createClient();
  const { data: tpl } = await supabase
    .from("orcamento_projeto_templates")
    .select("*")
    .eq("id", templateId)
    .single();
  if (!tpl) return;

  const params = (tpl.parametros ?? {}) as ParametrosTemplate;

  const projetoId = formData.get("projeto_id") ? Number(formData.get("projeto_id")) : null;
  let projeto: { nome: string; cliente_id: number | null } | null = null;
  if (projetoId) {
    const { data } = await supabase
      .from("projetos")
      .select("nome, cliente_id")
      .eq("id", projetoId)
      .single();
    projeto = data;
  }
  const cliente = await carregarCliente(projeto?.cliente_id ?? null);

  const { data: novo, error } = await supabase
    .from("orcamento_projetos")
    .insert({
      projeto_id: projetoId,
      cliente_id: projeto?.cliente_id ?? null,
      titulo: projeto?.nome ?? `Projeto de ${tpl.nome}`,
      cliente_nome: cliente?.nome ?? null,
      cliente_cnpj: cliente?.cnpj ?? null,
      cliente_contato: cliente?.contato || cliente?.email || cliente?.telefone || null,
      project_months: Number(params.project_months ?? 12),
      impostos_legacy: Number(params.impostos_legacy ?? 0),
      incubacao: Number(params.incubacao ?? 0),
      reserva: Number(params.reserva ?? 0),
      investimentos: Number(params.investimentos ?? 0),
      lucro: Number(params.lucro ?? 0),
      travel_inputs: (params.travel_inputs ?? {}) as Json,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const itens = ((tpl.itens ?? []) as unknown as CustoTemplate[]) ?? [];
  if (itens.length > 0) {
    const linhas = itens.map((it) => ({
      orcamento_projeto_id: novo.id,
      categoria: it.categoria || categoriaPorRubrica(it.rubrica || "OU"),
      etapa: it.etapa ?? etapaPorRubrica(it.rubrica || "OU"),
      atividade: it.atividade ?? it.categoria,
      entrega: it.entrega ?? "Entrega principal",
      categoria_institucional: it.categoria_institucional ?? categoriaInstitucionalPorRubrica(it.rubrica || "OU"),
      nomenclatura_origem: it.nomenclatura_origem ?? "kontrol",
      rubrica: it.rubrica || "OU",
      descricao: it.descricao,
      quantidade: Number(it.quantidade) || 1,
      unidade: it.unidade,
      custo_unitario: Number(it.custo_unitario) || 0,
      preco_unitario: Number(it.preco_unitario) || 0,
      meses_selecionados: it.meses_selecionados ?? [],
      origem: "template",
    }));
    const { error: itemError } = await supabase.from("orcamento_projeto_custos").insert(linhas);
    if (itemError) throw new Error(itemError.message);
  }

  // K2 (Etapa B): este fluxo ainda cria sem demanda; o endereço antigo redireciona para a etapa da proposta.
  revalidatePath(pathDemandas);
  redirect(`/orcamento/projetos/${novo.id}`);
}

export async function excluirTemplate(formData: FormData) {
  const templateId = numero(formData, "template_id");
  if (!templateId) return;
  await exigirPapelOrcamento("gerir_modelos");
  const supabase = await createClient();
  const { data: template } = await supabase
    .from("orcamento_projeto_templates")
    .select("nome, descricao")
    .eq("id", templateId)
    .single();
  if (!template) return;
  const nome = template.nome.startsWith("[ARQUIVADO]")
    ? template.nome
    : `[ARQUIVADO] ${template.nome}`;
  const descricaoBase = template.descricao ?? "";
  const descricao = descricaoBase.includes("Arquivado em ")
    ? descricaoBase
    : `${descricaoBase}${descricaoBase ? "\n" : ""}Arquivado em ${new Date().toISOString().slice(0, 10)}.`;
  await supabase.from("orcamento_projeto_templates").update({ nome, descricao }).eq("id", templateId);
  await registrarEvento("orcamento_template", templateId, "ativo", "arquivado", "Template arquivado sem remoção física.");
  revalidatePath("/orcamento/modelos");
}

export async function duplicarTemplateProjeto(formData: FormData) {
  const templateId = numero(formData, "template_id");
  if (!templateId) return;
  await exigirPapelOrcamento("gerir_modelos");
  const supabase = await createClient();
  const { data: template } = await supabase
    .from("orcamento_projeto_templates")
    .select("nome, descricao, itens, parametros, origem")
    .eq("id", templateId)
    .single();
  if (!template) return;
  const nomeBase = template.nome.replace(/^\[ARQUIVADO\]\s*/i, "");
  const { data: novo, error } = await supabase.from("orcamento_projeto_templates").insert({
    nome: `${nomeBase} (cópia)`,
    descricao: template.descricao,
    itens: template.itens,
    parametros: template.parametros,
    origem: "kontrol",
  }).select("id").single();
  if (error) throw new Error(error.message);
  await registrarEvento(
    "orcamento_template",
    Number(novo?.id ?? templateId),
    String(templateId),
    "duplicado",
    `Template duplicado a partir de #${templateId}.`,
  );
  revalidatePath("/orcamento/modelos");
}

export async function arquivarCatalogoProjetoItem(formData: FormData) {
  const catalogoId = texto(formData, "catalogo_item_id");
  if (!catalogoId) return;
  await exigirPapelOrcamento("gerir_modelos");
  const supabase = await createClient();
  const { error } = await supabase
    .from("orcamento_projeto_catalogo")
    .update({ ativo: false, atualizado_em: new Date().toISOString() })
    .eq("id", catalogoId);
  if (error) throw new Error(error.message);
  await registrarEvento("orcamento_catalogo", Number(catalogoId) || 0, "ativo", "arquivado", "Item de catálogo arquivado sem remoção física.");
  revalidatePath("/orcamento/modelos");
}

const BUCKET_ANEXOS = "orcamento-anexos";

/** Faz upload de um anexo do orçamento de projeto para o bucket privado. */
export async function adicionarAnexoProjeto(formData: FormData) {
  await exigirPapelOrcamento("preencher_custos");
  const id = numero(formData, "orcamento_projeto_id");
  const arquivo = formData.get("arquivo");
  if (!id || !(arquivo instanceof File) || arquivo.size === 0) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const seguro = arquivo.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "arquivo";
  const path = `${id}/${randomBytes(8).toString("hex")}-${seguro}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET_ANEXOS)
    .upload(path, arquivo, { contentType: arquivo.type || undefined, upsert: false });
  if (upErr) throw new Error(upErr.message);

  const { error } = await supabase.from("orcamento_projeto_anexos").insert({
    orcamento_projeto_id: id,
    path,
    nome_arquivo: arquivo.name,
    content_type: arquivo.type || null,
    tamanho: arquivo.size,
    criado_por: user?.id ?? null,
  });
  if (error) {
    // rollback do objeto se o metadado falhar
    await supabase.storage.from(BUCKET_ANEXOS).remove([path]);
    throw new Error(error.message);
  }
  revalidarEtapaProjeto(demandaDe(await carregarProjeto(supabase, id), formData));
}

export async function removerAnexoProjeto(formData: FormData) {
  await exigirPapelOrcamento("preencher_custos");
  const id = numero(formData, "orcamento_projeto_id");
  const anexoId = numero(formData, "anexo_id");
  if (!id || !anexoId) return;

  const supabase = await createClient();
  const { data: anexo } = await supabase
    .from("orcamento_projeto_anexos")
    .select("path")
    .eq("id", anexoId)
    .single();
  if (anexo?.path) {
    await supabase.storage.from(BUCKET_ANEXOS).remove([anexo.path]);
  }
  await supabase.from("orcamento_projeto_anexos").delete().eq("id", anexoId);
  revalidarEtapaProjeto(demandaDe(await carregarProjeto(supabase, id), formData));
}

export async function excluirOrcamentoProjeto(formData: FormData) {
  await exigirPapelOrcamento("cancelar_documento");
  const id = numero(formData, "orcamento_projeto_id");
  if (!id) return;
  const supabase = await createClient();
  const atual = await carregarProjeto(supabase, id);
  const demandaId = demandaDe(atual, formData);

  if (atual && ["enviado", "aprovado"].includes(atual.status ?? "")) {
    redirect(
      comParametro(
        caminhoEtapa(demandaId),
        "erro_exclusao",
        "Orçamento enviado ou aprovado não pode ser excluído. Use cancelamento/versionamento quando disponível.",
      ),
    );
  }

  await supabase.from("orcamento_projetos").delete().eq("id", id);
  revalidarEtapaProjeto(demandaId);
  redirect(caminhoEtapa(demandaId));
}

export async function cancelarOrcamentoProjeto(formData: FormData) {
  const id = numero(formData, "orcamento_projeto_id");
  if (!id) return;
  const motivo = texto(formData, "motivo") || "Cancelamento operacional.";
  await exigirPapelOrcamento("cancelar_documento");
  const supabase = await createClient();
  const atual = await carregarProjeto(supabase, id);
  if (!atual || atual.status === "cancelado") return;

  const { error } = await supabase.rpc("transicionar_orcamento_projeto", {
    p_orcamento_projeto_id: id,
    p_status_destino: "cancelado",
    p_observacao: motivo,
  });
  if (error) throw new Error(error.message);
  const demandaId = demandaDe(atual, formData);
  revalidarEtapaProjeto(demandaId);
  redirect(caminhoEtapa(demandaId));
}
