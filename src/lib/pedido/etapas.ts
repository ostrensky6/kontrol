/**
 * Etapas do pedido como a equipe fala delas: seis passos, da solicitação ao
 * pagamento. Cada status do banco cai em exatamente uma etapa; a tela mostra a
 * etapa (onde o pedido está) e o status (o detalhe, por escrito).
 *
 * A ordem segue o fluxo único do Kontrol: solicitação → aprovações →
 * autorização administrativa → cotações → compra e entrega → pagamento.
 * A entrega vem antes do pagamento (0170, D6).
 */

export const ETAPAS_PEDIDO = [
  { id: "solicitacao", rotulo: "Solicitação", descricao: "o solicitante monta e envia" },
  { id: "aprovacao", rotulo: "Aprovação", descricao: "coordenador do projeto e do laboratório" },
  { id: "administrativo", rotulo: "Administrativo", descricao: "fonte de recurso e autorização" },
  { id: "cotacao", rotulo: "Cotação", descricao: "três orçamentos e aprovação final" },
  { id: "compra", rotulo: "Compra e entrega", descricao: "da compra até o material chegar" },
  { id: "pagamento", rotulo: "Pagamento", descricao: "nota fiscal e comprovante" },
] as const;

export type EtapaAtivaId = (typeof ETAPAS_PEDIDO)[number]["id"];
export type EtapaPedidoId = EtapaAtivaId | "concluido" | "cancelado";

export const ROTULO_ETAPA_FINAL: Record<"concluido" | "cancelado", string> = {
  concluido: "Concluído",
  cancelado: "Cancelado",
};

const ETAPA_DO_STATUS: Record<string, EtapaPedidoId> = {
  rascunho: "solicitacao",
  ajuste_solicitante: "solicitacao",
  em_validacao: "aprovacao",
  // "validado" é aprovação concluída; só volta para Aprovação enquanto espera o laboratório (abaixo)
  validado: "administrativo",
  formalizado: "administrativo",
  analise_administrativa: "administrativo",
  ajuste_compras: "administrativo",
  aprovado_compra: "cotacao",
  orcamentos: "cotacao",
  orcamentos_recebidos: "cotacao",
  aguardando_aprovacao_final: "cotacao",
  aprovado_para_compra: "compra",
  compra_fechada: "compra",
  encaminhado_instituicao: "compra",
  aguardando_pagamento_nf: "pagamento",
  compra_concluida: "concluido",
  cancelado: "cancelado",
};

/** Etapa em que o pedido está. Status desconhecido fica na Solicitação. */
export function etapaDoPedido(pedido: {
  status: string | null | undefined;
  natureza?: string | null;
  aprovacao_area_em?: string | null;
}): EtapaPedidoId {
  const status = pedido.status ?? "rascunho";
  // 0169: material de consumo de laboratório ainda espera a coordenação do laboratório
  if (status === "validado" && pedido.natureza === "material_consumo_lab" && !pedido.aprovacao_area_em) {
    return "aprovacao";
  }
  return ETAPA_DO_STATUS[status] ?? "solicitacao";
}

export function rotuloEtapa(etapa: EtapaPedidoId): string {
  if (etapa === "concluido" || etapa === "cancelado") return ROTULO_ETAPA_FINAL[etapa];
  return ETAPAS_PEDIDO.find((e) => e.id === etapa)?.rotulo ?? etapa;
}

/**
 * Posição da etapa (1 a 6). Concluído conta como 7 (todas cumpridas);
 * cancelado é 0 (fora da sequência).
 */
export function posicaoEtapa(etapa: EtapaPedidoId): number {
  if (etapa === "concluido") return ETAPAS_PEDIDO.length + 1;
  if (etapa === "cancelado") return 0;
  return ETAPAS_PEDIDO.findIndex((e) => e.id === etapa) + 1;
}

export function etapaEmAndamento(etapa: EtapaPedidoId) {
  return etapa !== "concluido" && etapa !== "cancelado";
}

/** Filtros da lista de pedidos: em andamento (padrão), cada etapa, concluídos, cancelados e todos. */
export const FILTROS_ETAPA = ["andamento", ...ETAPAS_PEDIDO.map((e) => e.id), "concluido", "cancelado", "todos"] as const;
export type FiltroEtapa = (typeof FILTROS_ETAPA)[number];

export function filtroEtapaValido(valor: unknown): FiltroEtapa {
  return typeof valor === "string" && (FILTROS_ETAPA as readonly string[]).includes(valor)
    ? (valor as FiltroEtapa)
    : "andamento";
}

export function atendeFiltroEtapa(etapa: EtapaPedidoId, filtro: FiltroEtapa): boolean {
  if (filtro === "todos") return true;
  if (filtro === "andamento") return etapaEmAndamento(etapa);
  return etapa === filtro;
}
