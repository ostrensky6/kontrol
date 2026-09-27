import { isEntidadeTipo, type EntidadeTipo } from "@/lib/scanner/identificadores";

export const TIPOS_RESOLUCAO_TRIAGEM = ["insumo", "lote", "local"] as const;

export type TipoResolucaoTriagem = (typeof TIPOS_RESOLUCAO_TRIAGEM)[number];

const TIPO_RESOLUCAO_SET = new Set<string>(TIPOS_RESOLUCAO_TRIAGEM);

export function isTipoResolucaoTriagem(value: string): value is TipoResolucaoTriagem {
  return TIPO_RESOLUCAO_SET.has(value);
}

export function entidadeTipoParaResolucao(
  tipo: TipoResolucaoTriagem,
): Extract<EntidadeTipo, "insumo" | "lote" | "local"> {
  if (!isEntidadeTipo(tipo)) {
    throw new Error(`Tipo inválido: ${tipo}`);
  }
  return tipo;
}

export function calcularCustoUnitarioMinimo(
  custoTotal: number | null,
  quantidadeEmbalagem: number,
) {
  if (custoTotal == null || quantidadeEmbalagem <= 0) return null;
  return custoTotal / quantidadeEmbalagem;
}
