"use server";

import { mensagemDoBanco } from "@/lib/erros";
import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createClientUntyped } from "@/lib/supabase/server";
import { usuarioAtual } from "@/lib/auth/roles";
import { pode } from "@/lib/auth/permissao-efetiva";
import { registrarEvento } from "./eventos";
import {
  PEDIDO_INTERNO_AGUARDANDO_CHEGADA,
  type PedidoInternoStatus,
} from "@/lib/pedido/status";
import type { FormState } from "./cadastros";

const SEM_PERMISSAO: FormState = {
  ok: false,
  message: "Seu perfil não tem permissão para esta etapa. Peça ao administrador para liberar em Usuários.",
};
const MSG_VALIDADE_CRITICO = "Validade é obrigatória para receber insumo crítico.";
const UUID_RECEBIMENTO = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const BUCKET_ANEXOS_PEDIDOS = "pedidos-internos-anexos";
const TAMANHO_MAXIMO_ANEXO = 15 * 1024 * 1024;
const MIME_TYPES_ANEXO = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function nomeArquivoSeguro(nome: string) {
  const normalizado = nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalizado.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "documento";
}

function texto(formData: FormData, campo: string) {
  return String(formData.get(campo) ?? "").trim() || null;
}

function numero(formData: FormData, campo: string) {
  const valor = formData.get(campo);
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function comentarioObrigatorio(formData: FormData) {
  const observacao = texto(formData, "observacao");
  if (!observacao) return { ok: false as const, message: "Informe o motivo/comentário para esta decisão." };
  return { ok: true as const, observacao };
}

function hojeData() {
  return new Date().toISOString().slice(0, 10);
}

function adicionarDiasData(dias: number | null) {
  if (!(dias && dias > 0)) return null;
  const data = new Date(Date.now() + dias * 86400000);
  return data.toISOString().slice(0, 10);
}

function erroSchemaCache(error: { message?: string; code?: string } | null | undefined) {
  return Boolean(
    error &&
      (error.code === "PGRST204" ||
        error.message?.includes("schema cache") ||
        error.message?.includes("Could not find the")),
  );
}

function normalizarCoordenadorProjeto(projeto: {
  coordenador?: string | null;
  coordenador_nome?: string | null;
  coordenador_email?: string | null;
} | null | undefined) {
  const email = projeto?.coordenador_email ?? (String(projeto?.coordenador ?? "").includes("@") ? projeto?.coordenador : null) ?? null;
  return {
    nome: projeto?.coordenador_nome ?? projeto?.coordenador ?? email ?? null,
    email,
  };
}

async function resolverCoordenadorProjeto(
  supabase: Awaited<ReturnType<typeof createClientUntyped>>,
  projetoId: number | null,
) {
  if (!projetoId) return { nome: null as string | null, email: null as string | null };

  const { data, error } = await supabase
    .from("projetos")
    .select("coordenador, coordenador_nome, coordenador_email")
    .eq("id", projetoId)
    .single();
  if (erroSchemaCache(error)) {
    const { data: legado, error: legadoError } = await supabase
      .from("projetos")
      .select("coordenador")
      .eq("id", projetoId)
      .single();
    if (legadoError) return { nome: null, email: null };
    return normalizarCoordenadorProjeto(legado);
  }

  if (error) return { nome: null, email: null };
  return normalizarCoordenadorProjeto(data);
}

async function coordenadorProjeto(pedidoId: number) {
  const supabase = await createClientUntyped();
  const { data, error } = await supabase
    .from("pedidos_internos")
    .select("projeto_id")
    .eq("id", pedidoId)
    .single();
  if (error || !data?.projeto_id) {
    return { projetoId: null, nome: null, email: null };
  }
  const coordenador = await resolverCoordenadorProjeto(supabase, Number(data.projeto_id));
  return {
    projetoId: data?.projeto_id as number | null | undefined,
    nome: coordenador.nome,
    email: coordenador.email,
  };
}

async function podeAprovarComoCoordenadorProjeto(pedidoId: number) {
  const u = await usuarioAtual();
  if (!u) return { ok: false as const, message: "Usuário não autenticado." };
  const coord = await coordenadorProjeto(pedidoId);
  const usuarioEmail = u.email?.toLowerCase() ?? null;
  const coordEmail = coord.email?.toLowerCase() ?? null;
  const emailConfere = Boolean(coordEmail && usuarioEmail && coordEmail === usuarioEmail);
  // A aprovação exige a permissão (o banco também exige, 0124). Ser o
  // coordenador do projeto só fica registrado; não substitui a permissão.
  if (!(await pode("pedido.aprovar"))) {
    return {
      ok: false as const,
      message: "Sem permissão: peça ao administrador a permissão “Aprovar pedidos internos” em Usuários.",
    };
  }

  return {
    ok: true as const,
    usuario: u,
    coordenadorNome: coord.nome,
    coordenadorEmail: coord.email,
    diferenteDoCoordenador: Boolean(coordEmail && !emailConfere),
  };
}

const STATUS_ITENS_LIVRES = ["rascunho", "ajuste_solicitante", "ajuste_compras"];
const STATUS_ITENS_VALIDACAO = ["em_validacao", "validado"];

/**
 * Itens mudam em rascunho/ajuste (quem cria pedidos) e, antes da
 * formalização, também na validação (quem aprova). Depois de formalizado, o
 * pedido precisa voltar para ajuste: a compra formal acompanha a lista.
 */
async function podeMexerItens(status: string) {
  if (STATUS_ITENS_LIVRES.includes(status)) return true;
  if (STATUS_ITENS_VALIDACAO.includes(status)) return pode("pedido.aprovar");
  return false;
}

async function mudarStatus({
  pedidoId,
  para,
  permitidoDe,
  observacao,
  etapa,
  decisao = "aprovado",
  dados = {},
}: {
  pedidoId: number;
  para: string;
  permitidoDe?: string[];
  observacao?: string | null;
  etapa?: string;
  decisao?: "aprovado" | "reprovado" | "devolvido" | "registrado";
  /** dados da etapa que a RPC grava (aprovador, instituição, protocolo…); datas vêm do banco */
  dados?: Record<string, string | boolean | null>;
}) {
  const supabase = await createClient();
  void permitidoDe;
  // Transição e dados da etapa (datas, aprovador, modalidade) gravados juntos
  // pela RPC; o app não atualiza a tabela direto.
  const { error } = await supabase.rpc("registrar_etapa_pedido_interno", {
    p_pedido_id: pedidoId,
    p_status_destino: para,
    p_etapa: etapa ?? para,
    p_decisao: decisao,
    p_observacao: observacao ?? undefined,
    p_dados: dados as never,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidatePath("/pedido");
  revalidatePath(`/pedido/${pedidoId}`);
  return { ok: true, message: "Etapa atualizada." };
}

export async function criarPedidoInterno(_prev: FormState, formData: FormData): Promise<FormState> {
  const u = await usuarioAtual();
  const titulo = texto(formData, "titulo") ?? "Pedido interno sem título";
  const projeto_id = numero(formData, "projeto_id");
  const data_necessidade = texto(formData, "data_necessidade");
  const justificativa = texto(formData, "justificativa");
  const urgencia = texto(formData, "urgencia") ?? "normal";
  const fonte_recurso = texto(formData, "fonte_recurso");
  const tipo_demanda = texto(formData, "tipo_demanda") ?? "laboratorio";
  const supabase = await createClientUntyped();
  let coordenador_projeto_nome: string | null = null;
  let coordenador_projeto_email: string | null = null;

  if (projeto_id) {
    const coordenador = await resolverCoordenadorProjeto(supabase, projeto_id);
    coordenador_projeto_nome = coordenador.nome;
    coordenador_projeto_email = coordenador.email;
  }

  const payload = {
    titulo,
    projeto_id,
    tipo_demanda,
    coordenador_projeto_nome,
    coordenador_projeto_email,
    data_necessidade,
    justificativa,
    urgencia,
    fonte_recurso,
    solicitante: u?.email ?? null,
  };
  let { data, error } = await supabase
    .from("pedidos_internos")
    .insert(payload)
    .select("id")
    .single();
  if (erroSchemaCache(error)) {
    const legado = {
      titulo,
      projeto_id,
      data_necessidade,
      justificativa,
      urgencia,
      fonte_recurso,
      solicitante: u?.email ?? null,
    };
    const retry = await supabase.from("pedidos_internos").insert(legado).select("id").single();
    data = retry.data;
    error = retry.error;
  }
  if (error) return { ok: false, message: mensagemDoBanco(error, "Não foi possível criar o pedido.") };
  if (!data) return { ok: false, message: "Não foi possível criar o pedido interno." };
  await registrarEvento("pedido_interno", data.id, null, "rascunho", "Pedido registrado.");
  revalidatePath("/pedido");
  redirect(`/pedido/${data.id}`);
}

type PedidoReposicaoState = FormState & { pedidoId?: number };

type PrevisaoReposicao = {
  insumo_id: number;
  especificacao: string | null;
  unidade: string | null;
  disponivel: number | null;
  ponto_reposicao_sugerido: number | null;
  qtd_sugerida_compra: number | null;
  qtd_pedida_aberta: number | null;
  fornecedor_nome?: string | null;
  custo_unitario: number | null;
  categoria_compra?: string | null;
  lead_time_dias?: number | null;
};

async function criarPedidoReposicao(
  itens: PrevisaoReposicao[],
  titulo: string,
  justificativa: string,
): Promise<PedidoReposicaoState> {
  const itensValidos = itens.filter((item) => Number(item.qtd_sugerida_compra ?? 0) > 0);
  if (itensValidos.length === 0) {
    return { ok: false, message: "Não há itens com reposição sugerida para gerar pedido." };
  }

  const supabase = await createClientUntyped();
  const maiorLeadTime = itensValidos.reduce((maior, item) => {
    const lead = Number(item.lead_time_dias ?? 0);
    return Number.isFinite(lead) && lead > maior ? lead : maior;
  }, 0);

  const { data, error } = await supabase.rpc("criar_pedido_reposicao_estoque" as never, {
    p_titulo: titulo,
    p_justificativa: justificativa,
    p_urgencia: itensValidos.some((item) => item.categoria_compra === "critico") ? "alta" : "normal",
    p_data_necessidade: adicionarDiasData(maiorLeadTime),
    p_itens: itensValidos.map((item) => ({
      insumo_id: item.insumo_id,
      quantidade: Number(item.qtd_sugerida_compra ?? 0),
    })),
  } as never);
  if (error) return { ok: false, message: mensagemDoBanco(error) };

  const resultado = data as unknown as { pedido_id?: number; itens?: number } | null;
  const pedidoId = Number(resultado?.pedido_id);
  const quantidadeItens = Number(resultado?.itens ?? itensValidos.length);
  if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
    return { ok: false, message: "Não foi possível criar o pedido de reposição." };
  }

  revalidatePath("/pedido");
  revalidatePath(`/pedido/${pedidoId}`);
  revalidatePath("/suprimentos");
  revalidatePath("/estoque");
  revalidatePath("/estoque/controle");

  return {
    ok: true,
    pedidoId,
    message: `Pedido ${pedidoId} criado em rascunho com ${quantidadeItens} item(ns) de reposição.`,
  };
}

export async function gerarPedidoReposicaoInsumo(
  _prev: PedidoReposicaoState,
  formData: FormData,
): Promise<PedidoReposicaoState> {
  void _prev;

  const insumoId = Number(formData.get("insumo_id"));
  if (!Number.isInteger(insumoId) || insumoId <= 0) {
    return { ok: false, message: "Insumo inválido para reposição." };
  }

  const supabase = await createClientUntyped();
  const { data, error } = await supabase
    .from("v_previsao_suprimentos")
    .select("insumo_id, especificacao, unidade, disponivel, ponto_reposicao_sugerido, qtd_sugerida_compra, qtd_pedida_aberta, fornecedor_nome, custo_unitario, categoria_compra, lead_time_dias")
    .eq("insumo_id", insumoId)
    .single();

  if (error) return { ok: false, message: mensagemDoBanco(error) };
  const previsao = data as PrevisaoReposicao | null;
  if (!previsao) return { ok: false, message: "Previsão de reposição não encontrada." };

  return criarPedidoReposicao(
    [previsao],
    `Reposição de estoque · ${previsao.especificacao ?? `Insumo #${insumoId}`}`,
    `Pedido gerado pelo Controle de Estoque porque o insumo #${insumoId} está abaixo do ponto de reposição sugerido.`,
  );
}

export async function gerarPedidosReposicaoEstoque(
  _prev: PedidoReposicaoState,
): Promise<PedidoReposicaoState> {
  void _prev;

  const supabase = await createClientUntyped();
  const { data, error } = await supabase
    .from("v_previsao_suprimentos")
    .select("insumo_id, especificacao, unidade, disponivel, ponto_reposicao_sugerido, qtd_sugerida_compra, qtd_pedida_aberta, fornecedor_nome, custo_unitario, categoria_compra, lead_time_dias")
    .gt("qtd_sugerida_compra", 0)
    .order("categoria_compra", { ascending: true })
    .order("especificacao", { ascending: true });

  if (error) return { ok: false, message: mensagemDoBanco(error) };

  return criarPedidoReposicao(
    (data ?? []) as PrevisaoReposicao[],
    `Reposição automática de estoque · ${hojeData()}`,
    "Pedido gerado pelo Controle de Estoque com os insumos abaixo do ponto de reposição sugerido. Revisar itens, projeto, fonte de recurso e justificativa antes de enviar para validação.",
  );
}

export async function atualizarPedidoInterno(_prev: FormState, formData: FormData): Promise<FormState> {
  const pedidoId = numero(formData, "pedido_interno_id");
  if (!pedidoId) return { ok: false, message: "Pedido não informado." };
  const titulo = texto(formData, "titulo");
  if (!titulo) return { ok: false, message: "Informe o título do pedido." };

  const supabase = await createClientUntyped();
  const projeto_id = numero(formData, "projeto_id");
  let coordenador_projeto_nome: string | null = null;
  let coordenador_projeto_email: string | null = null;
  if (projeto_id) {
    const coordenador = await resolverCoordenadorProjeto(supabase, projeto_id);
    coordenador_projeto_nome = coordenador.nome;
    coordenador_projeto_email = coordenador.email;
  }
  const payload = {
    titulo,
    projeto_id,
    tipo_demanda: texto(formData, "tipo_demanda") ?? "laboratorio",
    coordenador_projeto_nome,
    coordenador_projeto_email,
    data_necessidade: texto(formData, "data_necessidade"),
    urgencia: texto(formData, "urgencia") ?? "normal",
    fonte_recurso: texto(formData, "fonte_recurso"),
    justificativa: texto(formData, "justificativa"),
  };
  let { error } = await supabase
    .from("pedidos_internos")
    .update(payload)
    .eq("id", pedidoId);
  if (erroSchemaCache(error)) {
    const legado = {
      titulo,
      projeto_id,
      data_necessidade: texto(formData, "data_necessidade"),
      urgencia: texto(formData, "urgencia") ?? "normal",
      fonte_recurso: texto(formData, "fonte_recurso"),
      justificativa: texto(formData, "justificativa"),
    };
    const retry = await supabase.from("pedidos_internos").update(legado).eq("id", pedidoId);
    error = retry.error;
  }
  if (error) return { ok: false, message: mensagemDoBanco(error, "Não foi possível salvar.") };
  revalidatePath(`/pedido/${pedidoId}`);
  revalidatePath("/pedido");
  return { ok: true, message: "Pedido atualizado." };
}

export async function excluirPedidoInterno(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("pedido.aprovar"))) {
    return { ok: false, message: "Seu perfil não tem permissão para excluir pedidos internos." };
  }
  const pedidoId = numero(formData, "pedido_interno_id");
  if (!pedidoId) return { ok: false, message: "Pedido não informado." };

  const supabase = await createClient();
  const { data: pedido } = await supabase
    .from("pedidos_internos")
    .select("status, pedido_compra_id")
    .eq("id", pedidoId)
    .single();
  if (!pedido || pedido.status !== "rascunho" || pedido.pedido_compra_id) {
    return {
      ok: false,
      message: "Só é possível excluir rascunhos sem compra formal. Para pedidos em andamento, use Cancelar.",
    };
  }
  const { error } = await supabase.from("pedidos_internos").delete().eq("id", pedidoId);
  if (error) return { ok: false, message: mensagemDoBanco(error, "Não foi possível excluir.") };
  revalidatePath("/pedido");
  redirect("/pedido");
}

export async function adicionarItemPedidoInterno(_prev: FormState, formData: FormData): Promise<FormState> {
  const pedido_interno_id = numero(formData, "pedido_interno_id");
  const especificacao = texto(formData, "especificacao");
  const quantidade = numero(formData, "quantidade");
  if (!pedido_interno_id || !especificacao || !quantidade || quantidade <= 0) {
    return { ok: false, message: "Informe a especificação e uma quantidade maior que zero." };
  }

  const supabase = await createClient();
  const { data: pedido } = await supabase
    .from("pedidos_internos")
    .select("status")
    .eq("id", pedido_interno_id)
    .single();
  if (!pedido || !["rascunho", "ajuste_solicitante", "ajuste_compras"].includes(pedido.status)) {
    return { ok: false, message: "Itens só podem ser incluídos enquanto o pedido está em rascunho ou em ajuste." };
  }

  const { error } = await supabase.from("pedidos_internos_itens").insert({
    pedido_interno_id,
    tipo: texto(formData, "tipo") ?? "material",
    insumo_id: numero(formData, "insumo_id"),
    especificacao,
    modelo: texto(formData, "modelo"),
    volume: texto(formData, "volume"),
    quantidade,
    unidade: texto(formData, "unidade"),
    orcamento_previo: numero(formData, "orcamento_previo"),
    fornecedor_sugerido: texto(formData, "fornecedor_sugerido"),
    observacao: texto(formData, "observacao"),
  });
  if (error) return { ok: false, message: mensagemDoBanco(error, "Não foi possível adicionar o item.") };
  revalidatePath(`/pedido/${pedido_interno_id}`);
  return { ok: true, message: "Item adicionado." };
}

export async function editarItemPedidoInterno(formData: FormData) {
  const itemId = numero(formData, "item_id");
  const pedido_interno_id = numero(formData, "pedido_interno_id");
  const especificacao = texto(formData, "especificacao");
  const quantidade = numero(formData, "quantidade");
  if (!itemId || !pedido_interno_id || !especificacao || !quantidade || quantidade <= 0) return;

  const supabase = await createClient();
  const { data: pedido } = await supabase
    .from("pedidos_internos")
    .select("status")
    .eq("id", pedido_interno_id)
    .single();
  if (!pedido || !(await podeMexerItens(pedido.status))) return;

  const { error } = await supabase
    .from("pedidos_internos_itens")
    .update({
      tipo: texto(formData, "tipo") ?? "material",
      insumo_id: numero(formData, "insumo_id"),
      especificacao,
      modelo: texto(formData, "modelo"),
      volume: texto(formData, "volume"),
      quantidade,
      unidade: texto(formData, "unidade"),
      orcamento_previo: numero(formData, "orcamento_previo"),
      fornecedor_sugerido: texto(formData, "fornecedor_sugerido"),
      observacao: texto(formData, "observacao"),
    })
    .eq("id", itemId)
    .eq("pedido_interno_id", pedido_interno_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/pedido/${pedido_interno_id}`);
}

export async function removerItemPedidoInterno(_prev: FormState, formData: FormData): Promise<FormState> {
  const itemId = numero(formData, "item_id");
  const pedidoId = numero(formData, "pedido_interno_id");
  if (!itemId || !pedidoId) return { ok: false, message: "Item não informado." };
  const supabase = await createClient();
  const { data: pedido } = await supabase
    .from("pedidos_internos")
    .select("status")
    .eq("id", pedidoId)
    .single();
  if (!pedido || !(await podeMexerItens(pedido.status))) {
    return { ok: false, message: "Nesta etapa os itens não mudam. Depois da formalização, devolva o pedido para ajuste antes de alterar a lista." };
  }
  const { error } = await supabase
    .from("pedidos_internos_itens")
    .delete()
    .eq("id", itemId)
    .eq("pedido_interno_id", pedidoId);
  if (error) return { ok: false, message: mensagemDoBanco(error, "Não foi possível remover o item.") };
  revalidatePath(`/pedido/${pedidoId}`);
  return { ok: true, message: "Item removido." };
}

export async function enviarParaValidacao(_prev: FormState, formData: FormData): Promise<FormState> {
  const pedidoId = Number(formData.get("pedido_interno_id"));
  const supabase = await createClient();
  const [{ data: pedido }, { data: itens }] = await Promise.all([
    supabase
      .from("pedidos_internos")
      .select("projeto_id, justificativa, fonte_recurso, urgencia")
      .eq("id", pedidoId)
      .single(),
    supabase
      .from("pedidos_internos_itens")
      .select("id, especificacao, quantidade, unidade")
      .eq("pedido_interno_id", pedidoId),
  ]);
  if (!pedido?.projeto_id) return { ok: false, message: "Vincule o pedido a um projeto antes de enviar." };
  if (!pedido.justificativa) return { ok: false, message: "Informe a justificativa antes de enviar." };
  if (!pedido.fonte_recurso) return { ok: false, message: "Informe a fonte de recurso provável antes de enviar." };
  if (!pedido.urgencia) return { ok: false, message: "Informe a urgência antes de enviar." };
  if (!itens || itens.length === 0) {
    return { ok: false, message: "Inclua ao menos um material, serviço ou equipamento antes de enviar." };
  }
  if (itens.some((item) => !item.especificacao || !(Number(item.quantidade) > 0) || !item.unidade)) {
    return { ok: false, message: "Todos os itens precisam de especificação, quantidade e unidade." };
  }
  return mudarStatus({
    pedidoId,
    para: "em_validacao",
    permitidoDe: ["rascunho", "ajuste_solicitante", "ajuste_compras"],
    observacao: texto(formData, "observacao"),
    etapa: "Lista de materiais",
    decisao: "registrado",
  });
}

export async function validarInformacoes(_prev: FormState, formData: FormData): Promise<FormState> {
  const pedidoId = Number(formData.get("pedido_interno_id"));
  const permissao = await podeAprovarComoCoordenadorProjeto(pedidoId);
  if (!permissao.ok) return permissao;
  return mudarStatus({
    pedidoId,
    para: "validado",
    permitidoDe: ["em_validacao"],
    observacao: texto(formData, "observacao") ?? "Informações de modelo, volume e quantidade confirmadas.",
    etapa: "Validação das especificações técnicas",
    decisao: "aprovado",
    dados: {
      aprovador_coordenador: permissao.usuario.nome ?? permissao.usuario.email,
      coordenador_projeto_nome: permissao.coordenadorNome,
      coordenador_projeto_email: permissao.coordenadorEmail,
      aprovador_coordenador_diferente: permissao.diferenteDoCoordenador,
    },
  });
}

export async function devolverParaSolicitante(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("pedido.aprovar"))) return SEM_PERMISSAO;
  const comentario = comentarioObrigatorio(formData);
  if (!comentario.ok) return comentario;
  return mudarStatus({
    pedidoId: Number(formData.get("pedido_interno_id")),
    para: "ajuste_solicitante",
    permitidoDe: ["em_validacao"],
    observacao: comentario.observacao,
    etapa: "Validação das especificações técnicas",
    decisao: "devolvido",
  });
}

export async function formalizarPedidoInterno(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("pedido.aprovar"))) return SEM_PERMISSAO;
  const pedidoId = Number(formData.get("pedido_interno_id"));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("formalizar_pedido_interno" as never, {
    p_pedido_id: pedidoId,
  } as never);
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidatePath("/compras");
  revalidatePath("/pedido");
  revalidatePath(`/pedido/${pedidoId}`);
  const resultado = data as { pedido_compra_id?: number; retomada?: boolean } | null;
  return {
    ok: true,
    message: resultado?.retomada
      ? `Pedido formalizado de novo. A compra #${resultado.pedido_compra_id} continua valendo.`
      : "Pedido formalizado e compra criada.",
  };
}

export async function registrarAnaliseAdministrativa(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("pedido.aprovar"))) return SEM_PERMISSAO;
  const fonte_recurso = texto(formData, "fonte_recurso");
  const rubrica = texto(formData, "rubrica");
  const conformidade_admin = texto(formData, "conformidade_admin");
  if (!fonte_recurso || !rubrica || !conformidade_admin) {
    return { ok: false, message: "Fonte de recurso, rubrica e conformidade administrativa são obrigatórias." };
  }
  return mudarStatus({
    pedidoId: Number(formData.get("pedido_interno_id")),
    para: "analise_administrativa",
    permitidoDe: ["formalizado"],
    observacao: texto(formData, "observacao"),
    etapa: "Análise de fonte de recurso, rubrica e conformidade",
    decisao: "registrado",
    dados: { fonte_recurso, rubrica, conformidade_admin },
  });
}

export async function aprovarAnaliseAdministrativa(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("pedido.aprovar"))) return SEM_PERMISSAO;
  return mudarStatus({
    pedidoId: Number(formData.get("pedido_interno_id")),
    para: "aprovado_compra",
    permitidoDe: ["analise_administrativa"],
    observacao: texto(formData, "observacao") ?? "Fonte de recurso, rubrica e conformidades aprovadas.",
    etapa: "Liberação para cotação",
    decisao: "aprovado",
  });
}

export async function devolverParaCompras(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("pedido.aprovar"))) return SEM_PERMISSAO;
  const comentario = comentarioObrigatorio(formData);
  if (!comentario.ok) return comentario;
  return mudarStatus({
    pedidoId: Number(formData.get("pedido_interno_id")),
    para: "ajuste_compras",
    permitidoDe: ["analise_administrativa"],
    observacao: comentario.observacao,
    etapa: "Análise de fonte de recurso, rubrica e conformidade",
    decisao: "devolvido",
  });
}

export async function registrarLevantamentoOrcamentos(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("pedido.aprovar"))) return SEM_PERMISSAO;
  return mudarStatus({
    pedidoId: Number(formData.get("pedido_interno_id")),
    para: "orcamentos",
    permitidoDe: ["aprovado_compra"],
    observacao: texto(formData, "observacao") ?? "Cotações solicitadas com as especificações dos projetos.",
    etapa: "Levantamento de cotações",
    decisao: "registrado",
  });
}

export async function marcarOrcamentosRecebidos(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("pedido.aprovar"))) return SEM_PERMISSAO;
  const pedidoId = Number(formData.get("pedido_interno_id"));
  const supabase = await createClient();
  const { data: anexos } = await supabase
    .from("pedidos_internos_anexos")
    .select("id")
    .eq("pedido_interno_id", pedidoId)
    .in("tipo", ["orcamento_previo", "proposta", "print", "email"])
    .limit(1);
  if (!anexos || anexos.length === 0) {
    return { ok: false, message: "Anexe ao menos uma cotação (arquivo, print ou e-mail) antes de marcar como recebida." };
  }
  return mudarStatus({
    pedidoId,
    para: "orcamentos_recebidos",
    permitidoDe: ["orcamentos"],
    observacao: texto(formData, "observacao") ?? "Cotações recebidas e registradas.",
    etapa: "Cotações recebidas",
    decisao: "registrado",
  });
}

export async function enviarAprovacaoFinal(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("pedido.aprovar"))) return SEM_PERMISSAO;
  return mudarStatus({
    pedidoId: Number(formData.get("pedido_interno_id")),
    para: "aguardando_aprovacao_final",
    permitidoDe: ["orcamentos_recebidos"],
    observacao: texto(formData, "observacao") ?? "Pedido enviado para aprovação final.",
    etapa: "Aguardando aprovação final",
    decisao: "registrado",
  });
}

export async function aprovarCompraFinal(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("pedido.aprovar"))) return SEM_PERMISSAO;
  return mudarStatus({
    pedidoId: Number(formData.get("pedido_interno_id")),
    para: "aprovado_para_compra",
    permitidoDe: ["aguardando_aprovacao_final"],
    observacao: texto(formData, "observacao") ?? "Fornecedor/caminho de compra aprovado.",
    etapa: "Escolha do fornecedor ou encaminhamento institucional",
    decisao: "aprovado",
  });
}

export async function fecharComFornecedor(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("pedido.aprovar"))) return SEM_PERMISSAO;
  const u = await usuarioAtual();
  return mudarStatus({
    pedidoId: Number(formData.get("pedido_interno_id")),
    para: "compra_fechada",
    permitidoDe: ["aprovado_para_compra"],
    observacao: texto(formData, "observacao") ?? "Compra fechada com fornecedor; documentos enviados por e-mail.",
    etapa: "Fechamento da compra",
    decisao: "aprovado",
    dados: { modalidade_definida_por: u?.nome ?? u?.email ?? null },
  });
}

export async function encaminharInstituicao(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("pedido.aprovar"))) return SEM_PERMISSAO;
  const u = await usuarioAtual();
  const modalidade = texto(formData, "modalidade_compra") ?? "fundacao";
  const instituicao = texto(formData, "instituicao_destino");
  if (!["fundacao", "universidade", "outra"].includes(modalidade)) {
    return { ok: false, message: "Selecione Fundação, Universidade ou outra instituição." };
  }
  if (!instituicao) return { ok: false, message: "Informe a instituição de destino." };
  return mudarStatus({
    pedidoId: Number(formData.get("pedido_interno_id")),
    para: "encaminhado_instituicao",
    permitidoDe: ["aprovado_para_compra"],
    observacao:
      texto(formData, "observacao") ??
      "Documentos, orçamentos e termos encaminhados para a instituição responsável pela compra.",
    etapa: "Envio de documentos para instituição compradora",
    decisao: "aprovado",
    dados: {
      modalidade_compra: modalidade,
      modalidade_definida_por: u?.nome ?? u?.email ?? null,
      instituicao_destino: instituicao,
      protocolo_externo: texto(formData, "protocolo_externo"),
    },
  });
}

export async function marcarAguardandoPagamentoNf(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("pedido.aprovar"))) return SEM_PERMISSAO;
  return mudarStatus({
    pedidoId: Number(formData.get("pedido_interno_id")),
    para: "aguardando_pagamento_nf",
    permitidoDe: ["compra_fechada", "encaminhado_instituicao"],
    observacao: texto(formData, "observacao") ?? "Aguardando pagamento, emissão de nota ou comprovante.",
    etapa: "Pagamento e documentos fiscais",
    decisao: "registrado",
  });
}

export async function concluirCompra(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("pedido.aprovar"))) return SEM_PERMISSAO;
  const pedidoId = Number(formData.get("pedido_interno_id"));
  const supabase = await createClient();
  const { data: anexos } = await supabase
    .from("pedidos_internos_anexos")
    .select("id")
    .eq("pedido_interno_id", pedidoId)
    .in("tipo", ["nota_fiscal", "boleto", "comprovante"])
    .limit(1);
  if (!anexos || anexos.length === 0) {
    return { ok: false, message: "Anexe nota fiscal, boleto ou comprovante antes de concluir." };
  }
  return mudarStatus({
    pedidoId,
    para: "compra_concluida",
    permitidoDe: ["aguardando_pagamento_nf"],
    observacao: texto(formData, "observacao") ?? "Compra concluída com documentos finais registrados.",
    etapa: "Compra concluída",
    decisao: "aprovado",
  });
}

/**
 * Recebimento por item: lança o item em estoque (lote para o insumo
 * correspondente) e marca o item como recebido. Exige um insumo cadastrado
 * vinculado ao item ou escolhido no recebimento. Só é permitido após a compra
 * ser aprovada.
 */
export async function receberItemPedidoInterno(_prev: FormState, formData: FormData): Promise<FormState> {
  const itemId = numero(formData, "item_id");
  const pedidoId = numero(formData, "pedido_interno_id");
  if (!itemId || !pedidoId) return { ok: false, message: "Item inválido." };
  const operacaoId = texto(formData, "operacao_id");
  if (!operacaoId || !UUID_RECEBIMENTO.test(operacaoId)) {
    return { ok: false, message: "Identificador da operação de recebimento inválido." };
  }
  const supabase = await createClient();
  const u = await usuarioAtual();

  const { data: item } = await supabase
    .from("pedidos_internos_itens")
    .select("id, insumo_id, quantidade, quantidade_recebida, unidade, especificacao, fornecedor_sugerido, orcamento_previo, recebido_em, pedidos_internos(status, projetos(nome))")
    .eq("id", itemId)
    .eq("pedido_interno_id", pedidoId)
    .single();
  if (!item) return { ok: false, message: "Item não encontrado." };

  const pedido = item.pedidos_internos as unknown as {
    status: string;
    projetos: { nome: string | null } | null;
  } | null;
  if (!pedido || !PEDIDO_INTERNO_AGUARDANDO_CHEGADA.includes(pedido.status as PedidoInternoStatus)) {
    return { ok: false, message: "Só é possível receber itens após a compra ser aprovada." };
  }

  const insumoId = numero(formData, "insumo_id") ?? item.insumo_id;
  if (!insumoId) {
    return { ok: false, message: "Vincule o item a um insumo cadastrado para lançar em estoque." };
  }
  const { data: insumoRecebido } = await supabase
    .from("insumos")
    .select("categoria_compra")
    .eq("id", insumoId)
    .single();
  const validade = texto(formData, "validade");
  if (insumoRecebido?.categoria_compra === "critico" && !validade) {
    return { ok: false, message: MSG_VALIDADE_CRITICO };
  }

  const quantidade = numero(formData, "quantidade") ?? Number(item.quantidade);
  if (!(quantidade > 0)) return { ok: false, message: "Quantidade recebida deve ser maior que zero." };
  const custo = numero(formData, "custo") ?? item.orcamento_previo;
  const fornecedor = texto(formData, "fornecedor") ?? item.fornecedor_sugerido;

  const responsavel = u?.nome ?? u?.email ?? null;
  const { error } = await supabase.rpc("receber_item_pedido_interno" as never, {
    p_pedido_id: pedidoId,
    p_item_id: itemId,
    p_insumo_id: insumoId,
    p_quantidade: quantidade,
    p_operacao_id: operacaoId,
    p_validade: validade ?? undefined,
    p_custo: custo ?? undefined,
    p_codigo: texto(formData, "codigo") ?? undefined,
    p_fornecedor: fornecedor ?? undefined,
    p_projeto: pedido.projetos?.nome ?? undefined,
    p_responsavel: responsavel ?? undefined,
  } as never);
  if (error) return { ok: false, message: mensagemDoBanco(error) };

  const { data: itemAtualizado } = await supabase
    .from("pedidos_internos_itens")
    .select("quantidade, quantidade_recebida, unidade")
    .eq("id", itemId)
    .eq("pedido_interno_id", pedidoId)
    .single();
  revalidatePath("/recebimento");
  revalidatePath("/estoque");
  revalidatePath("/pedido");
  revalidatePath(`/pedido/${pedidoId}`);
  if (!itemAtualizado) return { ok: true, message: "Recebimento registrado." };

  const totalRecebido = Number(itemAtualizado.quantidade_recebida ?? 0);
  const totalSolicitado = Number(itemAtualizado.quantidade);
  const parcial = totalRecebido < totalSolicitado;
  return {
    ok: true,
    message: parcial
      ? `Recebimento parcial registrado. Saldo pendente: ${totalSolicitado - totalRecebido} ${itemAtualizado.unidade ?? ""}.`
      : "Item recebido integralmente e lançado em estoque.",
  };
}

/**
 * Estorna o recebimento de um item: remove o lote gerado (se ainda intacto) e
 * desmarca o item. Bloqueia se o lote já teve consumo, para não corromper o saldo.
 */
export async function estornarRecebimentoItem(_prev: FormState, formData: FormData): Promise<FormState> {
  const itemId = numero(formData, "item_id");
  const pedidoId = numero(formData, "pedido_interno_id");
  if (!itemId || !pedidoId) return { ok: false, message: "Item inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("estornar_recebimento_item_pedido_interno" as never, {
    p_pedido_id: pedidoId,
    p_item_id: itemId,
    p_recebimento_id: null,
    p_motivo: "Estorno solicitado na tela de recebimento.",
  } as never);
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidatePath("/recebimento");
  revalidatePath("/estoque");
  revalidatePath("/pedido");
  revalidatePath(`/pedido/${pedidoId}`);
  return { ok: true, message: "Recebimento estornado." };
}

export async function estornarRecebimentoLancamento(_prev: FormState, formData: FormData): Promise<FormState> {
  const itemId = numero(formData, "item_id");
  const pedidoId = numero(formData, "pedido_interno_id");
  const recebimentoId = numero(formData, "recebimento_id");
  if (!itemId || !pedidoId || !recebimentoId) {
    return { ok: false, message: "Lançamento de recebimento inválido." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("estornar_recebimento_item_pedido_interno" as never, {
    p_pedido_id: pedidoId,
    p_item_id: itemId,
    p_recebimento_id: recebimentoId,
    p_motivo: "Estorno de lançamento solicitado na tela de recebimento.",
  } as never);
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidatePath("/recebimento");
  revalidatePath("/estoque");
  revalidatePath("/pedido");
  revalidatePath(`/pedido/${pedidoId}`);
  return { ok: true, message: "Lançamento de recebimento estornado." };
}

export async function adicionarAnexoPedidoInterno(_prev: FormState, formData: FormData): Promise<FormState> {
  const pedidoId = Number(formData.get("pedido_interno_id"));
  const arquivoForm = formData.get("arquivo");
  const arquivo = arquivoForm instanceof File && arquivoForm.size > 0 ? arquivoForm : null;
  const titulo = texto(formData, "titulo") ?? (arquivo ? arquivo.name : null);
  if (!pedidoId || !titulo) return { ok: false, message: "Informe o título do documento ou escolha um arquivo." };
  if (!((await pode("pedido.criar")) || (await pode("pedido.aprovar")))) {
    return { ok: false, message: "Seu perfil não tem permissão para registrar documentos." };
  }
  if (arquivo && arquivo.size > TAMANHO_MAXIMO_ANEXO) {
    return { ok: false, message: "O arquivo excede o limite de 15 MB." };
  }
  if (arquivo && arquivo.type && !MIME_TYPES_ANEXO.has(arquivo.type)) {
    return { ok: false, message: "Formato de arquivo não permitido. Envie PDF, imagem, DOCX ou XLSX." };
  }

  const u = await usuarioAtual();
  const supabase = await createClient();
  const { data: pedido } = await supabase.from("pedidos_internos").select("status").eq("id", pedidoId).single();
  let storagePath: string | null = null;
  let hashSha256: string | null = null;
  let arquivoNome: string | null = null;
  let mimeType: string | null = null;
  let tamanhoBytes: number | null = null;

  if (arquivo) {
    const bytes = Buffer.from(await arquivo.arrayBuffer());
    arquivoNome = nomeArquivoSeguro(arquivo.name);
    mimeType = arquivo.type || "application/octet-stream";
    tamanhoBytes = arquivo.size;
    hashSha256 = createHash("sha256").update(bytes).digest("hex");
    storagePath = `${pedidoId}/${randomUUID()}-${arquivoNome}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_ANEXOS_PEDIDOS)
      .upload(storagePath, bytes, { contentType: mimeType, upsert: false });
    if (uploadError) return { ok: false, message: mensagemDoBanco(uploadError, "Falha no envio do arquivo. Tente de novo.") };
  }

  let { error } = await supabase.from("pedidos_internos_anexos").insert({
    pedido_interno_id: pedidoId,
    etapa: pedido?.status ?? null,
    tipo: texto(formData, "tipo") ?? "outro",
    titulo,
    url: texto(formData, "url"),
    arquivo_nome: arquivoNome,
    storage_bucket: storagePath ? BUCKET_ANEXOS_PEDIDOS : null,
    storage_path: storagePath,
    mime_type: mimeType,
    tamanho_bytes: tamanhoBytes,
    hash_sha256: hashSha256,
    observacao: texto(formData, "observacao"),
    usuario: u?.email ?? null,
  } as never);
  if (error && storagePath) {
    await supabase.storage.from(BUCKET_ANEXOS_PEDIDOS).remove([storagePath]);
  }
  if (erroSchemaCache(error)) {
    const retry = await supabase.from("pedidos_internos_anexos").insert({
      pedido_interno_id: pedidoId,
      etapa: pedido?.status ?? null,
      tipo: texto(formData, "tipo") ?? "outro",
      titulo,
      url: texto(formData, "url"),
      observacao: texto(formData, "observacao"),
      usuario: u?.email ?? null,
    });
    error = retry.error;
  }
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidatePath(`/pedido/${pedidoId}`);
  return { ok: true, message: "Documento registrado." };
}

export async function removerAnexoPedidoInterno(_prev: FormState, formData: FormData): Promise<FormState> {
  const anexoId = Number(formData.get("anexo_id"));
  const pedidoId = Number(formData.get("pedido_interno_id"));
  if (!anexoId || !pedidoId) return { ok: false, message: "Documento não informado." };
  if (!((await pode("pedido.criar")) || (await pode("pedido.aprovar")))) {
    return { ok: false, message: "Seu perfil não tem permissão para remover documentos." };
  }
  const supabase = await createClient();
  const { data: anexo } = await supabase
    .from("pedidos_internos_anexos")
    .select("storage_bucket, storage_path")
    .eq("id", anexoId)
    .eq("pedido_interno_id", pedidoId)
    .single();
  if (anexo?.storage_bucket && anexo.storage_path) {
    const { error: storageError } = await supabase.storage
      .from(anexo.storage_bucket)
      .remove([anexo.storage_path]);
    if (storageError) return { ok: false, message: mensagemDoBanco(storageError, "Falha ao remover o arquivo. Tente de novo.") };
  }
  const { error } = await supabase.from("pedidos_internos_anexos").delete().eq("id", anexoId);
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidatePath(`/pedido/${pedidoId}`);
  return { ok: true, message: "Documento removido." };
}

export async function registrarComunicacaoPedidoInterno(_prev: FormState, formData: FormData): Promise<FormState> {
  const pedidoId = Number(formData.get("pedido_interno_id"));
  if (!pedidoId) return { ok: false, message: "Pedido não informado." };
  const u = await usuarioAtual();
  const supabase = await createClient();
  const { data: pedido } = await supabase.from("pedidos_internos").select("status").eq("id", pedidoId).single();
  const { error } = await supabase.from("pedidos_internos_comunicacoes").insert({
    pedido_interno_id: pedidoId,
    etapa: pedido?.status ?? null,
    tipo: texto(formData, "tipo") ?? "email",
    remetente: texto(formData, "remetente") ?? "giacompras2025@gmail.com",
    destinatarios: texto(formData, "destinatarios"),
    assunto: texto(formData, "assunto"),
    referencia: texto(formData, "referencia"),
    observacao: texto(formData, "observacao"),
    usuario: u?.email ?? null,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidatePath(`/pedido/${pedidoId}`);
  return { ok: true, message: "Comunicação registrada." };
}

export async function cancelarPedidoInterno(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("compras.cancelar"))) return SEM_PERMISSAO;
  const comentario = comentarioObrigatorio(formData);
  if (!comentario.ok) return comentario;
  const pedidoId = Number(formData.get("pedido_interno_id"));
  const u = await usuarioAtual();
  const supabase = await createClient();
  const { data: atual } = await supabase
    .from("pedidos_internos")
    .select("status")
    .eq("id", pedidoId)
    .single();
  const { error } = await supabase.rpc("cancelar_pedido_interno_operacional" as never, {
    p_pedido_id: pedidoId,
    p_responsavel: u?.nome ?? u?.email ?? null,
    p_observacao: comentario.observacao,
  } as never);
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  await registrarEvento("pedido_interno", pedidoId, atual?.status ?? null, "cancelado", comentario.observacao);
  revalidatePath("/pedido");
  revalidatePath(`/pedido/${pedidoId}`);
  revalidatePath("/compras");
  return { ok: true, message: "Pedido cancelado com sincronização operacional." };
}
