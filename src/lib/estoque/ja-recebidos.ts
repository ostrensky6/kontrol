import type { SupabaseClient } from "@supabase/supabase-js";

import { lerTudo } from "@/lib/supabase/ler-tudo";

/**
 * Insumos que já foram recebidos alguma vez: os que têm ou tiveram lote, de
 * qualquer status (inclusive consumido e descartado). O que nunca teve lote é
 * "Nunca recebido" e não conta como "Sem estoque" (decisão de Antonio em
 * 19/11/2026, a partir da pergunta do Giorgi sobre item nunca comprado).
 *
 * Leitura que falha devolve `recebidos: null`: ninguém é tratado como nunca
 * recebido, e o zerado continua aparecendo como "Sem estoque". O erro volta
 * para a tela avisar.
 */
export type LeituraJaRecebidos = {
  recebidos: Set<number> | null;
  error: { message: string } | null;
};

export async function lerInsumosJaRecebidos(supabase: SupabaseClient): Promise<LeituraJaRecebidos> {
  // lida de mil em mil (o PostgREST corta em 1.000 linhas)
  const lotes = await lerTudo<{ insumo_id: number | null }>((de, ate) =>
    supabase.from("lotes_estoque").select("id, insumo_id").order("id").range(de, ate),
  );
  if (lotes.error) return { recebidos: null, error: lotes.error };
  return { recebidos: idsJaRecebidos(lotes.data), error: null };
}

/** Um insumo só: basta existir um lote dele. */
export async function insumoJaRecebido(supabase: SupabaseClient, insumoId: number): Promise<LeituraJaRecebidos> {
  const { data, error } = await supabase.from("lotes_estoque").select("id, insumo_id").eq("insumo_id", insumoId).order("id").limit(1);
  if (error) return { recebidos: null, error };
  return { recebidos: idsJaRecebidos((data ?? []) as { insumo_id: number | null }[]), error: null };
}

export function idsJaRecebidos(lotes: readonly { insumo_id: number | string | null }[]): Set<number> {
  const ids = new Set<number>();
  for (const lote of lotes) {
    if (lote.insumo_id != null) ids.add(Number(lote.insumo_id));
  }
  return ids;
}
