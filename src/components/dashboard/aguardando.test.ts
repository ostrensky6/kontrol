import { describe, expect, it } from "vitest";
import {
  PENDENCIAS_DE_COMPRAS,
  PENDENCIAS_DE_ESTOQUE,
  PENDENCIAS_DE_PEDIDOS,
  PENDENCIAS_DE_PLANEJAMENTO,
  PENDENCIAS_DO_APP,
  destinoDaPendencia,
  montarPendenciaDoApp,
  montarPendencias,
  pendenciasDe,
  totalPendencias,
} from "./aguardando";

describe("montarPendencias", () => {
  it("traduz a resposta do banco em texto e links, só com o que tem contagem", () => {
    const pendencias = montarPendencias([
      { chave: "pedidos_validacao", quantidade: 2, itens: [{ id: 7, rotulo: "#7 · Reagentes" }] },
      { chave: "compras_aprovar", quantidade: 0, itens: [] },
      { chave: "compras_receber", quantidade: "1", itens: [{ id: 3 }] },
      // 0130: a função do banco não devolve mais quarentena; se devolver, não vira pendência por aqui
      // (lotes em quarentena são lidos pelo app, com a permissão de aceitar lote)
      { chave: "lotes_quarentena", quantidade: 4, itens: [] },
    ]);
    expect(pendencias).toEqual([
      {
        chave: "pedidos_validacao",
        titulo: "Pedidos para você aprovar",
        acao: "aprovar ou devolver ao solicitante",
        frase: "2 pedidos esperam a sua aprovação",
        quantidade: 2,
        href: "/pedido?etapa=aprovacao",
        itens: [{ id: 7, rotulo: "#7 · Reagentes", href: "/pedido/7" }],
      },
      {
        chave: "compras_receber",
        titulo: "Compras para receber",
        acao: "registrar a chegada dos itens",
        frase: "1 compra espera o registro da chegada",
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
      ["pedidos_compras", "Pedidos em cotação e compra", "/pedido/8"],
      ["pedidos_pagamento", "Pedidos para pagar", "/pedido/9"],
    ]);
  });

  it("separa o que é de Pedidos e o que é de Suprimentos; as listas abrem na etapa certa", () => {
    const pendencias = montarPendencias([
      { chave: "pedidos_validacao", quantidade: 1, itens: [] },
      { chave: "pedidos_laboratorio", quantidade: 1, itens: [] },
      { chave: "pedidos_administrativo", quantidade: 1, itens: [] },
      { chave: "compras_receber", quantidade: 2, itens: [] },
      { chave: "propostas_emitir", quantidade: 3, itens: [] },
      { chave: "planos_rascunho", quantidade: 1, itens: [] },
    ]);
    expect(pendenciasDe(pendencias, PENDENCIAS_DE_PEDIDOS).map((p) => [p.chave, p.href])).toEqual([
      ["pedidos_validacao", "/pedido?etapa=aprovacao"],
      ["pedidos_laboratorio", "/pedido?etapa=aprovacao"],
      ["pedidos_administrativo", "/pedido?etapa=administrativo"],
    ]);
    expect(pendenciasDe(pendencias, PENDENCIAS_DE_COMPRAS).map((p) => p.chave)).toEqual([
      "pedidos_validacao",
      "pedidos_laboratorio",
      "pedidos_administrativo",
      "compras_receber",
    ]);
    expect(pendenciasDe(pendencias, PENDENCIAS_DE_PLANEJAMENTO).map((p) => p.chave)).toEqual(["planos_rascunho"]);
  });

  it("organização de 11/11: toda pendência que era de Suprimentos tem um módulo só, e nenhuma se perde", () => {
    const antes = [
      ...PENDENCIAS_DE_PEDIDOS,
      "compras_aprovar",
      "compras_receber",
      "planos_rascunho",
      ...PENDENCIAS_DO_APP,
    ];
    const agora = [...PENDENCIAS_DE_COMPRAS, ...PENDENCIAS_DE_ESTOQUE, ...PENDENCIAS_DE_PLANEJAMENTO];
    expect([...agora].sort()).toEqual([...antes].sort());
    expect(new Set(agora).size).toBe(agora.length);
  });
});

describe("pendências lidas pelo app (revisão de 11/11, F8)", () => {
  it("sem itens não vira pendência; com itens, mostra até três pelo nome e conta todos", () => {
    expect(montarPendenciaDoApp("codigos_triagem", [])).toBeNull();
    const itens = [1, 2, 3, 4].map((id) => ({ id, rotulo: `Disputa #${id}` }));
    const disputas = montarPendenciaDoApp("disputas_decidir", itens)!;
    expect(disputas.quantidade).toBe(4);
    expect(disputas.frase).toBe("4 disputas de reserva esperam a sua decisão");
    expect(disputas.href).toBe("/planejamento/disputas");
    expect(disputas.itens.map((item) => item.href)).toEqual([
      "/planejamento/disputas#disputa-1",
      "/planejamento/disputas#disputa-2",
      "/planejamento/disputas#disputa-3",
    ]);
  });

  it("cada pendência do app abre a tela onde se resolve", () => {
    const um = [{ id: 9, rotulo: "x" }];
    expect(montarPendenciaDoApp("lotes_quarentena", um)).toMatchObject({ href: "/estoque?ver=lotes", itens: [{ href: "/estoque/lotes/9" }] });
    expect(montarPendenciaDoApp("codigos_triagem", um)).toMatchObject({ href: "/scanner/triagem", frase: "1 código lido ainda não tem cadastro" });
    expect(montarPendenciaDoApp("equipamentos_vencidos", um)).toMatchObject({
      href: "/estoque/equipamentos",
      itens: [{ href: "/estoque/equipamentos?focus=9" }],
    });
  });

  it("entram no Estoque, não em Compras nem em Pedidos", () => {
    const triagem = montarPendenciaDoApp("codigos_triagem", [{ id: 1, rotulo: "Código 789" }])!;
    expect(pendenciasDe([triagem], PENDENCIAS_DE_ESTOQUE)).toHaveLength(1);
    expect(pendenciasDe([triagem], PENDENCIAS_DE_COMPRAS)).toHaveLength(0);
    expect(pendenciasDe([triagem], PENDENCIAS_DE_PEDIDOS)).toHaveLength(0);
  });
});

describe("linha Sua vez (D4)", () => {
  it("com um item só abre o registro; com vários, a lista", () => {
    const [um] = montarPendencias([{ chave: "pedidos_validacao", quantidade: 1, itens: [{ id: 7, rotulo: "#7" }] }]);
    const [varios] = montarPendencias([{ chave: "pedidos_validacao", quantidade: 3, itens: [{ id: 7, rotulo: "#7" }] }]);
    expect(destinoDaPendencia(um)).toBe("/pedido/7");
    expect(um.frase).toBe("1 pedido espera a sua aprovação");
    expect(destinoDaPendencia(varios)).toBe("/pedido?etapa=aprovacao");
    expect(totalPendencias([um, varios])).toBe(4);
  });
});
