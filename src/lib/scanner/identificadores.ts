export const ENTIDADE_TIPOS = [
  "insumo",
  "insumo_produto",
  "lote",
  "equipamento",
  "equipamento_unidade",
  "local",
  "pedido_compra",
  "pedido_interno",
  "planejamento",
] as const;

export type EntidadeTipo = (typeof ENTIDADE_TIPOS)[number];

export type IdentificadorInterno = {
  entidadeTipo: EntidadeTipo;
  entidadeId: number;
};

const ENTIDADE_TIPO_SET = new Set<string>(ENTIDADE_TIPOS);

const PREFIXOS_INTERNOS: Record<EntidadeTipo, string> = {
  insumo: "INS",
  insumo_produto: "INSP",
  lote: "LOT",
  equipamento: "EQP",
  equipamento_unidade: "EQPU",
  local: "LOC",
  pedido_compra: "PEDC",
  pedido_interno: "PEDI",
  planejamento: "PLAN",
};

const TIPOS_POR_PREFIXO = Object.fromEntries(
  Object.entries(PREFIXOS_INTERNOS).map(([tipo, prefixo]) => [prefixo, tipo]),
) as Record<string, EntidadeTipo>;

export function normalizarCodigo(codigo: string): string {
  return codigo
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function isEntidadeTipo(value: string): value is EntidadeTipo {
  return ENTIDADE_TIPO_SET.has(value);
}

export function validarEntidadeTipo(value: string): EntidadeTipo {
  if (isEntidadeTipo(value)) return value;
  throw new Error(`Tipo de entidade inválido: ${value}`);
}

export function gerarCodigoInternoKontrol(
  entidadeTipo: EntidadeTipo,
  entidadeId: number,
): string {
  if (!Number.isInteger(entidadeId) || entidadeId <= 0) {
    throw new Error("ID da entidade deve ser um inteiro positivo.");
  }

  return `KONTROL:${PREFIXOS_INTERNOS[entidadeTipo]}:${entidadeId}`;
}

export function resolverIdentificadorInterno(
  codigo: string,
): IdentificadorInterno | null {
  const normalizado = normalizarCodigo(codigo);
  const match = normalizado.match(/^KONTROL:([A-Z_]+):([1-9]\d*)$/);
  if (!match) return null;

  const entidadeTipo = TIPOS_POR_PREFIXO[match[1]];
  if (!entidadeTipo) return null;

  return {
    entidadeTipo,
    entidadeId: Number(match[2]),
  };
}

export function formatoIdentificadorInterno(
  codigo: string,
): "kontrol_interno" | null {
  return resolverIdentificadorInterno(codigo) ? "kontrol_interno" : null;
}
