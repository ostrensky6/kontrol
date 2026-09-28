// Dados cadastrais da empresa que emite a proposta (0135). Sem cadastro
// preenchido, vale a identidade fixa (nome e logo) de identidade-institucional.
import type { IdentidadeInstitucional } from "./identidade-institucional";

export type EmpresaEmissora = {
  codigo: "ATGC" | "GIA";
  nomeLegal: string;
  cnpj: string | null;
  endereco: string | null;
  telefone: string | null;
  email: string | null;
  site: string | null;
};

const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function empresaPadrao(identidade: IdentidadeInstitucional): EmpresaEmissora {
  return {
    codigo: identidade.id,
    nomeLegal: identidade.nomeLegal,
    cnpj: null,
    endereco: null,
    telefone: null,
    email: null,
    site: null,
  };
}

/** Linha de `empresas_emissoras` (ou objeto congelado no snapshot) sobre o padrão. */
export function empresaDeRegistro(registro: unknown, identidade: IdentidadeInstitucional): EmpresaEmissora {
  const base = empresaPadrao(identidade);
  if (!registro || typeof registro !== "object" || Array.isArray(registro)) return base;
  const r = registro as Record<string, unknown>;
  return {
    codigo: base.codigo,
    nomeLegal: texto(r.nome_legal ?? r.nomeLegal) ?? base.nomeLegal,
    cnpj: texto(r.cnpj),
    endereco: texto(r.endereco),
    telefone: texto(r.telefone),
    email: texto(r.email),
    site: texto(r.site),
  };
}

/** Empresa congelada na emissão; null em versões anteriores à 0135. */
export function empresaDoSnapshot(snapshot: unknown, identidade: IdentidadeInstitucional): EmpresaEmissora | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const registro = (snapshot as Record<string, unknown>).empresa_emissora;
  return registro ? empresaDeRegistro(registro, identidade) : null;
}

/** Formato gravado no snapshot (nomes de coluna, como o resto do snapshot). */
export function empresaParaSnapshot(empresa: EmpresaEmissora) {
  return {
    codigo: empresa.codigo,
    nome_legal: empresa.nomeLegal,
    cnpj: empresa.cnpj,
    endereco: empresa.endereco,
    telefone: empresa.telefone,
    email: empresa.email,
    site: empresa.site,
  };
}
