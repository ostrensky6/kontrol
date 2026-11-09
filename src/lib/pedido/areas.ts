/**
 * Laboratórios e áreas (0169) para os seletores do pedido: nome e quem
 * coordena. Lê só os ativos; sem a tabela (banco antes da 0169), lista vazia.
 */
export type AreaPedido = { id: number; nome: string; coordenador_nome: string | null };

type Consulta = {
  from: (tabela: string) => {
    select: (colunas: string) => {
      order: (coluna: string) => PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
};

export async function lerAreasPedido(supabase: unknown): Promise<AreaPedido[]> {
  const db = supabase as Consulta;
  const { data, error } = await db.from("coordenacoes_area").select("id, nome, ativo, coordenador_id").order("nome");
  if (error || !Array.isArray(data)) return [];
  const linhas = (data as { id: number; nome: string; ativo: boolean | null; coordenador_id: string | null }[]).filter(
    (linha) => linha.ativo !== false,
  );
  const ids = [...new Set(linhas.map((l) => l.coordenador_id).filter((v): v is string => Boolean(v)))];
  const nomes = new Map<string, string>();
  if (ids.length) {
    const { data: perfis } = await db.from("perfis").select("id, nome, email").order("nome");
    for (const p of (perfis ?? []) as { id: string; nome: string | null; email: string | null }[]) {
      if (ids.includes(p.id)) nomes.set(p.id, p.nome?.trim() || p.email || p.id);
    }
  }
  return linhas.map((l) => ({
    id: Number(l.id),
    nome: l.nome,
    coordenador_nome: l.coordenador_id ? nomes.get(l.coordenador_id) ?? null : null,
  }));
}
