/**
 * Regras compartilhadas (cliente e servidor) da baixa manual de estoque.
 *
 * - Lotes EMBALAGEM_FECHADA (0109): baixa em embalagens inteiras pela RPC
 *   baixa_manual_embalagens; só lotes 'aceito'.
 * - Lotes LEGADO: baixa por volume na unidade do insumo pela RPC
 *   baixa_manual_lote; lotes 'aceito' ou 'em_uso'.
 * Em ambos: lote vencido não recebe baixa e o saldo reservado a planos é
 * preservado. A escolha de lote segue FEFO (vence antes, sai antes).
 */

export type ModeloQuantidadeLote = "LEGADO" | "EMBALAGEM_FECHADA";

export type LoteBaixa = {
  id: number;
  codigoLote: string;
  /** validade efetiva (menor entre fabricante e após abertura), aaaa-mm-dd */
  validade: string | null;
  quantidadeAtual: number;
  reservado: number;
  modeloQuantidade: ModeloQuantidadeLote;
  status: string;
};

export const MOTIVOS_BAIXA = ["Entrega ao laboratório", "Perda/quebra", "Vencimento", "Outro"] as const;
export type MotivoBaixa = (typeof MOTIVOS_BAIXA)[number];

export function normalizarModelo(value: unknown): ModeloQuantidadeLote {
  return value === "EMBALAGEM_FECHADA" ? "EMBALAGEM_FECHADA" : "LEGADO";
}

/** Data de hoje (aaaa-mm-dd) no fuso do laboratório. */
export function hojeIso(agora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(agora);
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((parte) => parte.type === tipo)?.value;
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

export function validadeEfetiva(validade: string | null | undefined, validadeAposAbertura: string | null | undefined) {
  const datas = [validade, validadeAposAbertura].filter((data): data is string => Boolean(data)).sort();
  return datas[0] ?? null;
}

export function loteVencido(validade: string | null | undefined, hoje = hojeIso()) {
  return Boolean(validade) && String(validade).slice(0, 10) < hoje;
}

export function formatarDataIso(value: string | null | undefined) {
  if (!value) return "sem validade";
  const [ano, mes, dia] = value.slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : value;
}

/** Quanto pode sair do lote sem invadir reservas (inteiro em embalagens). */
export function disponivelParaBaixa(lote: Pick<LoteBaixa, "quantidadeAtual" | "reservado" | "modeloQuantidade">) {
  const livre = Math.max(0, Number(lote.quantidadeAtual) - Number(lote.reservado || 0));
  return lote.modeloQuantidade === "EMBALAGEM_FECHADA" ? Math.floor(livre) : livre;
}

export type SituacaoBaixa =
  | { permitida: true; somenteVencimento?: boolean }
  | { permitida: false; motivo: string };

export function situacaoBaixa(lote: LoteBaixa, hoje = hojeIso()): SituacaoBaixa {
  const statusValidos = lote.modeloQuantidade === "EMBALAGEM_FECHADA" ? ["aceito"] : ["aceito", "em_uso"];
  if (!statusValidos.includes(lote.status)) {
    return {
      permitida: false,
      motivo: lote.status === "quarentena" ? "Aguardando aceite." : "Lote indisponível para baixa.",
    };
  }
  if (!(Number(lote.quantidadeAtual) > 0)) return { permitida: false, motivo: "Lote sem saldo." };
  if (!(disponivelParaBaixa(lote) > 0)) {
    return { permitida: false, motivo: "Saldo totalmente reservado para planos." };
  }
  // vencido não vai para uso, mas pode sair do saldo como perda (0117)
  if (loteVencido(lote.validade, hoje)) return { permitida: true, somenteVencimento: true };
  return { permitida: true };
}

/** FEFO: validade mais próxima primeiro; sem validade por último. */
export function ordenarFefo<T extends Pick<LoteBaixa, "id" | "validade">>(lotes: T[]) {
  return [...lotes].sort((a, b) => {
    if (a.validade && b.validade && a.validade !== b.validade) return a.validade < b.validade ? -1 : 1;
    if (a.validade && !b.validade) return -1;
    if (!a.validade && b.validade) return 1;
    return a.id - b.id;
  });
}

/** Lotes que aceitam baixa agora, em ordem FEFO (o primeiro é o sugerido). */
export function lotesParaBaixa(lotes: LoteBaixa[], hoje = hojeIso()) {
  return ordenarFefo(lotes.filter((lote) => situacaoBaixa(lote, hoje).permitida));
}

export type ReservaLoteDb = {
  lote_id: number | null;
  quantidade: number | string | null;
  quantidade_consumida?: number | string | null;
  status?: string | null;
};

/** Saldo reservado (reservado/parcial, ainda não consumido) por lote. */
export function somarReservasPorLote(reservas: ReservaLoteDb[]) {
  const mapa = new Map<number, number>();
  for (const reserva of reservas) {
    if (reserva.lote_id == null) continue;
    if (reserva.status && reserva.status !== "reservado" && reserva.status !== "parcial") continue;
    const pendente = Number(reserva.quantidade ?? 0) - Number(reserva.quantidade_consumida ?? 0);
    if (!(pendente > 0)) continue;
    mapa.set(Number(reserva.lote_id), (mapa.get(Number(reserva.lote_id)) ?? 0) + pendente);
  }
  return mapa;
}

export type LoteDbBaixa = {
  id: number;
  codigo_lote: string | null;
  validade: string | null;
  validade_apos_abertura?: string | null;
  quantidade_atual: number | string | null;
  status: string;
  modelo_quantidade?: string | null;
};

export function loteBaixaDeDb(lote: LoteDbBaixa, reservadoPorLote: Map<number, number>): LoteBaixa {
  return {
    id: Number(lote.id),
    codigoLote: lote.codigo_lote || `LOTE-${lote.id}`,
    validade: validadeEfetiva(lote.validade, lote.validade_apos_abertura),
    quantidadeAtual: Number(lote.quantidade_atual ?? 0),
    reservado: reservadoPorLote.get(Number(lote.id)) ?? 0,
    modeloQuantidade: normalizarModelo(lote.modelo_quantidade),
    status: lote.status,
  };
}

/** Texto gravado na movimentação: "Perda/quebra: frasco trincado". */
export function montarMotivoBaixa(tipo: string, detalhe?: string | null) {
  const complemento = String(detalhe ?? "").trim();
  return complemento ? `${tipo}: ${complemento}` : tipo;
}
