"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { conferirEscrita } from "@/lib/supabase/escrita";
import { mensagemDoBanco } from "@/lib/erros";
import { ehParametroVersionado, rotuloParametro } from "@/lib/cadastros/parametros";
import type { FormState } from "./cadastros";

/**
 * Salva os parâmetros de custeio que não têm versão (horas-base, rateios,
 * janelas de alerta, taxa de incubação). Cada campo `valor_<chave>` atualiza a
 * linha correspondente em `parametros`.
 *
 * Margem, impostos, taxas, fundos e dias úteis são versionados e só mudam em
 * Orçamento → Parâmetros econômicos (CAD-4): aqui são recusados, para a tela
 * sem versão não reescrever o histórico econômico.
 */
export async function salvarParametros(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const chaves = String(formData.get("chaves") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  if (chaves.length === 0) return { ok: false, message: "Nada a salvar." };

  const versionadas = chaves.filter(ehParametroVersionado);
  if (versionadas.length > 0) {
    return {
      ok: false,
      message: `${versionadas.map(rotuloParametro).join(", ")}: altere em Orçamento → Parâmetros econômicos, que guarda a versão anterior.`,
    };
  }

  const errors: Record<string, string> = {};
  const updates: { chave: string; valor: number }[] = [];

  for (const chave of chaves) {
    const raw = formData.get(`valor_${chave}`);
    const valor = Number(String(raw ?? "").replace(",", "."));

    if (raw == null || raw === "" || !Number.isFinite(valor) || valor < 0) {
      errors[chave] = "Informe um número maior ou igual a 0.";
      continue;
    }

    updates.push({ chave, valor });
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, message: "Verifique os campos destacados.", errors };
  }

  const supabase = await createClient();
  for (const u of updates) {
    // `.select()` é obrigatório: sob RLS (perfil sem a permissão) o UPDATE
    // volta sem `error` e sem linha alguma. Só a linha devolvida comprova.
    const { data, error } = await supabase
      .from("parametros")
      .update({ valor: u.valor, atualizado_em: new Date().toISOString() })
      .eq("chave", u.chave)
      .select("chave");

    if (error) return { ok: false, message: mensagemDoBanco(error) };
    const escrita = conferirEscrita(error, data, `Não foi possível salvar "${rotuloParametro(u.chave)}".`);
    if (!escrita.ok) return { ok: false, message: escrita.message };
  }

  for (const path of [
    "/parametros",
    "/custeio",
    "/orcamento",
    "/analises",
    "/estoque",
    "/compras",
    "/planejamento",
    "/insumos",
    "/cadastros",
    "/",
  ]) {
    revalidatePath(path);
  }

  return { ok: true, message: "Parâmetros salvos. Valem para novos cálculos; propostas emitidas não mudam." };
}
