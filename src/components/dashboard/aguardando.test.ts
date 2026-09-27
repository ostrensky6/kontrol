import { describe, expect, it } from "vitest";
import { montarPendencias } from "./aguardando";

describe("montarPendencias", () => {
  it("traduz a resposta do banco em texto e links, só com o que tem contagem", () => {
    const pendencias = montarPendencias([
      { chave: "pedidos_validacao", quantidade: 2, itens: [{ id: 7, rotulo: "#7 · Reagentes" }] },
      { chave: "compras_aprovar", quantidade: 0, itens: [] },
      { chave: "compras_receber", quantidade: "1", itens: [{ id: 3 }] },
      // 0130: sem quarentena; a chave antiga não vira pendência
      { chave: "lotes_quarentena", quantidade: 4, itens: [] },
    ]);
    expect(pendencias).toEqual([
      {
        chave: "pedidos_validacao",
        titulo: "Pedidos internos para validar",
        acao: "validar ou devolver ao solicitante",
        quantidade: 2,
        href: "/pedido?status=em_validacao",
        itens: [{ id: 7, rotulo: "#7 · Reagentes", href: "/pedido/7" }],
      },
      {
        chave: "compras_receber",
        titulo: "Compras para receber",
        acao: "registrar a chegada dos itens",
        quantidade: 1,
        href: "/recebimento",
        itens: [{ id: 3, rotulo: "#3", href: "/compras/3" }],
      },
    ]);
  });

  it("falha fechada: resposta inválida ou chave desconhecida não vira pendência", () => {
    expect(montarPendencias(null)).toEqual([]);
    expect(montarPendencias({ chave: "pedidos_validacao" })).toEqual([]);
    expect(montarPendencias([{ chave: "outra_coisa", quantidade: 5 }])).toEqual([]);
    expect(montarPendencias([{ chave: "compras_receber", quantidade: 1, itens: [{ id: "x" }] }])[0].itens).toEqual([]);
  });
});
