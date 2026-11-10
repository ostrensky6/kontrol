import { describe, expect, it } from "vitest";

import { separarPedidoAberto } from "./pedido-aberto";

describe("pedido aberto: a caminho x aguardando aprovação", () => {
  it("só o que já foi aprovado ou comprado conta como a caminho", () => {
    expect(separarPedidoAberto(10, 4)).toEqual({ aCaminho: 6, aguardandoAprovacao: 4 });
    expect(separarPedidoAberto("10", null)).toEqual({ aCaminho: 10, aguardandoAprovacao: 0 });
  });

  it("pedido que só espera aprovação não aparece como a caminho", () => {
    expect(separarPedidoAberto(5, 5)).toEqual({ aCaminho: 0, aguardandoAprovacao: 5 });
    // pendente maior que o total (leitura incoerente) não gera a caminho negativo
    expect(separarPedidoAberto(5, 8)).toEqual({ aCaminho: 0, aguardandoAprovacao: 5 });
  });

  it("sem leitura da previsão é informação ausente, não zero", () => {
    expect(separarPedidoAberto(undefined, undefined)).toEqual({ aCaminho: null, aguardandoAprovacao: null });
    expect(separarPedidoAberto(null, 3)).toEqual({ aCaminho: null, aguardandoAprovacao: null });
    expect(separarPedidoAberto(0, 0)).toEqual({ aCaminho: 0, aguardandoAprovacao: 0 });
  });
});
