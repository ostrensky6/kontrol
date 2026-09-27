export type IdentidadeInstitucionalId = "GIA" | "ATGC";

export type IdentidadeInstitucional = {
  id: IdentidadeInstitucionalId;
  nomeCurto: string;
  nomeLegal: string;
  tituloDocumento: string;
  responsavel: string;
  logoSrc: string;
  logoAlt: string;
  corPrincipal: string;
  corSuave: string;
  creator: string;
};

const IDENTIDADES: Record<IdentidadeInstitucionalId, IdentidadeInstitucional> = {
  GIA: {
    id: "GIA",
    nomeCurto: "GIA / UFPR",
    nomeLegal: "Grupo Integrado de Aquicultura e Estudos Ambientais",
    tituloDocumento: "Proposta comercial - GIA / UFPR",
    responsavel: "Grupo Integrado de Aquicultura e Estudos Ambientais",
    logoSrc: "/logos/gia.svg",
    logoAlt: "GIA",
    corPrincipal: "#1A5292",
    corSuave: "#EAF2FA",
    creator: "Kontrol - GIA",
  },
  ATGC: {
    id: "ATGC",
    nomeCurto: "ATGC Genética Ambiental",
    nomeLegal: "ATGC Genética Ambiental Limitada",
    tituloDocumento: "Proposta comercial - ATGC Genética Ambiental",
    responsavel: "ATGC Genética Ambiental",
    logoSrc: "/logos/atgc.svg",
    logoAlt: "ATGC",
    corPrincipal: "#0B8793",
    corSuave: "#E8F4F3",
    creator: "Kontrol - ATGC",
  },
};

function normalizarInstituicao(valor?: string | null) {
  return (valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

export function resolverIdentidadeInstitucional(valor?: string | null) {
  const normalizado = normalizarInstituicao(valor);
  if (normalizado.includes("GIA") || normalizado.includes("UFPR")) return IDENTIDADES.GIA;
  if (normalizado.includes("ATGC")) return IDENTIDADES.ATGC;
  return null;
}

export function exigirIdentidadeInstitucional(valor?: string | null) {
  const identidade = resolverIdentidadeInstitucional(valor);
  if (!identidade) {
    throw new Error("Identidade institucional ausente ou inválida para emissão final. Informe GIA / UFPR ou ATGC na demanda.");
  }
  return identidade;
}

/**
 * Versão que nunca lança, para telas e exportações de versões já emitidas:
 * sem instituição reconhecida, usa GIA / UFPR e devolve um aviso para exibir.
 */
export function resolverIdentidadeComAviso(valor?: string | null): {
  identidade: IdentidadeInstitucional;
  aviso: string | null;
} {
  const identidade = resolverIdentidadeInstitucional(valor);
  if (identidade) return { identidade, aviso: null };
  return {
    identidade: IDENTIDADES.GIA,
    aviso: "Instituição emissora não informada no orçamento; usada GIA / UFPR. Corrija o campo Instituição (GIA / UFPR ou ATGC).",
  };
}

/** Opções aceitas no campo "Instituição emissora" (lista em vez de texto livre). */
export const OPCOES_INSTITUICAO = [
  { valor: "GIA / UFPR", rotulo: "GIA / UFPR" },
  { valor: "ATGC", rotulo: "ATGC Genética Ambiental" },
] as const;

/** Valor da lista que corresponde ao texto gravado (registros antigos em texto livre). */
export function opcaoInstituicao(valor?: string | null): string {
  const identidade = resolverIdentidadeInstitucional(valor);
  if (identidade?.id === "GIA") return "GIA / UFPR";
  if (identidade?.id === "ATGC") return "ATGC";
  return "";
}
