/**
 * "Pedido aberto" de v_previsao_suprimentos, separado em fato e expectativa.
 *
 * qtd_pedida_aberta soma tudo o que foi pedido e ainda não chegou;
 * qtd_pedida_pendente é a parte que ainda espera aprovação (compra solicitada
 * ou pedido de reposição não aprovado). Só a diferença é material comprado ou
 * autorizado, isto é, "a caminho". Pedido em aprovação não garante entrega e
 * nunca é somado ao estoque disponível.
 *
 * Sem leitura da previsão, os dois valores ficam null: a tela mostra "sem
 * dado", não zero.
 */
type Numerico = number | string | null | undefined;

export type PedidoAberto = {
  /** comprado ou autorizado, ainda não recebido (unidade do estoque); null = sem dado */
  aCaminho: number | null;
  /** pedido que ainda espera aprovação; null = sem dado */
  aguardandoAprovacao: number | null;
};

function numeroOuNulo(valor: Numerico): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

export function separarPedidoAberto(aberta: Numerico, pendente: Numerico): PedidoAberto {
  const total = numeroOuNulo(aberta);
  if (total === null) return { aCaminho: null, aguardandoAprovacao: null };
  const esperando = Math.min(Math.max(numeroOuNulo(pendente) ?? 0, 0), Math.max(total, 0));
  return { aCaminho: Math.max(total - esperando, 0), aguardandoAprovacao: esperando };
}
