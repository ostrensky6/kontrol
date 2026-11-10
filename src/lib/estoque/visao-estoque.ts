/**
 * O que a página do Estoque mostra de cada vez. Em vez de empilhar saldo,
 * custos, consumo e lotes na mesma página, a pessoa escolhe uma visão
 * (?ver=) ou um alerta (?alerta=), que abre a visão certa já filtrada.
 */

export const VISOES_ESTOQUE = [
  { id: "saldo", rotulo: "Saldo por insumo" },
  { id: "lotes", rotulo: "Lotes em estoque" },
  { id: "custos", rotulo: "Custos" },
  { id: "consumo", rotulo: "Consumo mensal" },
] as const;

export type VisaoEstoque = (typeof VISOES_ESTOQUE)[number]["id"];

/** Alertas na ordem dos cartões; os de lote abrem a visão de lotes. */
export const ALERTAS_ESTOQUE = [
  { tipo: "reposicao", rotulo: "Repor", visao: "saldo", tom: "atencao" },
  { tipo: "reposicao_pendente", rotulo: "Reposição aguardando aprovação", visao: "saldo", tom: "atencao" },
  { tipo: "compra_atrasada", rotulo: "Compra atrasada", visao: "saldo", tom: "critico" },
  { tipo: "vencimento", rotulo: "Vence em breve", visao: "lotes", tom: "atencao" },
  { tipo: "vencido", rotulo: "Vencido", visao: "lotes", tom: "critico" },
  { tipo: "sem_validade", rotulo: "Sem validade", visao: "lotes", tom: "critico" },
] as const satisfies readonly { tipo: string; rotulo: string; visao: VisaoEstoque; tom: "atencao" | "critico" }[];

export type TipoAlertaEstoque = (typeof ALERTAS_ESTOQUE)[number]["tipo"];

const primeiro = (valor: string | string[] | undefined) => (Array.isArray(valor) ? valor[0] : valor);

export function alertaEstoqueValido(valor: string | string[] | undefined): TipoAlertaEstoque | null {
  const tipo = primeiro(valor);
  return ALERTAS_ESTOQUE.find((a) => a.tipo === tipo)?.tipo ?? null;
}

/**
 * Visão a abrir. Um alerta escolhido manda (abre saldo ou lotes já filtrado);
 * depois, os links antigos: ?consumo_insumo= abre o consumo e ?entrada= abre o
 * saldo; por fim ?ver=. Sem nada, o saldo.
 */
export function visaoDoEstoque(query: {
  ver?: string | string[];
  alerta?: string | string[];
  entrada?: string | string[];
  consumo_insumo?: string | string[];
}): VisaoEstoque {
  const alerta = alertaEstoqueValido(query.alerta);
  if (alerta) return ALERTAS_ESTOQUE.find((a) => a.tipo === alerta)!.visao;
  if (query.consumo_insumo !== undefined) return "consumo";
  if (primeiro(query.entrada)) return "saldo";
  const ver = primeiro(query.ver);
  return VISOES_ESTOQUE.find((v) => v.id === ver)?.id ?? "saldo";
}

export function hrefVisaoEstoque(visao: VisaoEstoque) {
  return visao === "saldo" ? "/estoque" : `/estoque?ver=${visao}`;
}

/** Clicar no alerta já escolhido desfaz o filtro. */
export function hrefAlertaEstoque(tipo: TipoAlertaEstoque, ativo: TipoAlertaEstoque | null) {
  if (tipo === ativo) return hrefVisaoEstoque(ALERTAS_ESTOQUE.find((a) => a.tipo === tipo)!.visao);
  return `/estoque?alerta=${tipo}`;
}
