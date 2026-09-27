/**
 * Divisão dos parâmetros globais entre as duas telas (CAD-4):
 * - versionados: fatores de preço e dias úteis, editados só em
 *   Orçamento → Parâmetros econômicos, que grava uma versão a cada mudança;
 * - de custeio: horas-base, rateios, janelas e taxa de incubação, editados em
 *   Parâmetros de custeio.
 */
export const PARAMETROS_VERSIONADOS = [
  "margem_lucro",
  "impostos",
  "taxas",
  "fundo_reserva",
  "fundo_investimento",
  "dias_uteis_ano",
] as const;

export type ParametroVersionado = (typeof PARAMETROS_VERSIONADOS)[number];

export function ehParametroVersionado(chave: string): chave is ParametroVersionado {
  return (PARAMETROS_VERSIONADOS as readonly string[]).includes(chave);
}

export const ROTULOS_PARAMETROS: Record<string, string> = {
  margem_lucro: "Margem de lucro",
  impostos: "Impostos",
  taxas: "Taxas administrativas",
  fundo_reserva: "Fundo de reserva",
  fundo_investimento: "Fundo de investimento",
  taxa_incubacao: "Taxa de incubação (UFPR) — % por nota fiscal",
  dias_uteis_ano: "Dias úteis por ano",
  horas_mes_tecnico: "Horas-base mensais por técnico",
  horas_bancada_mes: "Horas de bancada por mês",
  janela_vencimento_dias: "Janela de alerta de vencimento (dias)",
  janela_dashboard_vencimento_dias: "Janela de vencimento na página inicial (dias)",
  janela_consumo_previsao_dias: "Janela de consumo para previsão (dias)",
};

export function rotuloParametro(chave: string) {
  return ROTULOS_PARAMETROS[chave] ?? chave;
}
