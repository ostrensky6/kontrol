"use server";

import { mensagemDoBanco } from "@/lib/erros";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { usuarioAtual } from "@/lib/auth/roles";
import { createClientUntyped } from "@/lib/supabase/server";
import {
  loteSugeridoFefo,
  validarConferenciaLote,
  type LoteConferencia,
} from "@/lib/planejamento/conferencia-lotes";
import type { FormState } from "./cadastros";

const conferenciaSchema = z.object({
  planejamento_id: z.preprocess((v) => Number(v), z.number().int().positive()),
  insumo_id: z.preprocess((v) => Number(v), z.number().int().positive()),
  lote_id: z.preprocess((v) => Number(v), z.number().int().positive()),
  quantidade_prevista: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number({ error: "Obrigatório" }).min(0, "Deve ser >= 0"),
  ),
  quantidade_conferida: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number({ error: "Obrigatório" }).min(0, "Deve ser >= 0"),
  ),
  justificativa: z.preprocess(
    (v) => (v === "" || v == null ? null : String(v).trim()),
    z.string().nullable(),
  ),
});

function formErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = String(issue.path[0] ?? "");
    if (path && !errors[path]) errors[path] = issue.message;
  }
  return errors;
}

function toLoteConferencia(row: {
  id: unknown;
  insumo_id: unknown;
  quantidade_atual: unknown;
  status: unknown;
  validade: unknown;
  validade_apos_abertura: unknown;
}): LoteConferencia {
  return {
    id: Number(row.id),
    insumoId: Number(row.insumo_id),
    quantidadeAtual: Number(row.quantidade_atual ?? 0),
    status: String(row.status ?? ""),
    validade: row.validade ? String(row.validade) : null,
    validadeAposAbertura: row.validade_apos_abertura ? String(row.validade_apos_abertura) : null,
  };
}

export async function registrarConferenciaLotePlanejamento(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = conferenciaSchema.safeParse({
    planejamento_id: formData.get("planejamento_id"),
    insumo_id: formData.get("insumo_id"),
    lote_id: formData.get("lote_id"),
    quantidade_prevista: formData.get("quantidade_prevista"),
    quantidade_conferida: formData.get("quantidade_conferida"),
    justificativa: formData.get("justificativa"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", errors: formErrors(parsed.error) };
  }

  const supabase = await createClientUntyped();
  const [{ data: plano }, { data: lote }, { data: lotesFefo }] = await Promise.all([
    supabase
      .from("planejamento")
      .select("id, status_operacional")
      .eq("id", parsed.data.planejamento_id)
      .maybeSingle(),
    supabase
      .from("lotes_estoque")
      .select("id, insumo_id, quantidade_atual, status, validade, validade_apos_abertura")
      .eq("id", parsed.data.lote_id)
      .maybeSingle(),
    supabase
      .from("lotes_estoque")
      .select("id, insumo_id, quantidade_atual, status, validade, validade_apos_abertura")
      .eq("insumo_id", parsed.data.insumo_id)
      .gt("quantidade_atual", 0),
  ]);

  if (!plano?.id || plano.status_operacional !== "reservado") {
    return { ok: false, message: "Conferência disponível apenas para planejamento reservado." };
  }
  if (!lote?.id) return { ok: false, message: "Lote não encontrado." };

  const loteValidado = toLoteConferencia(lote);
  const sugerido = loteSugeridoFefo((lotesFefo ?? []).map(toLoteConferencia));
  const validacao = validarConferenciaLote({
    lote: loteValidado,
    insumoEsperadoId: parsed.data.insumo_id,
    loteSugeridoId: sugerido?.id ?? null,
    justificativa: parsed.data.justificativa,
  });

  if (!validacao.ok) {
    return {
      ok: false,
      message: validacao.message,
      errors: validacao.status === "excecao_fefo" ? { justificativa: "Obrigatório" } : undefined,
    };
  }

  const usuario = await usuarioAtual();
  const { error } = await supabase.from("planejamento_lote_conferencias").insert({
    planejamento_id: parsed.data.planejamento_id,
    insumo_id: parsed.data.insumo_id,
    lote_id: parsed.data.lote_id,
    quantidade_prevista: parsed.data.quantidade_prevista,
    quantidade_conferida: parsed.data.quantidade_conferida,
    status: validacao.status,
    justificativa: parsed.data.justificativa,
    conferido_por: usuario?.email ?? usuario?.id ?? null,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };

  revalidatePath(`/planejamento/${parsed.data.planejamento_id}`);
  return { ok: true, message: mensagemDoBanco(validacao) };
}
