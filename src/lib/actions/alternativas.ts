"use server";

import { revalidatePath } from "next/cache";
import { createClientUntyped } from "@/lib/supabase/server";
import { mensagemDoBanco, type EstadoAcao } from "@/lib/erros";

/**
 * Registra que uma alternativa de insumo (grupo de escolha) serve ou não
 * serve (0159). Quem pode e a regra "o grupo não fica vazio" ficam no banco.
 */
export async function validarAlternativaInsumo(_prev: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const idTexto = String(form.get("insumo_analise_id") ?? "").trim();
  const codigo = String(form.get("codigo_analise") ?? "").trim();
  const decisao = String(form.get("decisao") ?? "");
  const observacao = String(form.get("observacao") ?? "").trim();
  if (!/^\d+$/.test(idTexto)) return { ok: false, message: "Linha inválida. Recarregue a página." };
  if (decisao !== "valida" && decisao !== "invalida") return { ok: false, message: "Diga se a alternativa serve ou não serve." };
  if (observacao.length < 1 || observacao.length > 1000) return { ok: false, message: "Escreva uma observação (até 1000 caracteres)." };
  const supabase = await createClientUntyped();
  const { error } = await supabase.rpc("validar_alternativa_insumo", {
    p_insumo_analise_id: Number(idTexto),
    p_decisao: decisao,
    p_observacao: observacao,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  if (codigo) revalidatePath(`/analises/${encodeURIComponent(codigo)}`);
  revalidatePath("/analises");
  revalidatePath("/orcamento");
  return { ok: true, message: decisao === "valida" ? "Alternativa validada." : "Alternativa marcada como não serve; ela sai do orçamento." };
}
