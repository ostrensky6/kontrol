import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/pedidos-internos", () => ({
  estornarRecebimentoItem: vi.fn(),
  estornarRecebimentoLancamento: vi.fn(),
}));
vi.mock("@/components/compras/ScannerRecebimentoCompra", () => ({
  ScannerRecebimentoCompra: () => createElement("button", { type: "button" }, "Registrar chegada"),
}));

import { ItemRecebimentoCell } from "./ItemRecebimentoCell";

type Props = Parameters<typeof ItemRecebimentoCell>[0];

const ITEM: Props["item"] = {
  id: 5,
  pedidoId: 10,
  especificacao: "Kit extração DNA",
  quantidade: 4,
  quantidadeRecebida: 0,
  compraFormalId: null,
  unidade: "kit",
};

function html(props: Partial<Props> = {}) {
  return renderToStaticMarkup(createElement(ItemRecebimentoCell, { item: ITEM, ...props }));
}

/**
 * Auditoria de 16/11, item 10, proposta 1: a chegada é registrada pela compra.
 * O formulário antigo de chegada pelo item do pedido, sem compra, saiu da tela.
 */
describe("chegada do item do pedido", () => {
  it("pedido sem compra ligada não abre chegada pelo item: diz que falta a compra", () => {
    const tela = html({ semCompra: true });
    expect(tela).toContain("aguardando a compra");
    expect(tela).not.toContain("Registrar chegada");
  });

  it("o que já chegou antes continua na linha, com o estorno", () => {
    const tela = html({
      semCompra: true,
      item: { ...ITEM, quantidadeRecebida: 1 },
      recebimentos: [
        {
          id: 15,
          loteId: 7,
          quantidade: 1,
          codigoLote: "L-07",
          fornecedor: "Fornecedor A",
          validade: null,
          responsavel: "Laboratório",
          recebidoEm: "2026-11-10T13:00:00.000Z",
        },
      ],
    });
    expect(tela).toContain("Parcial 1/4 kit");
    expect(tela).toContain("lote L-07");
    expect(tela).toContain("Estornar o lançamento de 1 kit");
    expect(tela).not.toContain("Registrar chegada");
  });

  it("item com compra que aceita chegada usa o Registrar chegada da compra", () => {
    const tela = html({
      item: { ...ITEM, compraFormalId: 9401 },
      chegadaPelaCompra: {
        item: {
          id: 94011,
          pedidoId: 9401,
          quantidade: 4,
          quantidadeRecebida: 0,
          insumoId: 1,
          insumoDescricao: "Kit extração DNA",
          unidade: "kit",
          emFrascos: false,
          conteudoEmbalagem: null,
        },
        locais: [{ id: 1, nome: "Geladeira 1" }],
      },
    });
    expect(tela).toContain("Registrar chegada");
    expect(tela).toContain("Compra #9401");
  });

  it("sem compra e sem permissão: só a etapa", () => {
    expect(html()).toContain("aguardando etapa");
  });
});
