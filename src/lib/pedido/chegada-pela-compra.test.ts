import { describe, expect, it } from "vitest";
import { chegadasPelaCompra, compraAceitaChegada, type ItemCompraDoPedidoRaw } from "./chegada-pela-compra";

function item(parcial: Partial<ItemCompraDoPedidoRaw>): ItemCompraDoPedidoRaw {
  return {
    id: 1,
    pedido_id: 10,
    pedido_interno_item_id: 100,
    insumo_id: 7,
    quantidade: 5,
    quantidade_recebida: 0,
    quantidade_em: "unidade",
    conteudo_embalagem: null,
    insumos: { especificacao: "Ponteira 200 µL", unidade: "cx" },
    pedidos_compra: { id: 10, status: "enviado" },
    ...parcial,
  };
}

describe("chegada pela compra (chegada única)", () => {
  it("a compra aceita chegada depois de aprovada, enviada ou em trânsito", () => {
    expect(["aprovado", "enviado", "em_transito"].map(compraAceitaChegada)).toEqual([true, true, true]);
    expect(["rascunho", "solicitado", "recebido", "cancelado", "", null, undefined].map(compraAceitaChegada)).toEqual(
      [false, false, false, false, false, false, false],
    );
  });

  it("devolve, por item do pedido, o item da compra pronto para o diálogo", () => {
    const chegadas = chegadasPelaCompra([item({ quantidade: "5", quantidade_recebida: "2" })]);
    expect(chegadas.get(100)).toEqual({
      id: 1,
      pedidoId: 10,
      quantidade: 5,
      quantidadeRecebida: 2,
      insumoId: 7,
      insumoDescricao: "Ponteira 200 µL",
      unidade: "cx",
      emFrascos: false,
      conteudoEmbalagem: null,
    });
  });

  it("item comprado em frascos leva o volume de cada frasco", () => {
    const chegadas = chegadasPelaCompra([item({ quantidade_em: "embalagem", conteudo_embalagem: "500" })]);
    expect(chegadas.get(100)).toMatchObject({ emFrascos: true, conteudoEmbalagem: 500 });
  });

  it("fica de fora o que não pode chegar: compra não aprovada, já recebida, cancelada ou item completo", () => {
    const chegadas = chegadasPelaCompra([
      item({ id: 1, pedido_interno_item_id: 101, pedidos_compra: { id: 10, status: "solicitado" } }),
      item({ id: 2, pedido_interno_item_id: 102, pedidos_compra: { id: 10, status: "recebido" } }),
      item({ id: 3, pedido_interno_item_id: 103, pedidos_compra: { id: 10, status: "cancelado" } }),
      item({ id: 4, pedido_interno_item_id: 104, quantidade_recebida: 5 }),
      item({ id: 5, pedido_interno_item_id: 105, pedidos_compra: null }),
      item({ id: 6, pedido_interno_item_id: null }),
    ]);
    expect(chegadas.size).toBe(0);
  });

  it("com duas compras para o mesmo item, vale a mais antiga que ainda espera chegada", () => {
    const chegadas = chegadasPelaCompra([
      item({ id: 9, pedido_id: 12, pedidos_compra: { id: 12, status: "aprovado" } }),
      item({ id: 3, pedido_id: 10, quantidade_recebida: 5 }),
      item({ id: 7, pedido_id: 11, pedidos_compra: { id: 11, status: "em_transito" } }),
    ]);
    expect(chegadas.get(100)).toMatchObject({ id: 7, pedidoId: 11 });
  });
});
