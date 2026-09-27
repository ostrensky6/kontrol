"use server";

import { mensagemDoBanco } from "@/lib/erros";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { usuarioAtual } from "@/lib/auth/roles";
import { pode } from "@/lib/auth/permissao-efetiva";
import { createClientUntyped } from "@/lib/supabase/server";
import {
  calcularDivergenciaInventario,
  exigeJustificativaInventario,
} from "@/lib/inventario/contagem";
import type { FormState } from "./cadastros";

const SEM_PERMISSAO: FormState = {
  ok: false,
  message: "Seu perfil não tem permissão para esta ação. Peça ao administrador para liberar em Usuários.",
};

const criarCicloSchema = z.object({
  nome: z.string().trim().optional(),
  local_id: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().int().positive().nullable(),
  ),
});

const registrarContagemSchema = z.object({
  ciclo_id: z.preprocess((v) => Number(v), z.number().int().positive()),
  local_id: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().int().positive().nullable(),
  ),
  lote_id: z.preprocess((v) => Number(v), z.number().int().positive()),
  quantidade_contada: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number({ error: "Obrigatório" }).min(0, "Deve ser >= 0"),
  ),
  justificativa: z.preprocess(
    (v) => (v === "" || v == null ? null : String(v).trim()),
    z.string().nullable(),
  ),
});

const aplicarAjusteSchema = z.object({
  contagem_id: z.preprocess((v) => Number(v), z.number().int().positive()),
});

function formErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = String(issue.path[0] ?? "");
    if (path && !errors[path]) errors[path] = issue.message;
  }
  return errors;
}

export async function criarCicloInventario(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await pode("estoque.lote.gerir"))) return SEM_PERMISSAO;

  const parsed = criarCicloSchema.safeParse({
    nome: formData.get("nome"),
    local_id: formData.get("local_id"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", errors: formErrors(parsed.error) };
  }

  const usuario = await usuarioAtual();
  const supabase = await createClientUntyped();
  const { error } = await supabase.from("inventario_ciclos").insert({
    nome: parsed.data.nome || `Inventário ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date())}`,
    local_id: parsed.data.local_id,
    criado_por: usuario?.email ?? usuario?.id ?? null,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };

  revalidatePath("/estoque/inventario");
  return { ok: true, message: "Campanha de inventário criada." };
}

export async function registrarContagemInventario(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await pode("estoque.lote.gerir"))) return SEM_PERMISSAO;

  const parsed = registrarContagemSchema.safeParse({
    ciclo_id: formData.get("ciclo_id"),
    local_id: formData.get("local_id"),
    lote_id: formData.get("lote_id"),
    quantidade_contada: formData.get("quantidade_contada"),
    justificativa: formData.get("justificativa"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", errors: formErrors(parsed.error) };
  }

  const supabase = await createClientUntyped();
  const [{ data: ciclo }, { data: lote }] = await Promise.all([
    supabase
      .from("inventario_ciclos")
      .select("id, status")
      .eq("id", parsed.data.ciclo_id)
      .maybeSingle(),
    supabase
      .from("lotes_estoque")
      .select("id, quantidade_atual, local_id")
      .eq("id", parsed.data.lote_id)
      .maybeSingle(),
  ]);

  if (!ciclo?.id || ciclo.status !== "aberto") {
    return { ok: false, message: "Campanha de inventário não está aberta." };
  }
  if (!lote?.id) return { ok: false, message: "Lote não encontrado." };

  const quantidadeSistema = Number(lote.quantidade_atual ?? 0);
  const divergencia = calcularDivergenciaInventario(
    quantidadeSistema,
    parsed.data.quantidade_contada,
  );
  if (
    exigeJustificativaInventario(quantidadeSistema, parsed.data.quantidade_contada)
    && !parsed.data.justificativa
  ) {
    return {
      ok: false,
      message: "Justificativa obrigatória quando há divergência.",
      errors: { justificativa: "Obrigatório quando há divergência" },
    };
  }

  const usuario = await usuarioAtual();
  const { error } = await supabase.from("inventario_contagens").insert({
    ciclo_id: parsed.data.ciclo_id,
    local_id: parsed.data.local_id ?? lote.local_id ?? null,
    lote_id: parsed.data.lote_id,
    quantidade_sistema: divergencia.quantidadeSistema,
    quantidade_contada: divergencia.quantidadeContada,
    divergencia: divergencia.divergencia,
    justificativa: parsed.data.justificativa,
    contado_por: usuario?.email ?? usuario?.id ?? null,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };

  revalidatePath("/estoque/inventario");
  return {
    ok: true,
    message: divergencia.temDivergencia
      ? "Contagem registrada com divergência. Revise antes de aplicar ajuste."
      : "Contagem registrada sem divergência.",
  };
}

export async function aplicarAjusteContagemInventario(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await pode("estoque.lote.gerir"))) return {
    ok: false,
    message: "Aplicar ajuste de inventário exige a permissão “Corrigir estoque”.",
  };

  const parsed = aplicarAjusteSchema.safeParse({
    contagem_id: formData.get("contagem_id"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Contagem inválida.", errors: formErrors(parsed.error) };
  }

  const supabase = await createClientUntyped();
  const { error } = await supabase.rpc("aplicar_ajuste_inventario_contagem" as never, {
    p_contagem_id: parsed.data.contagem_id,
  } as never);
  if (error) return { ok: false, message: mensagemDoBanco(error) };

  revalidatePath("/estoque");
  revalidatePath("/estoque/inventario");
  return { ok: true, message: "Ajuste auditado aplicado ao lote." };
}
