import type { ItemCompraRecebivel } from "@/components/compras/ScannerRecebimentoCompra";
import { emFrascos } from "@/lib/estoque/quantidade-compra";

/**
 * Chegada única (auditoria de 16/11, item 10). O item de pedido que virou
 * compra é recebido pelo item da compra: o banco recusa a chegada pelo pedido
 * (0123) e, ao registrar pela compra, já atualiza o item do pedido (0127).
 * Aqui fica a regra de quando essa chegada pode ser registrada, para a tela de
 * Chegadas, o pedido e a compra oferecerem o mesmo "Registrar chegada".
 */

/** Situações da compra em que a chegada de um item pode ser registrada. */
export const COMPRA_ACEITA_CHEGADA = ["aprovado", "enviado", "em_transito"];

export function compraAceitaChegada(status: string | null | undefined) {
  return COMPRA_ACEITA_CHEGADA.includes(String(status ?? ""));
}

/**
 * Colunas de `pedidos_compra_itens` que o diálogo "Registrar chegada" usa.
 *
 * O item da compra aponta para `pedidos_compra` por duas colunas: `pedido_id`
 * (a compra dele) e `compra_pendencia_id` (a nova compra da pendência, 0130).
 * Sem dizer qual, o banco recusa a leitura (PGRST201); por isso o nome da
 * chave vai escrito. A guarda `embed-compra-guarda.test.ts` cobra isso.
 */
export const COLUNAS_ITEM_COMPRA_DO_PEDIDO =
  "id, pedido_id, pedido_interno_item_id, insumo_id, quantidade, quantidade_recebida, quantidade_em, conteudo_embalagem, insumos(especificacao, unidade), pedidos_compra!pedidos_compra_itens_pedido_id_fkey!inner(id, status)";

export type ItemCompraDoPedidoRaw = {
  id: number;
  pedido_id: number;
  pedido_interno_item_id: number | null;
  insumo_id: number | null;
  quantidade: number | string;
  quantidade_recebida: number | string | null;
  quantidade_em: string | null;
  conteudo_embalagem: number | string | null;
  insumos: { especificacao: string | null; unidade: string | null } | null;
  pedidos_compra: { id: number; status: string } | null;
};

/**
 * Por item de pedido, o item da compra onde a chegada pode ser registrada
 * agora: compra aprovada, enviada ou em trânsito e ainda com saldo a chegar.
 * Com mais de uma compra para o mesmo item (nova compra da pendência), vale a
 * mais antiga que ainda espera chegada.
 */
export function chegadasPelaCompra(itens: ItemCompraDoPedidoRaw[]): Map<number, ItemCompraRecebivel> {
  const porItemDoPedido = new Map<number, ItemCompraRecebivel>();
  const emOrdem = [...itens].sort((a, b) => Number(a.id) - Number(b.id));
  for (const item of emOrdem) {
    const itemDoPedido = item.pedido_interno_item_id;
    if (itemDoPedido == null || porItemDoPedido.has(itemDoPedido)) continue;
    if (!compraAceitaChegada(item.pedidos_compra?.status)) continue;
    const quantidade = Number(item.quantidade);
    const recebida = Number(item.quantidade_recebida ?? 0);
    if (!(recebida < quantidade)) continue;
    porItemDoPedido.set(itemDoPedido, {
      id: item.id,
      pedidoId: item.pedido_id,
      quantidade,
      quantidadeRecebida: recebida,
      insumoId: item.insumo_id,
      insumoDescricao: item.insumos?.especificacao ?? null,
      unidade: item.insumos?.unidade ?? null,
      emFrascos: emFrascos(item),
      conteudoEmbalagem: item.conteudo_embalagem == null ? null : Number(item.conteudo_embalagem),
    });
  }
  return porItemDoPedido;
}
