"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createClientUntyped } from "@/lib/supabase/server";
import { conferirEscrita, semLinhasAfetadas } from "@/lib/supabase/escrita";
import { usuarioAtual } from "@/lib/auth/roles";
import { computarDemandaPlano } from "@/lib/costing/demanda";
import {
  MENSAGEM_RESERVA_DESATUALIZADA,
  STATUS_EDITAVEIS,
  STATUS_PLANO_LABEL,
  statusEditavel,
} from "@/lib/planejamento/gestao";
import type { FormState } from "./cadastros";
import { falha, mensagemDoBanco, sucesso, type EstadoAcao } from "@/lib/erros";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type SupabaseUntyped = Awaited<ReturnType<typeof createClientUntyped>>;
type DemandaInsumo = Awaited<ReturnType<typeof computarDemandaPlano>>[number];
type Shortfall = { insumo_id: number; falta: number };

function texto(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value.length > 0 ? value : null;
}

function numeroOpcional(formData: FormData, key: string) {
  const value = Number(formData.get(key));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function erroSchemaCache(error: { message?: string; code?: string } | null | undefined) {
  return Boolean(
    error &&
      (error.code === "PGRST204" ||
        error.message?.includes("schema cache") ||
        error.message?.includes("Could not find the")),
  );
}

function parseShortfalls(value: unknown): Shortfall[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const insumoId = Number(row.insumo_id);
      const falta = Number(row.falta);
      return insumoId > 0 && falta > 0 ? { insumo_id: insumoId, falta } : null;
    })
    .filter((item): item is Shortfall => item !== null);
}

async function notificarFaltasPlano(
  supabase: SupabaseClient,
  planId: number,
  faltas: Array<DemandaInsumo & { falta: number }>,
  origem: "reserva" | "baixa",
) {
  if (faltas.length === 0) return;

  const titulo =
    origem === "reserva" ? "Falta de estoque no planejamento" : "Baixa com falta de estoque";
  const rows = faltas.map((item) => ({
    tipo: "falta_plano",
    titulo,
    corpo: `${item.especificacao}: falta ${item.falta} ${item.unidade ?? ""} no planejamento #${planId}.`,
    entidade_tipo: "planejamento",
    entidade_id: planId,
    papel_destino: "coordenador",
    dedupe_key: `falta_plano:${origem}:${planId}:${item.insumo_id}`,
  }));
  const keys = rows.map((row) => row.dedupe_key);
  const { data: existentes } = await supabase
    .from("notificacoes")
    .select("dedupe_key")
    .in("dedupe_key", keys);
  const keysExistentes = new Set((existentes ?? []).map((row) => row.dedupe_key));
  const novas = rows.filter((row) => !keysExistentes.has(row.dedupe_key));

  if (novas.length === 0) return;
  const { error } = await supabase.from("notificacoes").insert(novas as never);
  if (error && error.code !== "23505") throw new Error(error.message);
}

export async function criarPlano(formData: FormData) {
  const u = await usuarioAtual();
  const nome = String(formData.get("nome") ?? "").trim() || "Plano sem nome";
  const data_inicio_prevista = texto(formData, "data_inicio_prevista");
  const data_fim_prevista = texto(formData, "data_fim_prevista");
  const data_alvo = texto(formData, "data_alvo") ?? data_fim_prevista;
  const projeto_id = numeroOpcional(formData, "projeto_id");
  const prioridade = texto(formData, "prioridade") ?? "normal";
  const responsavel = texto(formData, "responsavel");
  const supabase = await createClientUntyped();
  let { data, error } = await supabase
    .from("planejamento")
    .insert({
      nome,
      data_alvo,
      data_inicio_prevista,
      data_fim_prevista,
      projeto_id,
      prioridade,
      responsavel,
      planejado_por: u?.nome ?? u?.email ?? null,
      origem_planejamento: "manual",
    })
    .select("id")
    .single();
  if (erroSchemaCache(error)) {
    const retry = await supabase
      .from("planejamento")
      .insert({
        nome,
        data_alvo,
        projeto_id,
        responsavel,
      })
      .select("id")
      .single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Não foi possível criar o planejamento.");
  redirect(`/planejamento/${data.id}`);
}

async function validarEquipamentosDoPlano(
  supabase: Awaited<ReturnType<typeof createClientUntyped>>,
  planId: number,
): Promise<string | null> {
  const { data: itens, error: itensError } = await supabase
    .from("planejamento_itens")
    .select("codigo_analise")
    .eq("planejamento_id", planId);
  if (itensError) return itensError.message;
  const codigos = [...new Set((itens ?? []).map((item) => item.codigo_analise).filter(Boolean))];
  if (codigos.length === 0) return "Adicione análises ao plano antes de iniciar.";

  const { data: vinculos, error: vinculosError } = await supabase
    .from("equipamento_analise")
    .select("equipamento_id")
    .in("codigo_analise", codigos);
  if (vinculosError) return vinculosError.message;
  const requeridos = [...new Set((vinculos ?? []).map((vinculo) => Number(vinculo.equipamento_id)).filter(Number.isFinite))];
  if (requeridos.length === 0) return null;

  const { data: reservas, error: reservasError } = await supabase
    .from("equipamento_reservas")
    .select("equipamento_unidade_id, equipamento_unidades(equipamento_id, ativo, status_operacional)")
    .eq("planejamento_id", planId)
    .in("status", ["reservado", "em_uso"]);
  if (reservasError) return reservasError.message;

  const cobertos = new Set<number>();
  for (const reserva of reservas ?? []) {
    const unidadeRaw = reserva.equipamento_unidades;
    const unidade = Array.isArray(unidadeRaw) ? unidadeRaw[0] : unidadeRaw;
    if (!unidade?.ativo || ["em_manutencao", "calibracao_vencida", "inativo", "descartado"].includes(String(unidade.status_operacional))) continue;
    cobertos.add(Number(unidade.equipamento_id));
  }
  const faltantes = requeridos.filter((equipamentoId) => !cobertos.has(equipamentoId));
  return faltantes.length > 0
    ? `Não é possível iniciar: ${faltantes.length} equipamento(s) exigido(s) pela análise não têm unidade operacional reservada para este plano.`
    : null;
}

function mensagemStatusBloqueado(status: string) {
  return `Plano ${STATUS_PLANO_LABEL[status] ?? status}: só é possível editar em rascunho ou reservado.`;
}

/** Status atual do plano, ou mensagem de erro pronta para a tela. */
async function statusDoPlano(
  supabase: SupabaseUntyped,
  planId: number,
): Promise<{ ok: true; status: string } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("planejamento")
    .select("status_operacional")
    .eq("id", planId)
    .maybeSingle();
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  if (!data) return { ok: false, message: "Planejamento não encontrado." };
  return { ok: true, status: String(data.status_operacional ?? "rascunho") };
}

/**
 * Pré-checagem amigável. A garantia real é o gatilho
 * trg_guardar_itens_planejamento_editavel (0111) e o filtro de status no UPDATE.
 */
async function planoEditavel(
  supabase: SupabaseUntyped,
  planId: number,
): Promise<{ ok: true; status: string } | { ok: false; message: string }> {
  const atual = await statusDoPlano(supabase, planId);
  if (!atual.ok) return atual;
  if (!statusEditavel(atual.status)) return { ok: false, message: mensagemStatusBloqueado(atual.status) };
  return atual;
}

function revalidarPlano(planId: number) {
  revalidatePath(`/planejamento/${planId}`);
  revalidatePath("/planejamento");
  revalidatePath("/suprimentos");
}

/**
 * Edita o contexto operacional. O UPDATE só alcança planos em rascunho ou
 * reservado; `.select()` comprova a linha alterada e, quando nada muda, a
 * resposta diz o porquê em vez de silenciar.
 */
export async function atualizarPlanejamentoExecutivo(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const planId = Number(formData.get("planejamento_id"));
  if (!planId) return { ok: false, message: "Planejamento inválido." };

  const data_inicio_prevista = texto(formData, "data_inicio_prevista");
  const data_fim_prevista = texto(formData, "data_fim_prevista");
  if (data_inicio_prevista && data_fim_prevista && data_fim_prevista < data_inicio_prevista) {
    return { ok: false, message: "O fim previsto não pode ser anterior ao início previsto." };
  }

  const u = await usuarioAtual();
  const supabase = await createClientUntyped();
  const basico = {
    nome: texto(formData, "nome") ?? "Plano sem nome",
    projeto_id: numeroOpcional(formData, "projeto_id"),
    data_alvo: texto(formData, "data_alvo") ?? data_fim_prevista,
    responsavel: texto(formData, "responsavel"),
    observacao: texto(formData, "observacao"),
  };
  let { data, error } = await supabase
    .from("planejamento")
    .update({
      ...basico,
      data_inicio_prevista,
      data_fim_prevista,
      prioridade: texto(formData, "prioridade") ?? "normal",
      planejado_por: u?.nome ?? u?.email ?? null,
    })
    .eq("id", planId)
    .in("status_operacional", [...STATUS_EDITAVEIS])
    .select("id");
  if (erroSchemaCache(error)) {
    // Schema antigo sem as colunas executivas: grava o básico, sem nunca
    // abrir mão do filtro de status.
    const retry = await supabase
      .from("planejamento")
      .update(basico)
      .eq("id", planId)
      .in("status_operacional", [...STATUS_EDITAVEIS])
      .select("id");
    data = retry.data;
    error = retry.error;
  }
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  if (semLinhasAfetadas(data)) {
    const atual = await planoEditavel(supabase, planId);
    return {
      ok: false,
      message: atual.ok
        ? "Nada foi salvo: seu perfil não tem permissão para editar este plano."
        : atual.message,
    };
  }

  revalidarPlano(planId);
  return { ok: true, message: "Contexto salvo." };
}

/** Reserva uma unidade física exigida pelas análises do próprio plano.
 * A RPC faz a checagem transacional de indisponibilidade e sobreposição; esta
 * camada também impede que o formulário reserve equipamento alheio ao escopo.
 */
export async function reservarEquipamentoDoPlano(_prev: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  const planId = Number(formData.get("planejamento_id"));
  const unidadeId = Number(formData.get("equipamento_unidade_id"));
  const inicio = texto(formData, "data_inicio");
  const fim = texto(formData, "data_fim");
  if (!planId || !unidadeId || !inicio || !fim) {
    return falha("Informe o equipamento e o período da reserva.");
  }

  const inicioDate = new Date(inicio);
  const fimDate = new Date(fim);
  if (Number.isNaN(inicioDate.getTime()) || Number.isNaN(fimDate.getTime()) || fimDate <= inicioDate) {
    return falha("Período de reserva inválido.");
  }

  const supabase = await createClientUntyped();
  const [{ data: plano, error: planoError }, { data: itens }, { data: unidade, error: unidadeError }] = await Promise.all([
    supabase
      .from("planejamento")
      .select("status_operacional, data_inicio_prevista, data_fim_prevista")
      .eq("id", planId)
      .single(),
    supabase
      .from("planejamento_itens")
      .select("codigo_analise")
      .eq("planejamento_id", planId),
    supabase
      .from("equipamento_unidades")
      .select("id, equipamento_id")
      .eq("id", unidadeId)
      .single(),
  ]);
  if (planoError) return falha(mensagemDoBanco(planoError));
  if (unidadeError || !unidade) return falha(unidadeError ? mensagemDoBanco(unidadeError) : "Equipamento não encontrado.");
  if (["cancelado", "concluido"].includes(String(plano?.status_operacional ?? ""))) {
    return falha("Não é possível reservar equipamento para um plano encerrado.");
  }
  if (!plano?.data_inicio_prevista || !plano?.data_fim_prevista) {
    return falha("Defina início e fim previstos do plano antes de reservar equipamentos.");
  }

  const inicioPlano = new Date(`${plano.data_inicio_prevista}T00:00:00`);
  const fimPlano = new Date(`${plano.data_fim_prevista}T23:59:59`);
  if (inicioDate < inicioPlano || fimDate > fimPlano) {
    return falha("A reserva do equipamento deve ficar dentro do período previsto do plano.");
  }

  const codigos = [...new Set((itens ?? []).map((item) => item.codigo_analise).filter(Boolean))];
  if (codigos.length === 0) return falha("Adicione análises ao plano antes de reservar equipamentos.");
  const { data: vinculos, error: vinculosError } = await supabase
    .from("equipamento_analise")
    .select("equipamento_id")
    .in("codigo_analise", codigos);
  if (vinculosError) return falha(mensagemDoBanco(vinculosError));
  const equipamentosPermitidos = new Set((vinculos ?? []).map((vinculo) => Number(vinculo.equipamento_id)));
  if (!equipamentosPermitidos.has(Number(unidade.equipamento_id))) {
    return falha("Este equipamento não está vinculado às análises do plano.");
  }

  const usuario = await usuarioAtual();
  const { error } = await supabase.rpc("reservar_equipamento_planejamento", {
    p_equipamento_unidade_id: unidadeId,
    p_planejamento_id: planId,
    p_data_inicio: inicioDate.toISOString(),
    p_data_fim: fimDate.toISOString(),
    p_responsavel: texto(formData, "responsavel") ?? usuario?.nome ?? usuario?.email ?? null,
    p_observacao: texto(formData, "observacao"),
  });
  if (error) return falha(mensagemDoBanco(error));

  revalidatePath(`/planejamento/${planId}`);
  revalidatePath("/planejamento");
  revalidatePath("/suprimentos");
  return sucesso("Equipamento reservado para o plano.");
}

type NumerosItem = {
  n_amostras: number;
  n_controles: number;
  repeticoes: number;
  perda_percentual: number;
};

function numeroCampo(formData: FormData, key: string, padrao: number) {
  const bruto = String(formData.get(key) ?? "").trim().replace(",", ".");
  return bruto === "" ? padrao : Number(bruto);
}

/** Lê e valida amostras, controles, repetições e % de perda de um item. */
function lerNumerosItem(
  formData: FormData,
): { ok: true; valores: NumerosItem } | { ok: false; message: string } {
  const n_amostras = numeroCampo(formData, "n_amostras", Number.NaN);
  const n_controles = numeroCampo(formData, "n_controles", 0);
  const repeticoes = numeroCampo(formData, "repeticoes", 1);
  const perda_percentual = numeroCampo(formData, "perda_percentual", 0);
  if (!Number.isFinite(n_amostras) || n_amostras <= 0) {
    return { ok: false, message: "Informe o número de amostras (maior que zero)." };
  }
  if (!Number.isFinite(n_controles) || n_controles < 0) {
    return { ok: false, message: "Controles não pode ser negativo." };
  }
  if (!Number.isFinite(repeticoes) || repeticoes < 1) {
    return { ok: false, message: "Repetições deve ser pelo menos 1." };
  }
  if (!Number.isFinite(perda_percentual) || perda_percentual < 0 || perda_percentual > 100) {
    return { ok: false, message: "% de perda deve ficar entre 0 e 100." };
  }
  return { ok: true, valores: { n_amostras, n_controles, repeticoes, perda_percentual } };
}

function sufixoReserva(status: string) {
  return status === "reservado" ? " Reserve os insumos de novo antes de iniciar." : "";
}

export async function adicionarItem(_prev: FormState, formData: FormData): Promise<FormState> {
  const planId = Number(formData.get("planejamento_id"));
  const codigo = String(formData.get("codigo_analise") ?? "").trim();
  if (!planId) return { ok: false, message: "Planejamento inválido." };
  if (!codigo) return { ok: false, message: "Selecione a análise." };
  const numeros = lerNumerosItem(formData);
  if (!numeros.ok) return numeros;

  const supabase = await createClientUntyped();
  const plano = await planoEditavel(supabase, planId);
  if (!plano.ok) return plano;
  // `.select()` é obrigatório: sob RLS uma escrita negada pode voltar sem
  // `error` e sem nenhuma linha afetada. Só a linha retornada comprova.
  const { data, error } = await supabase
    .from("planejamento_itens")
    .insert({ planejamento_id: planId, codigo_analise: codigo, ...numeros.valores })
    .select("id");
  const escrita = conferirEscrita(error, data, "Não foi possível adicionar a análise ao plano.");
  if (!escrita.ok) return escrita;
  revalidarPlano(planId);
  return { ok: true, message: `Análise adicionada.${sufixoReserva(plano.status)}` };
}

export async function atualizarItem(_prev: FormState, formData: FormData): Promise<FormState> {
  const itemId = Number(formData.get("item_id"));
  const planId = Number(formData.get("planejamento_id"));
  if (!itemId || !planId) return { ok: false, message: "Item inválido." };
  const numeros = lerNumerosItem(formData);
  if (!numeros.ok) return numeros;

  const supabase = await createClientUntyped();
  const plano = await planoEditavel(supabase, planId);
  if (!plano.ok) return plano;
  const { data, error } = await supabase
    .from("planejamento_itens")
    .update(numeros.valores)
    .eq("id", itemId)
    .eq("planejamento_id", planId)
    .select("id");
  const escrita = conferirEscrita(error, data, "Não foi possível salvar o item.");
  if (!escrita.ok) return escrita;
  revalidarPlano(planId);
  return { ok: true, message: `Item salvo.${sufixoReserva(plano.status)}` };
}

export async function removerItem(_prev: FormState, formData: FormData): Promise<FormState> {
  const itemId = Number(formData.get("item_id"));
  const planId = Number(formData.get("planejamento_id"));
  if (!itemId || !planId) return { ok: false, message: "Item inválido." };

  const supabase = await createClientUntyped();
  const plano = await planoEditavel(supabase, planId);
  if (!plano.ok) return plano;
  const { data, error } = await supabase
    .from("planejamento_itens")
    .delete()
    .eq("id", itemId)
    .eq("planejamento_id", planId)
    .select("id");
  const escrita = conferirEscrita(error, data, "Não foi possível remover o item.");
  if (!escrita.ok) return escrita;
  revalidarPlano(planId);
  return { ok: true, message: `Análise removida.${sufixoReserva(plano.status)}` };
}

export async function reservarPlano(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const planId = Number(formData.get("planejamento_id"));
  const supabase = await createClientUntyped();
  const { error: validacaoErr } = await supabase.rpc("validar_planejamento_executivo" as never, {
    p_planejamento_id: planId,
  } as never);
  if (validacaoErr) return { ok: false, message: mensagemDoBanco(validacaoErr) };

  const demanda = await computarDemandaPlano(supabase, planId);
  if (demanda.length === 0)
    return { ok: false, message: "Adicione análises ao plano antes de reservar." };

  const itens = demanda.map((d) => ({ insumo_id: d.insumo_id, quantidade: d.demanda }));
  const { data, error } = await supabase.rpc("reservar_plano", {
    p_planejamento_id: planId,
    p_itens: itens,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };

  const shortfalls = parseShortfalls((data as unknown as { shortfalls?: unknown } | null)?.shortfalls);
  const faltaPorInsumo = new Map<number, number>();
  for (const item of demanda.filter((d) => d.falta > 0)) {
    faltaPorInsumo.set(item.insumo_id, item.falta);
  }
  for (const item of shortfalls) {
    faltaPorInsumo.set(item.insumo_id, Math.max(faltaPorInsumo.get(item.insumo_id) ?? 0, item.falta));
  }
  const faltasPlano = demanda
    .filter((item) => faltaPorInsumo.has(item.insumo_id))
    .map((item) => ({ ...item, falta: faltaPorInsumo.get(item.insumo_id) ?? item.falta }));
  await notificarFaltasPlano(supabase, planId, faltasPlano, "reserva");
  revalidatePath(`/planejamento/${planId}`);
  revalidatePath("/notificacoes");
  revalidatePath("/");
  revalidatePath("/estoque");
  return {
    ok: true,
    message:
      faltasPlano.length > 0
        ? `Reservado com ${faltasPlano.length} insumo(s) em falta — veja a coluna Falta.`
        : "Insumos reservados.",
  };
}

export async function iniciarPlano(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const planId = Number(formData.get("planejamento_id"));
  const supabase = await createClientUntyped();
  // A baixa consome as reservas gravadas; itens alterados depois da reserva
  // exigem nova reserva (o gatilho de 0111 também recusa a transição).
  const { data: marca } = await supabase
    .from("planejamento")
    .select("reserva_desatualizada")
    .eq("id", planId)
    .maybeSingle();
  if (marca?.reserva_desatualizada) return { ok: false, message: MENSAGEM_RESERVA_DESATUALIZADA };

  const demanda = await computarDemandaPlano(supabase, planId);
  const faltasAntesDaBaixa = demanda.filter((d) => d.falta > 0);
  if (faltasAntesDaBaixa.length > 0) {
    await notificarFaltasPlano(supabase, planId, faltasAntesDaBaixa, "baixa");
    revalidatePath(`/planejamento/${planId}`);
    revalidatePath("/notificacoes");
    return {
      ok: false,
      message: `Não é possível iniciar: ${faltasAntesDaBaixa.length} insumo(s) ainda têm falta. Gere pedido, receba/libere lote ou replaneje antes da baixa.`,
    };
  }

  const bloqueioEquipamento = await validarEquipamentosDoPlano(supabase, planId);
  if (bloqueioEquipamento) {
    revalidatePath(`/planejamento/${planId}`);
    return { ok: false, message: bloqueioEquipamento };
  }

  const { data, error } = await supabase.rpc("dar_baixa_plano", {
    p_planejamento_id: planId,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };

  const shortfalls = parseShortfalls((data as { shortfalls?: unknown } | null)?.shortfalls);
  const faltaPorInsumo = new Map<number, number>();
  for (const item of demanda.filter((d) => d.falta > 0)) {
    faltaPorInsumo.set(item.insumo_id, item.falta);
  }
  for (const item of shortfalls) {
    faltaPorInsumo.set(item.insumo_id, Math.max(faltaPorInsumo.get(item.insumo_id) ?? 0, item.falta));
  }
  const faltasPlano = demanda
    .filter((item) => faltaPorInsumo.has(item.insumo_id))
    .map((item) => ({ ...item, falta: faltaPorInsumo.get(item.insumo_id) ?? item.falta }));
  await notificarFaltasPlano(supabase, planId, faltasPlano, "baixa");
  revalidatePath(`/planejamento/${planId}`);
  revalidatePath("/notificacoes");
  revalidatePath("/");
  revalidatePath("/estoque");
  return {
    ok: true,
    message:
      shortfalls.length > 0
        ? `Baixa concluída, mas ${shortfalls.length} insumo(s) ficaram sem estoque suficiente.`
        : "Análise iniciada — baixa definitiva concluída (FEFO).",
  };
}

export async function liberarPlano(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const planId = Number(formData.get("planejamento_id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("liberar_plano", { p_planejamento_id: planId });
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidatePath(`/planejamento/${planId}`);
  revalidatePath("/estoque");
  return { ok: true, message: "Reservas liberadas. O plano voltou para rascunho." };
}

export async function concluirPlano(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const planId = Number(formData.get("planejamento_id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("concluir_planejamento" as never, {
    p_planejamento_id: planId,
  } as never);
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidatePath(`/planejamento/${planId}`);
  revalidatePath("/planejamento");
  return { ok: true, message: "Planejamento concluído." };
}

function lerMotivo(formData: FormData) {
  const motivo = texto(formData, "motivo");
  return motivo && motivo.length >= 3 ? motivo : null;
}

function mensagemErroGestao(error: { message?: string; code?: string }, acao: "excluir" | "cancelar") {
  const message = error.message ?? "";
  if (error.code === "PGRST202" || message.includes("Could not find the function")) {
    return `Não foi possível ${acao}: o banco ainda não tem a migration 0111.`;
  }
  if (error.code === "42501" && message.includes("Sem permiss")) {
    return `Seu perfil não tem permissão para ${acao} planos. Peça ao administrador para liberar em Usuários.`;
  }
  return message || `Não foi possível ${acao} o plano.`;
}

/**
 * Exclusão física ("Excluir se não houve baixa" — 0111). A RPC
 * `excluir_planejamento` exige coordenador e motivo, recusa planos com baixa
 * de material ou pedido interno ativo, libera as reservas e grava a trilha
 * antes do DELETE. Com baixa, o caminho é `cancelarPlano`.
 */
export async function excluirPlano(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = Number(formData.get("planejamento_id"));
  if (!id) return { ok: false, message: "Planejamento inválido." };
  const motivo = lerMotivo(formData);
  if (!motivo) return { ok: false, message: "Informe o motivo da exclusão (mínimo 3 caracteres)." };

  const supabase = await createClientUntyped();
  const { data, error } = await supabase.rpc("excluir_planejamento", {
    p_planejamento_id: id,
    p_motivo: motivo,
  });
  if (error) return { ok: false, message: mensagemErroGestao(error, "excluir") };
  if (!data) {
    return { ok: false, message: "A exclusão não foi confirmada pelo banco. O planejamento foi preservado." };
  }

  revalidarPlano(id);
  revalidatePath("/estoque");
  // Excluído a partir da própria página do plano: sai dela no servidor, antes
  // que a página (agora inexistente) seja renderizada de novo.
  if (texto(formData, "redirecionar_para") === "/planejamento") {
    redirect(`/planejamento?excluido=${id}`);
  }
  const liberadas = Number((data as { reservas_liberadas?: unknown }).reservas_liberadas ?? 0);
  return {
    ok: true,
    message: liberadas > 0 ? `Plano excluído; ${liberadas} reserva(s) liberada(s).` : "Plano excluído.",
  };
}

/**
 * Cancelamento com motivo para planos que já tiveram baixa de material.
 * `cancelar_planejamento` (0111) registra o motivo e delega a
 * `cancelar_planejamento_operacional`, preservando o histórico.
 */
export async function cancelarPlano(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = Number(formData.get("planejamento_id"));
  if (!id) return { ok: false, message: "Planejamento inválido." };
  const motivo = lerMotivo(formData);
  if (!motivo) return { ok: false, message: "Informe o motivo do cancelamento (mínimo 3 caracteres)." };

  const supabase = await createClientUntyped();
  const { error } = await supabase.rpc("cancelar_planejamento", {
    p_planejamento_id: id,
    p_motivo: motivo,
  });
  if (error) return { ok: false, message: mensagemErroGestao(error, "cancelar") };

  revalidarPlano(id);
  revalidatePath("/estoque");
  return { ok: true, message: "Plano cancelado. O histórico foi preservado." };
}
