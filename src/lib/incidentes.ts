export type Incidente = {
  id: number;
  titulo: string;
  descricao: string;
  afetados: string;
  orientacao: string;
  causa: string | null;
  papel_destino: string;
  situacao: "aberto" | "em_andamento" | "resolvido";
  registrado_em: string;
  atualizado_em: string;
  resolvido_em: string | null;
};

export type IncidenteAtualizacao = {
  id: number;
  incidente_id: number;
  situacao: Incidente["situacao"];
  nota: string;
  criado_em: string;
};

export const ROTULO_SITUACAO_INCIDENTE: Record<Incidente["situacao"], string> = {
  aberto: "Aberto",
  em_andamento: "Em andamento",
  resolvido: "Resolvido",
};

export const CAUSA_DESCONHECIDA = "Causa ainda desconhecida";

export const CAMPOS_INCIDENTE =
  "id, titulo, descricao, afetados, orientacao, causa, papel_destino, situacao, registrado_em, atualizado_em, resolvido_em";

/** Abertos primeiro (mais recentes no topo), depois os resolvidos. */
export function ordenarIncidentes(lista: Incidente[]): Incidente[] {
  return [...lista].sort((a, b) => {
    const ra = a.situacao === "resolvido" ? 1 : 0;
    const rb = b.situacao === "resolvido" ? 1 : 0;
    if (ra !== rb) return ra - rb;
    return b.registrado_em.localeCompare(a.registrado_em);
  });
}
