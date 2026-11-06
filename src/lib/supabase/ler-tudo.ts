/**
 * Leitura completa de uma consulta do PostgREST, de mil em mil linhas.
 *
 * O Supabase corta cada resposta em `max_rows` (1.000 no projeto). Sem
 * paginar, uma lista com mais linhas fica incompleta sem aviso. A consulta
 * recebida precisa ter ordenação estável (termine em uma coluna única, como
 * `id`), senão uma linha pode pular de página.
 */
export const LOTE_LEITURA = 1000;

type RespostaPagina = PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null }>;

export async function lerTudo<T>(
  consulta: (de: number, ate: number) => RespostaPagina,
  { lote = LOTE_LEITURA, maxPaginas = 200 }: { lote?: number; maxPaginas?: number } = {},
): Promise<{ data: T[]; error: { message: string; code?: string } | null }> {
  const linhas: T[] = [];
  for (let pagina = 0; pagina < maxPaginas; pagina += 1) {
    const de = pagina * lote;
    const { data, error } = await consulta(de, de + lote - 1);
    if (error) return { data: linhas, error };
    const recebidas = (data ?? []) as T[];
    linhas.push(...recebidas);
    if (recebidas.length < lote) return { data: linhas, error: null };
  }
  return {
    data: linhas,
    error: { message: `A leitura passou de ${maxPaginas * lote} linhas e foi interrompida.` },
  };
}
