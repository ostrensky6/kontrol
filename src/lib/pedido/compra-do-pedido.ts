import type { ItemCompraDoPedidoRaw } from "@/lib/pedido/chegada-pela-compra";

/**
 * Compra única na tela (auditoria de 16/11, item 10, proposta 2, aprovada em
 * 17/11/2026). A compra que nasceu de um pedido é conduzida no pedido:
 * fornecedor, envio, chegada, pendência e impressão ficam no painel "Compra",
 * e a tela da compra vira consulta. Aqui ficam as regras que as três telas
 * (pedido, compra e lista de compras) precisam dizer do mesmo jeito.
 */

/** Etapas do pedido em que o painel "Compra" aparece: de "Compra e entrega" em diante. */
export const PEDIDO_COM_PAINEL_DA_COMPRA = [
  "aprovado_para_compra",
  "compra_fechada",
  "encaminhado_instituicao",
  "aguardando_pagamento_nf",
  "compra_concluida",
];

/** Colunas da compra que o painel do pedido mostra (embutidas na leitura do pedido). */
export const COLUNAS_COMPRA_DO_PEDIDO = "id, status, fornecedor_id, data_prevista_entrega, fornecedores(nome)";

export type CompraDoPedido = {
  id: number;
  status: string;
  fornecedor_id?: number | null;
  data_prevista_entrega?: string | null;
  fornecedores?: { nome: string | null } | null;
};

/** Âncora do painel no pedido: a lista de compras e a tela da compra abrem o pedido já nele. */
export const ANCORA_PAINEL_COMPRA = "compra";

export function hrefDoPainelDaCompra(pedidoId: number) {
  return `/pedido/${pedidoId}#${ANCORA_PAINEL_COMPRA}`;
}

/** O pedido já mostra o painel "Compra"? Antes de "Compra e entrega" a compra ainda espera a aprovação do pedido. */
export function pedidoMostraPainelDaCompra(status: string | null | undefined) {
  return PEDIDO_COM_PAINEL_DA_COMPRA.includes(String(status ?? ""));
}

/** Link do pedido que conduz a compra: já no painel quando ele existe; antes disso, o pedido. */
export function hrefDoPedidoQueConduz(pedido: { id: number; status: string | null }) {
  return pedidoMostraPainelDaCompra(pedido.status) ? hrefDoPainelDaCompra(pedido.id) : `/pedido/${pedido.id}`;
}

/**
 * Pedido que conduz a compra: o pedido de origem que não foi cancelado (o mais
 * antigo, quando a compra atende mais de um). Sem pedido vivo, a compra é
 * conduzida na própria tela (compra de pendência, rascunho de reposição).
 */
export function pedidoQueConduzCompra<T extends { id: number; status: string | null }>(pedidos: T[]): T | null {
  const vivos = pedidos.filter((pedido) => pedido.status !== "cancelado").sort((a, b) => a.id - b.id);
  return vivos[0] ?? null;
}

export type EnvioDaCompra =
  /** "Fechar com fornecedor" envia a compra junto (0182): o painel só explica. */
  | "no_fechamento"
  /** Compra pela Fundação ou Universidade: o envio ao fornecedor é outro momento. */
  | "instituicao"
  /** Pedido fechado antes da 0182, com a compra ainda aprovada. */
  | "pendente";

/** O que falta para a compra constar como enviada, visto do pedido. Null: nada a fazer. */
export function envioDaCompra(pedidoStatus: string | null | undefined, compraStatus: string | null | undefined): EnvioDaCompra | null {
  if (compraStatus !== "aprovado") return null;
  if (pedidoStatus === "aprovado_para_compra") return "no_fechamento";
  if (pedidoStatus === "encaminhado_instituicao") return "instituicao";
  if (["compra_fechada", "aguardando_pagamento_nf", "compra_concluida"].includes(String(pedidoStatus))) return "pendente";
  return null;
}

/** Situações em que a compra ainda pode receber o fornecedor que ficou em branco. */
export const COMPRA_ACEITA_FORNECEDOR = ["solicitado", "aprovado", "enviado", "em_transito"];

/**
 * A compra ficou sem fornecedor: o orçamento escolhido tinha só o nome
 * digitado, então a 0171 não tinha o que levar para a compra.
 */
export function compraSemFornecedor(compra: CompraDoPedido | null | undefined) {
  return Boolean(compra && compra.fornecedor_id == null && COMPRA_ACEITA_FORNECEDOR.includes(compra.status));
}

/** Fornecedor cadastrado com o mesmo nome digitado no orçamento (sem diferenciar maiúsculas). */
export function fornecedorCadastradoComNome<T extends { id: number; nome: string }>(
  nome: string | null | undefined,
  cadastrados: T[],
): T | null {
  const alvo = nome?.trim().toLocaleLowerCase("pt-BR");
  if (!alvo) return null;
  return cadastrados.find((fornecedor) => fornecedor.nome.trim().toLocaleLowerCase("pt-BR") === alvo) ?? null;
}

export type ChegadaDaCompra = {
  /** itens da compra */
  itens: number;
  /** itens com tudo recebido */
  completos: number;
  /** já chegou alguma coisa: cancelar é recusado, o caminho é encerrar com pendência */
  temRecebimento: boolean;
};

export function chegadaDaCompra(itens: Pick<ItemCompraDoPedidoRaw, "quantidade" | "quantidade_recebida">[]): ChegadaDaCompra {
  let completos = 0;
  let temRecebimento = false;
  for (const item of itens) {
    const recebida = Number(item.quantidade_recebida ?? 0);
    if (recebida > 0) temRecebimento = true;
    if (recebida >= Number(item.quantidade)) completos += 1;
  }
  return { itens: itens.length, completos, temRecebimento };
}

/** A compra ainda espera chegada: é onde "Encerrar com pendência" faz sentido. */
export function compraEmAndamento(status: string | null | undefined) {
  return ["aprovado", "enviado", "em_transito"].includes(String(status ?? ""));
}
