import { describe, expect, it } from "vitest";
import { pedidoQueSeguraCompra } from "./status";

describe("pedidoQueSeguraCompra (D1, 0130)", () => {
  it("compra sem pedido interno segue a regra própria", () => {
    expect(pedidoQueSeguraCompra([])).toBeNull();
  });

  it("pedido antes de 'Aprovado para compra' segura a compra", () => {
    expect(pedidoQueSeguraCompra([{ id: 7, status: "formalizado" }])).toEqual({
      id: 7,
      rotulo: "Aguardando administrativo",
    });
  });

  it("pedido aprovado para compra (ou depois) libera; cancelado não conta", () => {
    expect(
      pedidoQueSeguraCompra([
        { id: 3, status: "aprovado_para_compra" },
        { id: 4, status: "encaminhado_instituicao" },
        { id: 5, status: "cancelado" },
      ]),
    ).toBeNull();
  });

  it("com vários pedidos, aponta o de menor número que ainda segura", () => {
    expect(
      pedidoQueSeguraCompra([
        { id: 9, status: "orcamentos" },
        { id: 2, status: "aguardando_aprovacao_final" },
        { id: 1, status: "compra_concluida" },
      ]),
    ).toEqual({ id: 2, rotulo: "Aguardando aprovação final" });
  });
});
