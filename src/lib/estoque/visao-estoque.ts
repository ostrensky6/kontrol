/**
 * O que a página do Estoque (Saldo e lotes) mostra de cada vez. Desde a Onda 2
 * da revisão de 11/11 a barra tem só duas visões, saldo por insumo e lotes
 * (D1, L10): os alertas são a Situação do estoque, o consumo é lido na ficha
 * do insumo e os custos viraram um relatório próprio.
 */

export const VISOES_ESTOQUE = [
  { id: "saldo", rotulo: "Saldo por insumo" },
  { id: "lotes", rotulo: "Lotes em estoque" },
] as const;

/** "consumo" não está na barra: abre pela ficha do insumo (estimativa manual e histórico). */
export type VisaoEstoque = (typeof VISOES_ESTOQUE)[number]["id"] | "consumo";

export const HREF_CUSTOS_ESTOQUE = "/estoque/custos";

const primeiro = (valor: string | string[] | undefined) => (Array.isArray(valor) ? valor[0] : valor);

/**
 * Endereços antigos que mudaram de lugar: os cartões de alerta (?alerta=)
 * levam à Situação do estoque e a visão de custos (?ver=custos), ao relatório.
 * null = a página do Estoque atende.
 */
export function destinoAntigoDoEstoque(query: { ver?: string | string[]; alerta?: string | string[] }): string | null {
  if (primeiro(query.alerta)) return "/estoque/situacao";
  if (primeiro(query.ver) === "custos") return HREF_CUSTOS_ESTOQUE;
  return null;
}

/**
 * Visão a abrir: ?consumo_insumo= (vindo da ficha) abre o consumo, ?entrada=
 * abre o saldo; depois ?ver=. Sem nada, o saldo.
 */
export function visaoDoEstoque(query: {
  ver?: string | string[];
  entrada?: string | string[];
  consumo_insumo?: string | string[];
}): VisaoEstoque {
  if (query.consumo_insumo !== undefined) return "consumo";
  if (primeiro(query.entrada)) return "saldo";
  const ver = primeiro(query.ver);
  if (ver === "consumo") return "consumo";
  return VISOES_ESTOQUE.find((v) => v.id === ver)?.id ?? "saldo";
}

export function hrefVisaoEstoque(visao: VisaoEstoque) {
  return visao === "saldo" ? "/estoque" : `/estoque?ver=${visao}`;
}
