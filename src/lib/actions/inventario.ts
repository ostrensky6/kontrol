"use server";

import { mensagemDoBanco } from "@/lib/erros";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { usuarioAtual } from "@/lib/auth/roles";
import { pode } from "@/lib/auth/permissao-efetiva";
import { createClientUntyped } from "@/lib/supabase/server";
import {
  calcularDivergenciaInventario,
  descreverDiferencaInventario,
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
  // contagem por lote ou por insumo (embalagens fechadas, sem lote; 0143)
  lote_id: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().int().positive().nullable(),
  ),
  insumo_id: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().int().positive().nullable(),
  ),
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
    insumo_id: formData.get("insumo_id"),
    quantidade_contada: formData.get("quantidade_contada"),
    justificativa: formData.get("justificativa"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", errors: formErrors(parsed.error) };
  }
  const porInsumo = parsed.data.lote_id == null;
  if (porInsumo && parsed.data.insumo_id == null) {
    return { ok: false, message: "Escolha o lote ou o insumo contado.", errors: { lote_id: "Obrigatório" } };
  }
  if (porInsumo && !Number.isInteger(parsed.data.quantidade_contada)) {
    return {
      ok: false,
      message: "Na contagem por insumo, informe o número de embalagens fechadas (inteiro).",
      errors: { quantidade_contada: "Número inteiro de embalagens" },
    };
  }

  const supabase = await createClientUntyped();
  const [{ data: ciclo }, { data: lote }, { data: fechados }] = await Promise.all([
    supabase
      .from("inventario_ciclos")
      .select("id, status")
      .eq("id", parsed.data.ciclo_id)
      .maybeSingle(),
    porInsumo
      ? Promise.resolve({ data: null })
      : supabase
          .from("lotes_estoque")
          .select("id, quantidade_atual, local_id")
          .eq("id", parsed.data.lote_id as number)
          .maybeSingle(),
    porInsumo
      ? supabase
          .from("lotes_estoque")
          .select("quantidade_atual")
          .eq("insumo_id", parsed.data.insumo_id as number)
          .eq("status", "aceito")
          .eq("modelo_quantidade", "EMBALAGEM_FECHADA")
      : Promise.resolve({ data: null }),
  ]);

  if (!ciclo?.id || ciclo.status !== "aberto") {
    return { ok: false, message: "Campanha de inventário não está aberta." };
  }
  if (!porInsumo && !lote?.id) return { ok: false, message: "Lote não encontrado." };

  // por insumo: embalagens fechadas aceitas, a mesma soma que o ajuste confere
  const quantidadeSistema = porInsumo
    ? ((fechados ?? []) as { quantidade_atual: number | null }[]).reduce(
        (soma, item) => soma + Number(item.quantidade_atual ?? 0),
        0,
      )
    : Number(lote?.quantidade_atual ?? 0);
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
    local_id: parsed.data.local_id ?? lote?.local_id ?? null,
    lote_id: parsed.data.lote_id,
    insumo_id: porInsumo ? parsed.data.insumo_id : null,
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
      ? `Contagem registrada com diferença. ${descreverDiferencaInventario(quantidadeSistema, parsed.data.quantidade_contada).frase} O saldo só muda quando alguém aplicar o ajuste.`
      : "Contagem registrada: confere com o sistema.",
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
  return { ok: true, message: "Ajuste auditado aplicado ao estoque." };
}

const fecharCicloSchema = z.object({
  ciclo_id: z.coerce.number().int().positive(),
});

/**
 * Fecha a campanha (D7, 0136). O banco recusa se ainda houver contagem com
 * diferença sem ajuste; campanha fechada não recebe contagem nova.
 */
export async function fecharCicloInventario(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("estoque.lote.gerir"))) {
    return { ok: false, message: "Fechar campanha exige a permissão “Corrigir estoque”." };
  }
  const parsed = fecharCicloSchema.safeParse({ ciclo_id: formData.get("ciclo_id") });
  if (!parsed.success) return { ok: false, message: "Campanha inválida." };

  const supabase = await createClientUntyped();
  const { data, error } = await supabase.rpc("fechar_ciclo_inventario" as never, {
    p_ciclo_id: parsed.data.ciclo_id,
  } as never);
  if (error) return { ok: false, message: mensagemDoBanco(error) };

  const resumo = (data ?? {}) as { contagens?: number; ajustes?: number };
  revalidatePath("/estoque/inventario");
  return {
    ok: true,
    message: `Campanha fechada: ${resumo.contagens ?? 0} contagem(ns), ${resumo.ajustes ?? 0} ajuste(s) aplicado(s).`,
  };
}
