/**
 * Linhas por página das tabelas. A lista abre curta (10 linhas): quem procura
 * um registro usa a busca e os filtros; quem prefere ver mais escolhe 25, 50,
 * 100 ou Todos, e a escolha fica guardada neste navegador.
 */

export const LINHAS_POR_PAGINA_PADRAO = 10;
export const OPCOES_LINHAS_POR_PAGINA = [10, 25, 50, 100] as const;
/** valor da opção "Todos" */
export const TODAS_AS_LINHAS = 100000;
export const CHAVE_LINHAS_POR_PAGINA = "kontrol:tabela:linhas";

/** Opções do seletor; inclui o tamanho inicial quando ele foge do padrão. */
export function opcoesDeLinhas(inicial: number): number[] {
  return [...new Set<number>([...OPCOES_LINHAS_POR_PAGINA, inicial])]
    .filter((n) => n > 0 && n < TODAS_AS_LINHAS)
    .sort((a, b) => a - b);
}

/**
 * Preferência guardada; null quando não há ou não é um dos valores aceitos.
 * "Todos" não é guardado: vale só para a tabela em que foi escolhido.
 */
export function linhasGuardadas(texto: string | null): number | null {
  const n = Number(texto);
  if (!texto || !Number.isInteger(n)) return null;
  return (OPCOES_LINHAS_POR_PAGINA as readonly number[]).includes(n) ? n : null;
}

/** O rodapé (seletor e páginas) aparece quando a lista passa da menor página. */
export function mostraRodapeDePaginas(totalFiltrado: number): boolean {
  return totalFiltrado > OPCOES_LINHAS_POR_PAGINA[0];
}
