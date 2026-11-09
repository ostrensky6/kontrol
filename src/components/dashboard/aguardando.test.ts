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

  it("0173: etapas por competência (laboratório, administrativo, compras e pagamento) abrem o pedido", () => {
    const pendencias = montarPendencias([
      { chave: "pedidos_laboratorio", quantidade: 1, itens: [{ id: 5, rotulo: "#5 · Primers" }] },
      { chave: "pedidos_administrativo", quantidade: 2, itens: [{ id: 6 }] },
      { chave: "pedidos_compras", quantidade: 1, itens: [{ id: 8 }] },
      { chave: "pedidos_pagamento", quantidade: 1, itens: [{ id: 9 }] },
    ]);
    expect(pendencias.map((p) => [p.chave, p.titulo, p.itens[0].href])).toEqual([
      ["pedidos_laboratorio", "Pedidos para a coordenação do laboratório", "/pedido/5"],
      ["pedidos_administrativo", "Pedidos para formalizar e autorizar", "/pedido/6"],
      ["pedidos_compras", "Pedidos em compra", "/pedido/8"],
      ["pedidos_pagamento", "Pedidos para pagar", "/pedido/9"],
    ]);
  });
});
