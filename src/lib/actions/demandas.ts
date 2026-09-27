"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { avaliarCompletudeDemanda } from "@/lib/orcamento/demanda-completude";
import { avaliarModuloOperacional } from "@/lib/orcamento/modulo-status";
import { consolidarOrcamentoFinal } from "@/lib/orcamento/orcamento-final";
import { modalidadeExigeLaboratorio, modalidadeExigeProjeto } from "@/lib/orcamento/orcamento-economico";
import { detectarCustosZero } from "@/lib/orcamento/proposta-final";
import { planejarModulosProposta, type PlanoModulos } from "@/lib/orcamento/garantir-modulos";
import { exigirPapelOrcamento } from "@/lib/orcamento/governanca";
import { mensagemDoBanco } from "@/lib/erros";
import { incluirAnalisesDaDemandaNoOrcamento } from "./orcamentos";
import { padroesDeParametrosGlobais, resolverParametrosProposta } from "@/lib/orcamento/parametros-proposta";
import {
  lerAnalisesSelecionadas,
  lerGruposAmostras,
  matrizesConcatenadas,
  payloadSincronizacao,
  totalAmostras,
} from "@/lib/orcamento/grupos-amostras";
import type { Json } from "@/lib/supabase/database.types";

const listaPath = "/orcamento/demandas";

export type DemandaFormState = {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
  savedAt?: string;
};

function texto(formData: FormData, chave: string) {
  const valor = String(formData.get(chave) ?? "").trim();
  return valor || null;
}

function numero(formData: FormData, chave: string) {
  return Number(formData.get(chave) ?? 0) || 0;
}

function numeroOuNull(formData: FormData, chave: string) {
  const valor = formData.get(chave);
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function snapshotCompletude(demanda: Parameters<typeof avaliarCompletudeDemanda>[0]) {
  const completude = avaliarCompletudeDemanda(demanda);
  return {
    ...completude,
    atualizado_em: new Date().toISOString(),
  };
}

// Carrega os IDs de módulos ATIVOS (não cancelados) de uma demanda e devolve o
// plano idempotente (criar/abrir/bloquear).
async function planoModulos(
  supabase: Awaited<ReturnType<typeof createClient>>,
  demanda: { id: number; modalidade?: string | null; projeto_id?: number | null },
): Promise<PlanoModulos> {
  const [{ data: labs }, { data: projs }] = await Promise.all([
    supabase.from("orcamentos").select("id, status, status_operacional").eq("demanda_id", demanda.id),
    supabase.from("orcamento_projetos").select("id, status").eq("demanda_id", demanda.id),
  ]);
  const laboratorioAtivos = (labs ?? [])
    .filter((o) => o.status !== "cancelado" && o.status_operacional !== "cancelado")
    .map((o) => o.id);
  const projetoAtivos = (projs ?? []).filter((o) => o.status !== "cancelado").map((o) => o.id);
  return planejarModulosProposta({
    modalidade: demanda.modalidade,
    projetoAssociado: Boolean(demanda.projeto_id),
    laboratorioAtivos,
    projetoAtivos,
  });
}

// Criar módulo NÃO torna a proposta "orcada". Apenas tira de "nova" para o estado
// transitório "em_analise" (status já existente no banco). "orcada" só após emissão.
async function marcarEmAnalise(
  supabase: Awaited<ReturnType<typeof createClient>>,
  demanda: { id: number; status?: string | null },
) {
  if (demanda.status === "nova") {
    await supabase.from("demandas_propostas").update({ status: "em_analise" }).eq("id", demanda.id);
  }
}

async function clienteSnapshot(clienteId: number | null) {
  if (!clienteId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("clientes")
    .select("nome, cnpj, contato, email, telefone")
    .eq("id", clienteId)
    .single();
  return data;
}

export async function criarDemanda(formData: FormData) {
  const erro = await executarCriacaoDemanda(formData);
  if (erro) throw new Error(erro);
}

// Cria e redireciona; em falha devolve a mensagem (o formulário não se perde).
async function executarCriacaoDemanda(formData: FormData): Promise<string | null> {
  await exigirPapelOrcamento("criar_demanda");
  const supabase = await createClient();
  // Validação dos grupos e das análises antes de qualquer escrita.
  let grupos;
  let analises;
  try {
    grupos = lerGruposAmostras(formData);
    analises = lerAnalisesSelecionadas(formData);
  } catch (e) {
    return e instanceof Error ? e.message : "Grupos de amostras inválidos.";
  }
  const clienteId = numeroOuNull(formData, "cliente_id");
  const cliente = await clienteSnapshot(clienteId);
  const demanda = {
    cliente_id: clienteId,
    projeto_id: numeroOuNull(formData, "projeto_id"),
    titulo: texto(formData, "titulo") || "Nova demanda",
    cliente_nome: cliente?.nome ?? texto(formData, "cliente_nome"),
    cliente_cnpj: cliente?.cnpj ?? texto(formData, "cliente_cnpj"),
    cliente_contato: cliente?.contato || cliente?.email || cliente?.telefone || texto(formData, "cliente_contato"),
    instituicao: texto(formData, "instituicao"),
    responsavel_interno: texto(formData, "responsavel_interno"),
    data_solicitacao: texto(formData, "data_solicitacao") ?? undefined,
    prazo_esperado: texto(formData, "prazo_esperado"),
    modalidade: texto(formData, "modalidade") || "analises",
    origem: texto(formData, "origem"),
    prioridade: texto(formData, "prioridade") || "normal",
    descricao: texto(formData, "descricao"),
    escopo_preliminar: texto(formData, "escopo_preliminar"),
    matriz_amostra:
      grupos !== null && grupos.length > 0 ? matrizesConcatenadas(grupos) || null : texto(formData, "matriz_amostra"),
    quantidade_amostras_estimada:
      grupos !== null && grupos.length > 0
        ? totalAmostras(grupos)
        : numeroOuNull(formData, "quantidade_amostras_estimada"),
    prazo_tecnico_dias: numeroOuNull(formData, "prazo_tecnico_dias"),
    observacoes: texto(formData, "observacoes"),
  };
  const completude = snapshotCompletude(demanda);

  // Demanda, grupos e associações análise↔grupo numa única transação
  // (`salvar_demanda_com_grupos`, migration 0105). Antes eram duas
  // chamadas, e uma falha na segunda deixava a demanda sem grupos.
  const { data, error } = await supabase.rpc("salvar_demanda_com_grupos" as never, {
    p_demanda_id: null,
    p_demanda: {
      ...demanda,
      completude_snapshot: completude,
      completude_atualizada_em: completude.atualizado_em,
    },
    p_grupos: payloadSincronizacao(grupos),
    p_analises: analises,
  } as never);

  if (error) return `Não foi possível criar o orçamento: ${mensagemGruposDemanda(error)}`;
  const demandaId = (data as { demanda_id?: number } | null)?.demanda_id;
  if (!demandaId) return "O banco não confirmou a criação do orçamento. Nada foi salvo.";

  revalidatePath(listaPath);
  redirect(`${listaPath}/${demandaId}`);
}

/** Recusa ao gravar orçamento com grupos: a matriz do grupo precisa estar cadastrada. */
function mensagemGruposDemanda(error: { code?: string | null; message: string }) {
  if (error.code === "23503" && /tipo_matriz/.test(error.message)) {
    return "o tipo/matriz de um grupo não está cadastrado. Escolha uma matriz da lista.";
  }
  return mensagemDoBanco(error);
}

export async function criarDemandaCompleta(
  _prevState: DemandaFormState,
  formData: FormData,
): Promise<DemandaFormState> {
  const erro = await executarCriacaoDemanda(formData);
  return { ok: false, message: erro ?? "Não foi possível criar o orçamento." };
}

export async function salvarDemanda(formData: FormData): Promise<void>;
export async function salvarDemanda(
  _prevState: DemandaFormState,
  formData: FormData,
): Promise<DemandaFormState>;
export async function salvarDemanda(
  stateOrFormData: DemandaFormState | FormData,
  maybeFormData?: FormData,
): Promise<DemandaFormState | void> {
  await exigirPapelOrcamento("criar_demanda");
  const formData = maybeFormData ?? (stateOrFormData as FormData);
  const retornaEstado = Boolean(maybeFormData);
  const id = Number(formData.get("demanda_id"));
  if (!id) return retornaEstado ? { ok: false, message: "Orçamento inválido." } : undefined;

  const supabase = await createClient();
  const clienteId = numeroOuNull(formData, "cliente_id");
  const cliente = await clienteSnapshot(clienteId);

  // Os grupos são lidos e validados ANTES de qualquer escrita: se o
  // formulário vier inconsistente, nada é gravado. Antes desta correção os
  // campos de grupo eram simplesmente ignorados pelo servidor.
  let grupos;
  let analises;
  try {
    grupos = lerGruposAmostras(formData);
    analises = lerAnalisesSelecionadas(formData);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Grupos de amostras inválidos.";
    if (retornaEstado) return { ok: false, message };
    throw new Error(message);
  }

  const patch = {
    cliente_id: clienteId,
    projeto_id: numeroOuNull(formData, "projeto_id"),
    titulo: texto(formData, "titulo") || "Orçamento sem título",
    cliente_nome: cliente?.nome ?? texto(formData, "cliente_nome"),
    cliente_cnpj: cliente?.cnpj ?? texto(formData, "cliente_cnpj"),
    cliente_contato: cliente?.contato || cliente?.email || cliente?.telefone || texto(formData, "cliente_contato"),
    instituicao: texto(formData, "instituicao"),
    responsavel_interno: texto(formData, "responsavel_interno"),
    data_solicitacao: texto(formData, "data_solicitacao") ?? undefined,
    prazo_esperado: texto(formData, "prazo_esperado"),
    modalidade: texto(formData, "modalidade") || "analises",
    // UI-6: o status não é mais editado no formulário; a RPC preserva o atual (nulo = mantém).
    status: texto(formData, "status"),
    origem: texto(formData, "origem"),
    prioridade: texto(formData, "prioridade") || "normal",
    descricao: texto(formData, "descricao"),
    escopo_preliminar: texto(formData, "escopo_preliminar"),
    // Com grupos preenchidos, os dois campos legados passam a ser derivados
    // no servidor, não recebidos prontos do formulário.
    matriz_amostra:
      grupos !== null && grupos.length > 0 ? matrizesConcatenadas(grupos) || null : texto(formData, "matriz_amostra"),
    quantidade_amostras_estimada:
      grupos !== null && grupos.length > 0
        ? totalAmostras(grupos)
        : numeroOuNull(formData, "quantidade_amostras_estimada"),
    prazo_tecnico_dias: numeroOuNull(formData, "prazo_tecnico_dias"),
    observacoes: texto(formData, "observacoes"),
  };
  const completude = snapshotCompletude(patch);

  // Uma transação só: demanda, grupos e associações análise↔grupo.
  const { data, error } = await supabase.rpc("salvar_demanda_com_grupos" as never, {
    p_demanda_id: id,
    p_demanda: {
      ...patch,
      completude_snapshot: completude,
      completude_atualizada_em: completude.atualizado_em,
    },
    p_grupos: payloadSincronizacao(grupos),
    p_analises: analises,
  } as never);

  if (error) {
    if (retornaEstado) return { ok: false, message: mensagemGruposDemanda(error) };
    throw new Error(mensagemGruposDemanda(error));
  }
  // A RPC é SECURITY INVOKER: sob RLS negada, o UPDATE interno não acha a
  // linha e a função levanta P0002. Ainda assim, retorno vazio não é sucesso.
  if (!(data as { demanda_id?: number } | null)?.demanda_id) {
    const message = "O banco não confirmou a gravação da demanda. Nada foi salvo.";
    if (retornaEstado) return { ok: false, message };
    throw new Error(message);
  }

  revalidatePath(listaPath);
  revalidatePath(`${listaPath}/${id}`);
  if (retornaEstado) {
    return { ok: true, message: "Orçamento salvo.", savedAt: new Date().toISOString() };
  }
}

export async function gerarOrcamentoAnalisesDaDemanda(formData: FormData) {
  await exigirPapelOrcamento("preencher_custos");
  const id = Number(formData.get("demanda_id"));
  if (!id) return;

  const supabase = await createClient();
  const { data: demanda } = await supabase
    .from("demandas_propostas")
    .select("*")
    .eq("id", id)
    .single();
  if (!demanda) return;
  if (!avaliarCompletudeDemanda(demanda).completa) {
    redirect(`${listaPath}/${id}`);
  }
  if (!modalidadeExigeLaboratorio(demanda.modalidade)) {
    redirect(`${listaPath}/${id}`);
  }

  // Idempotência: nunca duplicar; abrir o existente; bloquear se houver >1 ativo.
  const plano = await planoModulos(supabase, demanda);
  const lab = plano.laboratorio;
  if (lab.acao === "bloqueado") {
    redirect(`${listaPath}/${id}?etapa=demanda&erro_integridade=${encodeURIComponent(plano.erros.join("; "))}`);
  }
  if (lab.acao === "abrir" && lab.moduloId) {
    redirect(`/orcamento/${lab.moduloId}`);
  }

  const { data, error } = await supabase
    .from("orcamentos")
    .insert({
      demanda_id: id,
      cliente_id: demanda.cliente_id,
      projeto_id: demanda.projeto_id,
      cliente_nome: demanda.cliente_nome || demanda.titulo,
      cliente_cnpj: demanda.cliente_cnpj,
      cliente_contato: demanda.cliente_contato,
      responsavel: demanda.responsavel_interno,
      observacoes: demanda.escopo_preliminar || demanda.descricao || demanda.observacoes,
    })
    .select("id")
    .single();

  if (error) {
    // ORC-10: duplo clique cai no índice único de módulo ativo (0126); abre o que já existe.
    if (error.code === "23505") {
      const { data: existente } = await supabase
        .from("orcamentos")
        .select("id")
        .eq("demanda_id", id)
        .neq("status", "cancelado")
        .neq("status_operacional", "cancelado")
        .limit(1)
        .maybeSingle();
      if (existente?.id) redirect(`/orcamento/${existente.id}`);
    }
    redirect(`${listaPath}/${id}?etapa=demanda&erro_integridade=${encodeURIComponent(mensagemDoBanco(error))}`);
  }
  // As análises escolhidas nos grupos entram no módulo (antes ele nascia vazio).
  const copia = await incluirAnalisesDaDemandaNoOrcamento(data.id, id);
  await marcarEmAnalise(supabase, demanda);
  revalidatePath(listaPath);
  redirect(copia.ok ? `/orcamento/${data.id}` : `/orcamento/${data.id}?aviso=${encodeURIComponent(copia.message ?? "")}`);
}

export async function gerarOrcamentoProjetoDaDemanda(formData: FormData) {
  await exigirPapelOrcamento("preencher_custos");
  const id = Number(formData.get("demanda_id"));
  if (!id) return;

  const supabase = await createClient();
  const { data: demanda } = await supabase
    .from("demandas_propostas")
    .select("*")
    .eq("id", id)
    .single();
  if (!demanda) return;
  if (!avaliarCompletudeDemanda(demanda).completa) {
    redirect(`${listaPath}/${id}`);
  }
  if (!modalidadeExigeProjeto(demanda.modalidade)) {
    redirect(`${listaPath}/${id}`);
  }

  // Idempotência: nunca duplicar; abrir o existente; bloquear se houver >1 ativo.
  const plano = await planoModulos(supabase, demanda);
  const projeto = plano.projeto;
  if (projeto.acao === "bloqueado") {
    redirect(`${listaPath}/${id}?etapa=demanda&erro_integridade=${encodeURIComponent(plano.erros.join("; "))}`);
  }
  if (projeto.acao === "abrir" && projeto.moduloId) {
    redirect(`/orcamento/demandas/${id}?etapa=projeto`);
  }

  const { error } = await supabase
    .from("orcamento_projetos")
    .insert({
      demanda_id: id,
      projeto_id: demanda.projeto_id,
      cliente_id: demanda.cliente_id,
      titulo: demanda.titulo,
      cliente_nome: demanda.cliente_nome,
      cliente_cnpj: demanda.cliente_cnpj,
      cliente_contato: demanda.cliente_contato,
      responsavel: demanda.responsavel_interno,
      escopo: demanda.escopo_preliminar || demanda.descricao,
      observacoes: demanda.observacoes,
    });

  // ORC-10: duplo clique cai no índice único (0126) e só reabre a etapa do projeto.
  if (error && error.code !== "23505") {
    redirect(`${listaPath}/${id}?etapa=demanda&erro_integridade=${encodeURIComponent(mensagemDoBanco(error))}`);
  }
  await marcarEmAnalise(supabase, demanda);
  revalidatePath(listaPath);
  redirect(`/orcamento/demandas/${id}?etapa=projeto`);
}

export async function emitirOrcamentoFinalDaDemanda(formData: FormData) {
  const id = Number(formData.get("demanda_id"));
  if (!id) return;
  await exigirPapelOrcamento("emitir_final");
  const operacaoId = String(formData.get("operacao_id") ?? "").trim();
  if (!z.string().uuid().safeParse(operacaoId).success) {
    redirect(`${listaPath}/${id}?etapa=final&erro_emissao=${encodeURIComponent("Identidade da operação de emissão inválida.")}`);
  }

  const validadeDias = Number(formData.get("validade_dias")) || 30;
  const supabase = await createClient();

  const { data: demanda } = await supabase
    .from("demandas_propostas")
    .select("*")
    .eq("id", id)
    .single();
  if (!demanda) return;

  const completude = avaliarCompletudeDemanda(demanda);
  if (!completude.completa) {
    redirect(`${listaPath}/${id}?etapa=final&erro_emissao=${encodeURIComponent("Complete os dados antes de emitir a proposta.")}`);
  }

  const [{ data: orcamentosTodos }, { data: orcProjetosTodos }] = await Promise.all([
    supabase
      .from("orcamentos")
      .select("id, status, status_operacional, fonte_custo_insumos, custo_snapshot, orcamento_itens(id, codigo_analise, n_amostras, custo_unitario, preco_unitario, valor_snapshot)")
      .eq("demanda_id", id)
      .order("id"),
    supabase
      .from("orcamento_projetos")
      .select("id, status, projeto_sem_custo_justificativa, impostos, margem_lucro, impostos_legacy, incubacao, reserva, investimentos, lucro, orcamento_projeto_analises(id, codigo_analise, n_amostras, custo_unitario, preco_unitario), orcamento_projeto_custos(id, rubrica, quantidade, custo_unitario, preco_unitario, meses_selecionados)")
      .eq("demanda_id", id)
      .order("id"),
  ]);
  // Módulos cancelados não entram em totais, validações nem no snapshot.
  const orcamentos = (orcamentosTodos ?? []).filter((o) => o.status !== "cancelado" && o.status_operacional !== "cancelado");
  const orcProjetos = (orcProjetosTodos ?? []).filter((o) => o.status !== "cancelado");

  // Integridade: não emitir com duplicidade ativa (também travado na RPC sob lock).
  const labAtivos = (orcamentos ?? [])
    .filter((o) => o.status !== "cancelado" && o.status_operacional !== "cancelado")
    .map((o) => o.id);
  const projAtivos = (orcProjetos ?? []).filter((o) => o.status !== "cancelado").map((o) => o.id);
  if (labAtivos.length > 1 || projAtivos.length > 1) {
    redirect(
      `${listaPath}/${id}?etapa=final&erro_emissao=${encodeURIComponent("Há orçamentos duplicados. Peça revisão ao gestor antes de emitir.")}`,
    );
  }

  const linhaSemSnapshot = (orcamentos ?? []).some((orcamento) => {
    const custoSnapshot = registro(orcamento.custo_snapshot);
    if (!Array.isArray(custoSnapshot?.linhas) || custoSnapshot.linhas.some((linha) => {
      const registroLinha = registro(linha);
      if (!registroLinha) return true;
      const exigeProveniencia = Number(registroLinha.reagentes ?? registroLinha.materiais ?? 0) > 0;
      return !provenienciasDimensionaisValidas(
        registroLinha.proveniencia_dimensional,
        exigeProveniencia,
      );
    })) return true;
    return (orcamento.orcamento_itens ?? []).some((item) => {
      const valorSnapshot = registro(item.valor_snapshot);
      const composicao = registro(valorSnapshot?.composicao);
      return !provenienciasDimensionaisValidas(
        valorSnapshot?.proveniencia_dimensional,
        Number(composicao?.reagentes ?? 0) > 0,
      );
    });
  });
  if (linhaSemSnapshot) {
    redirect(
      `${listaPath}/${id}?etapa=final&erro_emissao=${encodeURIComponent("A emissão exige snapshot econômico reconstruível em todas as linhas laboratoriais.")}`,
    );
  }

  const exigeAnalises = modalidadeExigeLaboratorio(demanda.modalidade);
  const exigeProjeto = modalidadeExigeProjeto(demanda.modalidade);
  const itensAnalises = (orcamentos ?? []).reduce((total, orcamento) => (
    total + (orcamento.orcamento_itens?.length ?? 0)
  ), 0);
  const itensProjeto = (orcProjetos ?? []).reduce((total, orcamento) => (
    total +
    (orcamento.orcamento_projeto_custos?.length ?? 0) +
    (orcamento.orcamento_projeto_analises?.length ?? 0) +
    (orcamento.projeto_sem_custo_justificativa ? 1 : 0)
  ), 0);
  const statusAnalises = (orcamentos ?? []).some((orcamento) => orcamento.status === "aprovado")
    ? "aprovado"
    : (orcamentos ?? []).some((orcamento) => orcamento.status === "enviado")
      ? "enviado"
      : orcamentos?.[0]?.status;
  const statusProjeto = (orcProjetos ?? []).some((orcamento) => orcamento.status === "aprovado")
    ? "aprovado"
    : (orcProjetos ?? []).some((orcamento) => orcamento.status === "enviado")
      ? "enviado"
      : orcProjetos?.[0]?.status;
  const moduloAnalises = avaliarModuloOperacional({
    exigido: exigeAnalises,
    quantidadeItens: itensAnalises,
    statusDocumento: statusAnalises,
    pendenciaSemItens: "adicionar ao menos uma análise com custo",
  });
  const moduloProjeto = avaliarModuloOperacional({
    exigido: exigeProjeto,
    quantidadeItens: itensProjeto,
    statusDocumento: statusProjeto,
    pendenciaSemItens: "adicionar ao menos um custo, análise de projeto ou justificativa",
  });
  const projetoReferencia = orcProjetos?.at(-1);
  const consolidado = consolidarOrcamentoFinal({
    laboratorioExigido: exigeAnalises,
    projetoExigido: exigeProjeto,
    laboratorioRevisado: moduloAnalises.status === "revisado" || moduloAnalises.status === "nao_exigido",
    projetoRevisado: moduloProjeto.status === "revisado" || moduloProjeto.status === "nao_exigido",
    itensLaboratorio: (orcamentos ?? []).flatMap((orcamento) => orcamento.orcamento_itens ?? []),
    itensProjeto: [
      ...(orcProjetos ?? []).flatMap((orcamento) => orcamento.orcamento_projeto_custos ?? []),
      ...(orcProjetos ?? []).flatMap((orcamento) => orcamento.orcamento_projeto_analises ?? []).map((item) => ({
        rubrica: "MC",
        quantidade: Number(item.n_amostras),
        custo_unitario: Number(item.custo_unitario),
        preco_unitario: Number(item.preco_unitario),
        meses_selecionados: [],
      })),
    ],
    // com projeto: percentuais do projeto; sem projeto: os da proposta ou os padrões (0118)
    parametrosProjeto: resolverParametrosProposta({
      projeto: projetoReferencia,
      proposta: demanda as Record<string, unknown>,
      padroes: padroesDeParametrosGlobais((await supabase.from("parametros").select("chave, valor")).data),
    }).rates,
  });

  if (!consolidado.pronto) {
    redirect(`${listaPath}/${id}?etapa=final&erro_emissao=${encodeURIComponent(consolidado.pendencias.join("; "))}`);
  }

  // Σ parâmetros = 0: a proposta sairia pelo custo técnico, sem impostos nem
  // lucro. Só emite com confirmação explícita do formulário.
  if (consolidado.somaPercentual <= 0 && String(formData.get("confirmar_sem_parametros") ?? "") !== "sim") {
    const msg = "Nenhum parâmetro econômico definido: a proposta sairia pelo custo técnico, sem impostos nem lucro. Confirme para emitir assim.";
    redirect(`${listaPath}/${id}?etapa=final&erro_emissao=${encodeURIComponent(msg)}`);
  }

  // Validação defensiva (Fase 10): bloqueia emissão com custo técnico <= 0 sem
  // justificativa de isenção. Não altera dados — apenas impede a emissão.
  const custosZero = detectarCustosZero({
    itensLaboratorio: (orcamentos ?? []).flatMap((o) => o.orcamento_itens ?? []),
    custosProjeto: (orcProjetos ?? []).flatMap((o) => o.orcamento_projeto_custos ?? []),
    analisesProjeto: (orcProjetos ?? []).flatMap((o) => o.orcamento_projeto_analises ?? []),
    projetoTemJustificativa: (orcProjetos ?? []).some((o) => Boolean(o.projeto_sem_custo_justificativa)),
  });
  if (custosZero.length > 0) {
    const msg = `Itens com custo técnico zero sem justificativa: ${custosZero.map((c) => c.descricao).join(", ")}.`;
    redirect(`${listaPath}/${id}?etapa=final&erro_emissao=${encodeURIComponent(msg)}`);
  }

  // Snapshot completo (engine autoritativa) e payload de parâmetros aplicados.
  // O cálculo já foi feito/validado em TS; a RPC só PERSISTE atomicamente.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id || !user.email) {
    redirect(`${listaPath}/${id}?etapa=final&erro_emissao=${encodeURIComponent("Sua sessão expirou. Entre de novo para emitir a proposta.")}`);
  }
  const economia = consolidado.economia;

  const snapshot = {
    demanda,
    orcamentos_analises: (orcamentos ?? []).map((orcamento) => ({
      ...orcamento,
      fonte_custo_insumos: orcamento.fonte_custo_insumos,
      custo_snapshot: orcamento.custo_snapshot,
    })),
    orcamentos_projeto: orcProjetos ?? [],
    consolidado,
  } satisfies Json;

  const parametrosPayload: Json | null = economia.valido
    ? {
        orcamento_laboratorial_id: orcamentos?.at(-1)?.id ?? null,
        orcamento_projeto_id: projetoReferencia?.id ?? null,
        metodo_calculo: "GROSS_UP",
        laboratorio_modo: "CUSTO_TECNICO",
        subtotal_laboratorio: economia.custoLaboratorioTecnico,
        subtotal_projeto: economia.custoDiretoProjeto,
        subtotal_custos: economia.subtotal,
        total_parametros: economia.totalParametros,
        total_final: economia.totalFinal,
        parametros_snapshot: economia.parametros,
        formula_snapshot: {
          politica: economia.politica,
          formula: economia.formula,
          somaPercentual: economia.somaPercentual,
          fatorGrossUp: economia.fatorGrossUp,
          origens: consolidado.origens,
        },
        alertas_snapshot: economia.alertas,
      }
    : null;

  // Persistência ATÔMICA: substituição da versão anterior, nova versão,
  // parâmetros, status da demanda e auditoria — tudo em uma transação com lock
  // por demanda (próxima versão calculada dentro da RPC).
  const { data: resultado, error } = await supabase.rpc("emitir_orcamento_final_transacional", {
    p_demanda_id: id,
    p_validade_dias: validadeDias,
    p_total_laboratorio_custo: consolidado.totalLaboratorioCusto,
    p_total_laboratorio_preco: consolidado.totalLaboratorioPreco,
    p_total_projeto_custo: consolidado.totalProjetoCusto,
    p_total_projeto_final: consolidado.totalProjetoFinal,
    p_total_final: consolidado.totalFinal,
    p_snapshot: snapshot,
    p_parametros: parametrosPayload,
    p_criado_por: user.id,
    p_usuario_email: user.email,
    p_operacao_id: operacaoId,
  });
  if (error) {
    redirect(`${listaPath}/${id}?etapa=final&erro_emissao=${encodeURIComponent(`Falha ao emitir: ${mensagemDoBanco(error)}`)}`);
  }
  void resultado;

  revalidatePath(listaPath);
  revalidatePath(`${listaPath}/${id}`);
  revalidatePath("/orcamento");
  redirect(`${listaPath}/${id}?etapa=final`);
}

function registro(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function provenienciasDimensionaisValidas(value: unknown, exigida: boolean) {
  return Array.isArray(value)
    && (!exigida || value.length > 0)
    && value.every(provenienciaDimensionalValida);
}

function provenienciaDimensionalValida(value: unknown) {
  const proveniencia = registro(value);
  if (!proveniencia) return false;
  const textos = [
    proveniencia.unidade_estoque,
    proveniencia.unidade_consumo,
    proveniencia.fonte_custo,
    proveniencia.referencia_custo,
  ];
  const valores = [
    proveniencia.fator_conversao,
    proveniencia.custo_unitario_estoque,
    proveniencia.custo_unitario_consumo,
    proveniencia.quantidade_consumo,
    proveniencia.quantidade_estoque,
  ];
  if (textos.some((item) => typeof item !== "string" || !item.trim())
    || valores.some((item) => item == null || item === "")) return false;

  const insumoId = Number(proveniencia.insumo_id);
  const [fator, custoEstoque, custoConsumo, quantidadeConsumo, quantidadeEstoque] = valores.map(Number);
  const aproximadamenteIgual = (atual: number, esperado: number) => (
    Math.abs(atual - esperado) <= 1e-9 * Math.max(1, Math.abs(atual), Math.abs(esperado))
  );
  return Number.isInteger(insumoId) && insumoId > 0
    && Number.isFinite(fator) && fator > 0
    && Number.isFinite(custoEstoque) && custoEstoque >= 0
    && Number.isFinite(custoConsumo) && custoConsumo >= 0
    && Number.isFinite(quantidadeConsumo) && quantidadeConsumo > 0
    && Number.isFinite(quantidadeEstoque) && quantidadeEstoque > 0
    && aproximadamenteIgual(custoConsumo, custoEstoque / fator)
    && aproximadamenteIgual(quantidadeEstoque, quantidadeConsumo / fator);
}

export async function salvarParametrosEconomicosDaDemanda(formData: FormData) {
  const demandaId = numero(formData, "demanda_id");
  if (!demandaId) return;
  await exigirPapelOrcamento("editar_parametros");

  const patch = {
    impostos_legacy: numero(formData, "impostos_legacy"),
    incubacao: numero(formData, "incubacao"),
    reserva: numero(formData, "reserva"),
    investimentos: numero(formData, "investimentos"),
    lucro: numero(formData, "lucro"),
  };

  const supabase = await createClient();
  const { data: projeto } = await supabase
    .from("orcamento_projetos")
    .select("id")
    .eq("demanda_id", demandaId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  const soma = Object.values(patch).reduce<number>((total, valor) => total + Math.max(0, Number(valor ?? 0)), 0);
  if (Object.values(patch).some((valor) => valor != null && valor < 0) || soma >= 100) {
    redirect(`${listaPath}/${demandaId}?etapa=parametros&erro_parametros=${encodeURIComponent("Use percentuais positivos com soma menor que 100%.")}`);
  }

  // Com orçamento de projeto, os percentuais continuam no projeto; sem ele
  // (proposta "Apenas análises"), ficam na própria proposta (migration 0118).
  const { data: gravado, error } = projeto?.id
    ? await supabase.from("orcamento_projetos").update(patch).eq("id", projeto.id).select("id")
    : await supabase
        .from("demandas_propostas")
        .update({
          param_impostos: patch.impostos_legacy ?? 0,
          param_incubacao: patch.incubacao ?? 0,
          param_reserva: patch.reserva ?? 0,
          param_investimentos: patch.investimentos ?? 0,
          param_lucro: patch.lucro ?? 0,
        } as never)
        .eq("id", demandaId)
        .select("id");
  if (error || !gravado?.length) {
    const msg = error
      ? /param_/.test(error.message) && /column|schema cache/i.test(error.message)
        ? "Parâmetros da proposta ainda não disponíveis no banco (migration 0118 pendente)."
        : error.message
      : "Nada foi salvo: seu perfil não tem permissão para alterar esta proposta.";
    redirect(`${listaPath}/${demandaId}?etapa=parametros&erro_parametros=${encodeURIComponent(msg)}`);
  }

  revalidatePath(listaPath);
  revalidatePath(`${listaPath}/${demandaId}`);
  redirect(`${listaPath}/${demandaId}?etapa=parametros&parametros_salvos=1`);
}
