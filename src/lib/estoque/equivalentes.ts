import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Necessidade genérica x marca/apresentação/lote (item 8 do plano).
 *
 * O "tipo técnico" (tipo_insumos) é a necessidade genérica; cada insumo do
 * catálogo é uma marca/apresentação desse tipo; cada lote é uma unidade
 * física. Quando falta um insumo, outro insumo do mesmo tipo com saldo pode
 * cobrir a necessidade. Aqui só se aponta a alternativa: trocar o insumo da
 * análise ou do pedido continua sendo decisão de quem planeja ou valida.
 */
export type InsumoTipo = {
  id: number;
  especificacao: string;
  fabricante: string | null;
  unidade: string | null;
  tipo_insumo_id: number | null;
  ativo?: boolean | null;
};

export type Equivalente = {
  insumo_id: number;
  especificacao: string;
  fabricante: string | null;
  unidade: string | null;
  disponivel: number;
};

export type EquivalentesPorInsumo = {
  tipo: Map<number, string>;
  equivalentes: Map<number, Equivalente[]>;
};

/** Agrupa, para cada insumo pedido, os outros insumos ativos do mesmo tipo que têm saldo. */
export function agruparEquivalentes(
  pedidos: number[],
  catalogo: InsumoTipo[],
  disponivel: Map<number, number>,
): Map<number, Equivalente[]> {
  const porId = new Map(catalogo.map((i) => [i.id, i]));
  const porTipo = new Map<number, InsumoTipo[]>();
  for (const i of catalogo) {
    if (i.tipo_insumo_id == null || i.ativo === false) continue;
    porTipo.set(i.tipo_insumo_id, [...(porTipo.get(i.tipo_insumo_id) ?? []), i]);
  }
  const resultado = new Map<number, Equivalente[]>();
  for (const id of pedidos) {
    const tipo = porId.get(id)?.tipo_insumo_id;
    if (tipo == null) continue;
    const lista = (porTipo.get(tipo) ?? [])
      .filter((i) => i.id !== id && (disponivel.get(i.id) ?? 0) > 0)
      .map((i) => ({
        insumo_id: i.id,
        especificacao: i.especificacao,
        fabricante: i.fabricante,
        unidade: i.unidade,
        disponivel: disponivel.get(i.id) ?? 0,
      }))
      .sort((a, b) => b.disponivel - a.disponivel || a.especificacao.localeCompare(b.especificacao));
    if (lista.length > 0) resultado.set(id, lista);
  }
  return resultado;
}

/** Lê do banco os equivalentes com saldo dos insumos informados. Erro de leitura = sem sugestão. */
export async function lerEquivalentesComSaldo(supabase: SupabaseClient, insumoIds: number[]): Promise<EquivalentesPorInsumo> {
  const vazio: EquivalentesPorInsumo = { tipo: new Map(), equivalentes: new Map() };
  const ids = [...new Set(insumoIds)];
  if (ids.length === 0) return vazio;
  const { data: proprios, error } = await supabase
    .from("insumos")
    .select("id, especificacao, fabricante, unidade, tipo_insumo_id, ativo")
    .in("id", ids);
  if (error) return vazio;
  const tipos = [...new Set(((proprios ?? []) as InsumoTipo[]).map((i) => i.tipo_insumo_id).filter((t): t is number => t != null))];
  if (tipos.length === 0) return vazio;
  const [{ data: irmaos, error: erroIrmaos }, { data: nomesTipo }] = await Promise.all([
    supabase.from("insumos").select("id, especificacao, fabricante, unidade, tipo_insumo_id, ativo").in("tipo_insumo_id", tipos),
    supabase.from("tipo_insumos").select("id, nome").in("id", tipos),
  ]);
  if (erroIrmaos) return vazio;
  const catalogo = [...new Map([...(proprios ?? []), ...(irmaos ?? [])].map((i) => [Number((i as InsumoTipo).id), i as InsumoTipo])).values()];
  const outros = catalogo.map((i) => i.id).filter((id) => !ids.includes(id));
  const disponivel = new Map<number, number>();
  if (outros.length > 0) {
    const [{ data: saldo }, { data: saldoUnidade }] = await Promise.all([
      supabase.from("v_estoque_saldo").select("insumo_id, disponivel").in("insumo_id", outros),
      supabase.from("v_estoque_disponivel_unidade").select("insumo_id, disponivel_unidade").in("insumo_id", outros),
    ]);
    for (const s of saldo ?? []) disponivel.set(Number(s.insumo_id), Number(s.disponivel) || 0);
    // Embalagem fechada: a unidade física vale sobre a contagem de embalagens.
    for (const s of saldoUnidade ?? []) disponivel.set(Number(s.insumo_id), Number(s.disponivel_unidade) || 0);
  }
  return {
    tipo: new Map((nomesTipo ?? []).map((t: { id: number; nome: string }) => [Number(t.id), t.nome])),
    equivalentes: agruparEquivalentes(ids, catalogo, disponivel),
  };
}
