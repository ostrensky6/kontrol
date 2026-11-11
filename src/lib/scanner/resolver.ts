import {
  isEntidadeTipo,
  type EntidadeTipo,
} from "@/lib/scanner/identificadores";

export type EntidadeScanner =
  | "lote"
  | "insumo"
  | "equipamento"
  | "equipamento_unidade"
  | "local";

const ALIASES: Record<string, EntidadeScanner> = {
  lote: "lote",
  lotes: "lote",
  insumo: "insumo",
  insumos: "insumo",
  equipamento: "equipamento",
  equipamentos: "equipamento",
  equip: "equipamento",
  equipamento_unidade: "equipamento_unidade",
  equipamentos_unidade: "equipamento_unidade",
  unidade_equipamento: "equipamento_unidade",
  unidade_equipamentos: "equipamento_unidade",
  patrimonio: "equipamento_unidade",
  patrimonio_equipamento: "equipamento_unidade",
  local: "local",
  locais: "local",
};

export function normalizarTipoScanner(tipo: string): EntidadeScanner | null {
  return ALIASES[tipo.trim().toLowerCase()] ?? null;
}

export function entidadeTipoRotaCurta(tipo: string): EntidadeScanner | null {
  const normalizado = normalizarTipoScanner(tipo);
  if (!normalizado || !isEntidadeTipo(normalizado)) return null;
  return normalizado;
}

export function destinoScanner(tipo: EntidadeScanner, id: number) {
  switch (tipo) {
    case "lote":
      return `/estoque/lotes/${id}`;
    case "insumo":
      // F5: quem lê o código quer saber como está o insumo; o cadastro abre de lá
      return `/estoque/insumos/${id}`;
    case "equipamento":
      return `/estoque/equipamentos/tipos?focus=${id}`;
    case "equipamento_unidade":
      return `/estoque/equipamentos?tab=unidades&focus=${id}`;
    case "local":
      return `/cadastros/locais?focus=${id}`;
  }
}

export function entidadeScannerParaTipo(
  tipo: EntidadeScanner,
): Extract<EntidadeTipo, EntidadeScanner> {
  return tipo;
}

export function extrairRotaScanner(valor: string): { tipo: string; id: string } | null {
  const raw = valor.trim();
  if (!raw) return null;

  let path = raw;
  try {
    path = new URL(raw).pathname;
  } catch {
    path = raw;
  }

  const match = path.match(/^\/?s\/([^/]+)\/([^/?#]+)\/?$/i);
  if (!match) return null;

  return {
    tipo: decodeURIComponent(match[1]),
    id: decodeURIComponent(match[2]),
  };
}

export function parseRotaCurtaKontrol(
  valor: string,
): { tipo: EntidadeScanner; id: number } | null {
  const rota = extrairRotaScanner(valor);
  if (!rota) return null;

  const tipo = entidadeTipoRotaCurta(rota.tipo);
  const id = Number(rota.id);
  if (!tipo || !Number.isInteger(id) || id <= 0) return null;

  return { tipo, id };
}
