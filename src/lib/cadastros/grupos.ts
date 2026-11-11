/**
 * Os 12 cadastros em 4 grupos (revisão de 11/11, 8.8): a barra de Cadastros
 * mostra os grupos; dentro de um grupo, as abas levam a cada cadastro. A mesma
 * divisão vale para os cartões de "Todos os cadastros".
 */
export const GRUPOS_CADASTROS = [
  {
    id: "materiais",
    label: "Materiais",
    desc: "insumos, tipos técnicos, equipamentos e locais",
    slugs: ["insumos", "tipo_insumos", "equipamentos", "previsao_equipamentos", "locais"],
  },
  {
    id: "pessoas",
    label: "Pessoas e áreas",
    desc: "técnicos, laboratórios e áreas e responsáveis por etapa",
    slugs: ["tecnicos", "coordenacoes", "responsaveis"],
  },
  {
    id: "comercial",
    label: "Comercial",
    desc: "clientes, projetos e fornecedores",
    slugs: ["clientes", "projetos", "fornecedores"],
  },
  {
    id: "custos",
    label: "Custos",
    desc: "custos fixos mensais do laboratório",
    slugs: ["overhead"],
  },
] as const;

export type GrupoCadastro = (typeof GRUPOS_CADASTROS)[number];
export type GrupoCadastroId = GrupoCadastro["id"];

/** Endereço do grupo na barra: abre o primeiro cadastro do grupo. */
export function rotaDoGrupo(id: GrupoCadastroId) {
  return `/cadastros/grupo/${id}`;
}

export function grupoPorId(id: string): GrupoCadastro | null {
  return GRUPOS_CADASTROS.find((grupo) => grupo.id === id) ?? null;
}

export function grupoDoCadastro(slug: string): GrupoCadastro | null {
  return GRUPOS_CADASTROS.find((grupo) => (grupo.slugs as readonly string[]).includes(slug)) ?? null;
}

/** Slug do cadastro numa rota /cadastros/<slug>[/...]; null fora de um cadastro. */
export function slugDaRotaDeCadastro(pathname: string): string | null {
  const partes = pathname.split("/").filter(Boolean);
  if (partes[0] !== "cadastros" || !partes[1]) return null;
  return grupoDoCadastro(partes[1]) ? partes[1] : null;
}
