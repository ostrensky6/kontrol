"use server";

import { mensagemDoBanco } from "@/lib/erros";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./cadastros";
import { usuarioAtual } from "@/lib/auth/roles";
import { MOTIVOS_BAIXA, montarMotivoBaixa, normalizarModelo } from "@/lib/estoque/baixa";

const schema = z.object({
  insumo_id: z.preprocess((v) => Number(v), z.number().int().positive()),
  quantidade: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number({ error: "Obrigatório" }).positive("Deve ser > 0"),
  ),
  validade: z.preprocess(
    (v) => (v === "" || v == null ? null : String(v)),
    z.string().nullable(),
  ),
  custo: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().min(0).nullable(),
  ),
  codigo: z.preprocess((v) => (v === "" || v == null ? null : String(v)), z.string().nullable()),
  fornecedor: z.preprocess((v) => (v === "" || v == null ? null : String(v)), z.string().nullable()),
  motivo: z.preprocess((v) => (v === "" || v == null ? null : String(v)), z.string().nullable()),
});

const baixaManualSchema = z.object({
  lote_id: z.preprocess((v) => Number(v), z.number().int().positive()),
  quantidade: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number({ error: "Obrigatório" }).positive("Deve ser > 0"),
  ),
  motivo: z.preprocess(
    (v) => (v === "" || v == null ? undefined : String(v).trim()),
    z.string({ error: "Obrigatório" }).min(3, "Informe o motivo"),
  ),
});

const corrigirQuantidadeSchema = z.object({
  insumo_id: z.preprocess((v) => Number(v), z.number().int().positive()),
  quantidade_alvo: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z
      .number({ error: "Obrigatório" })
      .refine((n) => Number.isInteger(n), "Use um número inteiro de embalagens")
      .refine((n) => n >= 0, "Deve ser >= 0"),
  ),
  motivo: z.preprocess(
    (v) => (v === "" || v == null ? undefined : String(v).trim()),
    z.string({ error: "Obrigatório" }).min(3, "Informe o motivo"),
  ),
  operacao_id: z.preprocess(
    (v) => (v ? String(v) : crypto.randomUUID()),
    z.string().min(1),
  ),
});

const ajusteSaldoSchema = z.object({
  lote_id: z.preprocess((v) => Number(v), z.number().int().positive()),
  quantidade_nova: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number({ error: "Obrigatório" }).min(0, "Deve ser >= 0"),
  ),
  motivo: z.preprocess(
    (v) => (v === "" || v == null ? undefined : String(v).trim()),
    z.string({ error: "Obrigatório" }).min(3, "Informe o motivo"),
  ),
});

const estornoSchema = z.object({
  lote_id: z.preprocess((v) => Number(v), z.number().int().positive()),
  motivo: z.preprocess(
    (v) => (v === "" || v == null ? undefined : String(v).trim()),
    z.string({ error: "Obrigatório" }).min(3, "Informe o motivo"),
  ),
});

function formErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const i of error.issues) {
    const p = String(i.path[0] ?? "");
    if (p && !errors[p]) errors[p] = i.message;
  }
  return errors;
}

/**
 * 2.4 — Entrada de inventário / ajuste (porta avulsa, EXPLÍCITA). O recebimento
 * "normal" de compra acontece pelo item do pedido (receberItemPedido). Aqui é a
 * entrada sem pedido (contagem, doação, correção), com motivo próprio na trilha.
 */
export async function entradaInventario(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = schema.safeParse({
    insumo_id: formData.get("insumo_id"),
    quantidade: formData.get("quantidade"),
    validade: formData.get("validade"),
    custo: formData.get("custo"),
    codigo: formData.get("codigo"),
    fornecedor: formData.get("fornecedor"),
    motivo: formData.get("motivo"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", errors: formErrors(parsed.error) };
  }

  const d = parsed.data;
  const supabase = await createClient();
  const { data: insumo } = await supabase
    .from("insumos")
    .select("categoria_compra")
    .eq("id", d.insumo_id)
    .single();
  if (insumo?.categoria_compra === "critico" && !d.validade) {
    return {
      ok: false,
      message: "Validade é obrigatória para insumo crítico.",
      errors: { validade: "Obrigatório para crítico" },
    };
  }
  // Idempotente: o mesmo formulário enviado duas vezes não cria dois lotes.
  const operacaoRecebida = String(formData.get("operacao_id") ?? "");
  const operacaoId = UUID_RE.test(operacaoRecebida) ? operacaoRecebida : crypto.randomUUID();
  const localId = Number(formData.get("local_id"));
  const { data, error } = await supabase.rpc("entrada_inventario", {
    p_insumo_id: d.insumo_id,
    p_quantidade: d.quantidade,
    p_operacao_id: operacaoId,
    p_validade: d.validade ?? undefined,
    p_custo: d.custo ?? undefined,
    p_codigo: d.codigo ?? undefined,
    p_fornecedor: d.fornecedor ?? undefined,
    p_motivo: d.motivo ?? undefined,
    p_local_id: Number.isInteger(localId) && localId > 0 ? localId : undefined,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };

  revalidatePath("/estoque");
  const resultado = data as { modelo?: string; quantidade?: number } | null;
  const emFrascos = resultado?.modelo === "EMBALAGEM_FECHADA";
  return {
    ok: true,
    message: emFrascos
      ? `Entrada registrada: ${resultado?.quantidade ?? d.quantidade} frasco(s) em quarentena.`
      : "Entrada de inventário registrada (lote em quarentena).",
  };
}

async function rpcLote(
  fn: string,
  args: Record<string, unknown>,
): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn as never, args as never);
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidatePath("/estoque");
  return { ok: true };
}

export async function aceitarLote(formData: FormData): Promise<FormState> {
  const u = await usuarioAtual();
  return rpcLote("aceitar_lote", {
    p_lote_id: Number(formData.get("lote_id")),
    p_responsavel: (formData.get("responsavel") as string) || u?.nome || u?.email || null,
    p_criterio: (formData.get("criterio") as string) || null,
  });
}

export async function bloquearLote(formData: FormData): Promise<FormState> {
  return rpcLote("bloquear_lote", {
    p_lote_id: Number(formData.get("lote_id")),
    p_motivo: (formData.get("motivo") as string) || "—",
  });
}

export async function desbloquearLote(formData: FormData): Promise<FormState> {
  return rpcLote("desbloquear_lote", { p_lote_id: Number(formData.get("lote_id")) });
}

export async function descartarLote(formData: FormData): Promise<FormState> {
  return rpcLote("descartar_lote", {
    p_lote_id: Number(formData.get("lote_id")),
    p_justificativa: (formData.get("justificativa") as string) || "—",
  });
}

export async function estornarRecebimentoLote(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = estornoSchema.safeParse({
    lote_id: formData.get("lote_id"),
    motivo: formData.get("motivo"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", errors: formErrors(parsed.error) };
  }

  const supabase = await createClient();
  const [recebimentoCompra, recebimentoInterno] = await Promise.all([
    supabase
      .from("pedidos_compra_item_recebimentos")
      .select("id")
      .eq("lote_id", parsed.data.lote_id)
      .limit(1),
    supabase
      .from("pedidos_internos_item_recebimentos")
      .select("id")
      .eq("lote_id", parsed.data.lote_id)
      .limit(1),
  ]);
  if (recebimentoCompra.error || recebimentoInterno.error) {
    return {
      ok: false,
      message: "Não foi possível confirmar a origem da entrada. Tente novamente.",
    };
  }
  if ((recebimentoCompra.data?.length ?? 0) > 0 || (recebimentoInterno.data?.length ?? 0) > 0) {
    // Lote de compra formal ou de pedido interno: estorno bilateral (lote,
    // livro, item e situação da compra/pedido na mesma transação).
    const { data, error } = await supabase.rpc("estornar_recebimento_do_lote", {
      p_lote_id: parsed.data.lote_id,
      p_motivo: parsed.data.motivo,
    });
    if (error) return { ok: false, message: mensagemDoBanco(error) };
    const resultado = data as { pedido_compra_id?: number; pedido_interno_id?: number; repetido?: boolean } | null;
    revalidatePath("/estoque");
    revalidatePath(`/estoque/lotes/${parsed.data.lote_id}`);
    revalidatePath("/recebimento");
    revalidatePath("/compras");
    revalidatePath("/pedido");
    if (resultado?.pedido_compra_id) revalidatePath(`/compras/${resultado.pedido_compra_id}`);
    if (resultado?.repetido) return { ok: true, message: "Este recebimento já estava estornado." };
    return {
      ok: true,
      message: resultado?.pedido_compra_id
        ? `Recebimento estornado. A compra #${resultado.pedido_compra_id} voltou a esperar esta quantidade.`
        : "Recebimento estornado. O pedido interno voltou a esperar esta quantidade.",
    };
  }

  const { error } = await supabase.rpc("estornar_recebimento_lote" as never, {
    p_lote_id: parsed.data.lote_id,
    p_motivo: parsed.data.motivo,
  } as never);
  if (error) return { ok: false, message: mensagemDoBanco(error) };

  revalidatePath("/estoque");
  revalidatePath(`/estoque/lotes/${parsed.data.lote_id}`);
  return { ok: true, message: "Entrada estornada." };
}

export async function baixarManualLote(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = baixaManualSchema.safeParse({
    lote_id: formData.get("lote_id"),
    quantidade: formData.get("quantidade"),
    motivo: formData.get("motivo"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", errors: formErrors(parsed.error) };
  }

  const supabase = await createClient();
  const operacaoRecebida = String(formData.get("operacao_id") ?? "");
  const { error } = await supabase.rpc("baixa_manual_lote" as never, {
    p_lote_id: parsed.data.lote_id,
    p_quantidade: parsed.data.quantidade,
    p_motivo: parsed.data.motivo,
    p_operacao_id: UUID_RE.test(operacaoRecebida) ? operacaoRecebida : crypto.randomUUID(),
  } as never);
  if (error) return { ok: false, message: mensagemDoBanco(error) };

  revalidatePath("/estoque");
  revalidatePath(`/estoque/lotes/${parsed.data.lote_id}`);
  return { ok: true, message: "Baixa manual registrada." };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const darBaixaSchema = z
  .object({
    lote_id: z.preprocess((v) => Number(v), z.number().int().positive()),
    quantidade: z.preprocess(
      (v) => (v === "" || v == null ? undefined : Number(String(v).replace(",", "."))),
      z
        .number({ error: "Informe a quantidade" })
        .refine((n) => Number.isFinite(n), "Número inválido")
        .refine((n) => n > 0, "Deve ser maior que zero"),
    ),
    quantidade_esperada: z.preprocess(
      (v) => (v === "" || v == null ? null : Number(v)),
      z.number().nullable(),
    ),
    motivo_tipo: z.preprocess(
      (v) => (v == null ? "" : String(v)),
      z.enum(MOTIVOS_BAIXA, { error: "Selecione o motivo" }),
    ),
    motivo_detalhe: z.preprocess((v) => (v == null ? "" : String(v).trim()), z.string()),
    operacao_id: z.preprocess(
      (v) => (typeof v === "string" && UUID_RE.test(v) ? v : crypto.randomUUID()),
      z.string(),
    ),
  })
  .superRefine((dados, ctx) => {
    if (dados.motivo_tipo === "Outro" && dados.motivo_detalhe.length < 3) {
      ctx.addIssue({ code: "custom", path: ["motivo_detalhe"], message: "Descreva o motivo" });
    }
  });

type DadosBaixa = z.infer<typeof darBaixaSchema>;

function lerBaixa(formData: FormData) {
  return darBaixaSchema.safeParse({
    lote_id: formData.get("lote_id"),
    quantidade: formData.get("quantidade"),
    quantidade_esperada: formData.get("quantidade_esperada"),
    motivo_tipo: formData.get("motivo_tipo"),
    motivo_detalhe: formData.get("motivo_detalhe"),
    operacao_id: formData.get("operacao_id"),
  });
}

function mensagemErro(error: unknown, padrao: string) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return padrao;
}

function revalidarBaixa(loteId: number) {
  revalidatePath("/estoque");
  revalidatePath("/estoque/controle");
  revalidatePath(`/estoque/lotes/${loteId}`);
  revalidatePath("/cadastros/insumos");
}

async function executarBaixaEmbalagens(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dados: DadosBaixa,
): Promise<FormState> {
  if (!Number.isInteger(dados.quantidade)) {
    return {
      ok: false,
      message: "Verifique os campos.",
      errors: { quantidade: "Use um número inteiro de embalagens" },
    };
  }
  if (dados.quantidade_esperada == null || !Number.isInteger(dados.quantidade_esperada)) {
    return { ok: false, message: "Saldo do lote desatualizado; recarregue a página e tente novamente." };
  }
  const { error } = await supabase.rpc("baixa_manual_embalagens" as never, {
    p_lote_id: dados.lote_id,
    p_quantidade: dados.quantidade,
    p_quantidade_esperada: dados.quantidade_esperada,
    p_operacao_id: dados.operacao_id,
    p_motivo: montarMotivoBaixa(dados.motivo_tipo, dados.motivo_detalhe),
  } as never);
  if (error) return { ok: false, message: mensagemErro(error, "Não foi possível registrar a baixa.") };

  revalidarBaixa(dados.lote_id);
  return {
    ok: true,
    message: `Baixa registrada: ${dados.quantidade} ${dados.quantidade === 1 ? "embalagem" : "embalagens"}.`,
  };
}

/**
 * Baixa manual de embalagens fechadas (lotes EMBALAGEM_FECHADA): quantidade
 * inteira, idempotente por operacao_id e com checagem do saldo esperado.
 * Nunca lança para a UI: devolve { ok, message }.
 */
export async function baixarEmbalagens(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = lerBaixa(formData);
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", errors: formErrors(parsed.error) };
  }
  try {
    const supabase = await createClient();
    return await executarBaixaEmbalagens(supabase, parsed.data);
  } catch (error) {
    return { ok: false, message: mensagemErro(error, "Não foi possível registrar a baixa.") };
  }
}

/**
 * "Dar baixa" em um lote: escolhe a RPC pelo modelo de quantidade gravado
 * no lote (embalagens fechadas → baixa_manual_embalagens; legado por volume
 * → baixa_manual_lote). Motivo obrigatório, sempre registrado na trilha.
 */
export async function darBaixaLote(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = lerBaixa(formData);
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", errors: formErrors(parsed.error) };
  }
  const dados = parsed.data;

  try {
    const supabase = await createClient();
    // modelo_quantidade (0109) ainda não está nos tipos gerados.
    const { data: lote, error: loteError } = await (supabase as unknown as SupabaseClient)
      .from("lotes_estoque")
      .select("id, modelo_quantidade")
      .eq("id", dados.lote_id)
      .single();
    if (loteError || !lote) return { ok: false, message: "Lote não encontrado." };

    const modelo = normalizarModelo((lote as { modelo_quantidade?: unknown }).modelo_quantidade);
    if (modelo === "EMBALAGEM_FECHADA") return await executarBaixaEmbalagens(supabase, dados);

    // operacao_id: o mesmo envio repetido não grava duas saídas (EST-5).
    const { error } = await supabase.rpc("baixa_manual_lote" as never, {
      p_lote_id: dados.lote_id,
      p_quantidade: dados.quantidade,
      p_motivo: montarMotivoBaixa(dados.motivo_tipo, dados.motivo_detalhe),
      p_operacao_id: dados.operacao_id,
    } as never);
    if (error) return { ok: false, message: mensagemErro(error, "Não foi possível registrar a baixa.") };

    revalidarBaixa(dados.lote_id);
    return { ok: true, message: "Baixa registrada." };
  } catch (error) {
    return { ok: false, message: mensagemErro(error, "Não foi possível registrar a baixa.") };
  }
}

/**
 * Correção autorizada e auditável da quantidade (embalagens fechadas) de um
 * insumo no fluxo novo — usada na edição do cadastro. Nunca sobrescreve o
 * saldo diretamente: aumento cria um lote de ajuste, redução baixa dos lotes
 * existentes; ambos com motivo obrigatório e trilha em eventos_status.
 */
export async function corrigirQuantidadeEmbalagens(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = corrigirQuantidadeSchema.safeParse({
    insumo_id: formData.get("insumo_id"),
    quantidade_alvo: formData.get("quantidade_alvo"),
    motivo: formData.get("motivo"),
    operacao_id: formData.get("operacao_id"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", errors: formErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("corrigir_quantidade_embalagens_fechadas" as never, {
    p_insumo_id: parsed.data.insumo_id,
    p_quantidade_alvo: parsed.data.quantidade_alvo,
    p_operacao_id: parsed.data.operacao_id,
    p_motivo: parsed.data.motivo,
  } as never);
  if (error) return { ok: false, message: mensagemDoBanco(error) };

  revalidatePath("/estoque");
  revalidatePath("/cadastros/insumos");
  return { ok: true, message: "Quantidade corrigida." };
}

export async function ajustarSaldoLote(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = ajusteSaldoSchema.safeParse({
    lote_id: formData.get("lote_id"),
    quantidade_nova: formData.get("quantidade_nova"),
    motivo: formData.get("motivo"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", errors: formErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("ajustar_saldo_lote" as never, {
    p_lote_id: parsed.data.lote_id,
    p_quantidade_nova: parsed.data.quantidade_nova,
    p_motivo: parsed.data.motivo,
  } as never);
  if (error) return { ok: false, message: mensagemDoBanco(error) };

  revalidatePath("/estoque");
  revalidatePath(`/estoque/lotes/${parsed.data.lote_id}`);
  return { ok: true, message: "Saldo do lote ajustado." };
}

const entradaEmbalagensSchema = z.object({
  insumo_id: z.preprocess((v) => Number(v), z.number().int().positive()),
  quantidade: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z
      .number({ error: "Obrigatório" })
      .refine((n) => Number.isInteger(n), "Use um número inteiro de embalagens")
      .refine((n) => n > 0, "Deve ser maior que zero"),
  ),
  validade: z.preprocess((v) => (v === "" || v == null ? null : String(v)), z.string().nullable()),
  custo: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(String(v).replace(",", "."))),
    z.number({ error: "Obrigatório" }).min(0, "Deve ser ≥ 0"),
  ),
  codigo: z.preprocess((v) => (v === "" || v == null ? null : String(v).trim()), z.string().max(80).nullable()),
  fornecedor: z.preprocess((v) => (v === "" || v == null ? null : String(v).trim()), z.string().nullable()),
  motivo: z.preprocess(
    (v) => (v === "" || v == null ? undefined : String(v).trim()),
    z.string({ error: "Obrigatório" }).min(3, "Informe o motivo"),
  ),
  operacao_id: z.string().uuid("Operação inválida; recarregue a página."),
});

/**
 * Entrada de um novo lote para insumo contado em embalagens fechadas
 * (registrar_entrada_manual_embalagens, 0109). Mantém o mesmo modelo de
 * contagem do insumo: o lote entra liberado e com número inteiro.
 */
export async function entradaEmbalagens(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = entradaEmbalagensSchema.safeParse({
    insumo_id: formData.get("insumo_id"),
    quantidade: formData.get("quantidade"),
    validade: formData.get("validade"),
    custo: formData.get("custo"),
    codigo: formData.get("codigo"),
    fornecedor: formData.get("fornecedor"),
    motivo: formData.get("motivo"),
    operacao_id: formData.get("operacao_id"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", errors: formErrors(parsed.error) };
  }

  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("registrar_entrada_manual_embalagens" as never, {
    p_insumo_id: d.insumo_id,
    p_quantidade_embalagens: d.quantidade,
    p_operacao_id: d.operacao_id,
    p_validade: d.validade,
    p_custo_total_embalagem: d.custo,
    p_codigo_lote: d.codigo,
    p_fornecedor: d.fornecedor,
    p_motivo: d.motivo,
  } as never);
  if (error) return { ok: false, message: mensagemDoBanco(error) };

  for (const path of ["/estoque", "/estoque/controle", "/suprimentos", "/cadastros/insumos", "/insumos"]) {
    revalidatePath(path);
  }
  return { ok: true, message: "Lote registrado e liberado para uso." };
}
