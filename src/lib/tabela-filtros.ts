/**
 * Busca e filtros das tabelas (DataTable) guardados na aba (sessionStorage):
 * recarregar a página não apaga o que a pessoa filtrou. A chave junta a página
 * e o conjunto de colunas, para duas tabelas da mesma página não se misturarem.
 */

export type FiltroColuna = { id: string; value: unknown };
export type FiltrosTabela = { busca: string; colunas: FiltroColuna[] };

export function chaveFiltros(pathname: string, colunas: string[]) {
  return `kontrol:filtros:${pathname}:${colunas.join(",")}`;
}

/** null quando não há nada a guardar (a chave deve ser removida). */
export function serializarFiltros(filtros: FiltrosTabela): string | null {
  if (!filtros.busca && filtros.colunas.length === 0) return null;
  return JSON.stringify(filtros);
}

export function restaurarFiltros(texto: string | null, colunasValidas: string[]): FiltrosTabela | null {
  if (!texto) return null;
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!bruto || typeof bruto !== "object") return null;
  const { busca, colunas } = bruto as { busca?: unknown; colunas?: unknown };
  if (typeof busca !== "string" || !Array.isArray(colunas)) return null;
  const validas = new Set(colunasValidas);
  return {
    busca,
    colunas: colunas.filter(
      (c): c is FiltroColuna =>
        Boolean(c) && typeof c === "object" && typeof (c as FiltroColuna).id === "string" && validas.has((c as FiltroColuna).id),
    ),
  };
}
