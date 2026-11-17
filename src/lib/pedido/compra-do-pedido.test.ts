import { describe, expect, it } from "vitest";

import {
  chegadaDaCompra,
  compraEmAndamento,
  compraSemFornecedor,
  envioDaCompra,
  fornecedorCadastradoComNome,
  hrefDoPainelDaCompra,
  hrefDoPedidoQueConduz,
  pedidoMostraPainelDaCompra,
  pedidoQueConduzCompra,
} from "./compra-do-pedido";

describe("compra única na tela: o pedido conduz a compra", () => {
  it("o pedido vivo mais antigo conduz a compra; cancelado não conduz", () => {
    expect(pedidoQueConduzCompra([{ id: 9, status: "compra_fechada" }, { id: 4, status: "aprovado_para_compra" }])?.id).toBe(4);
    expect(pedidoQueConduzCompra([{ id: 4, status: "cancelado" }, { id: 9, status: "compra_fechada" }])?.id).toBe(9);
    expect(pedidoQueConduzCompra([{ id: 4, status: "cancelado" }])).toBeNull();
    // compra de pendência ou rascunho de reposição: sem pedido, segue na própria tela
    expect(pedidoQueConduzCompra([])).toBeNull();
  });

  it("a lista de compras e a tela da compra abrem o pedido já no painel", () => {
    expect(hrefDoPainelDaCompra(504)).toBe("/pedido/504#compra");
    expect(hrefDoPedidoQueConduz({ id: 504, status: "compra_fechada" })).toBe("/pedido/504#compra");
    // antes de "Compra e entrega" o pedido ainda não tem o painel: o link abre o pedido
    expect(hrefDoPedidoQueConduz({ id: 504, status: "orcamentos" })).toBe("/pedido/504");
  });

  it("o painel aparece no pedido de 'Compra e entrega' em diante", () => {
    for (const status of ["aprovado_para_compra", "compra_fechada", "encaminhado_instituicao", "aguardando_pagamento_nf", "compra_concluida"]) {
      expect(pedidoMostraPainelDaCompra(status)).toBe(true);
    }
    for (const status of ["rascunho", "formalizado", "orcamentos_recebidos", "aguardando_aprovacao_final", "cancelado", null, undefined]) {
      expect(pedidoMostraPainelDaCompra(status)).toBe(false);
    }
  });

  it("o envio da compra, visto do pedido", () => {
    // antes de fechar: o próprio 'Fechar com fornecedor' envia (0182)
    expect(envioDaCompra("aprovado_para_compra", "aprovado")).toBe("no_fechamento");
    // Fundação ou Universidade: são dois momentos, o segundo é o botão do painel
    expect(envioDaCompra("encaminhado_instituicao", "aprovado")).toBe("instituicao");
    // pedido fechado antes da 0182, com a compra ainda aprovada
    expect(envioDaCompra("compra_fechada", "aprovado")).toBe("pendente");
    expect(envioDaCompra("aguardando_pagamento_nf", "aprovado")).toBe("pendente");
    expect(envioDaCompra("compra_concluida", "aprovado")).toBe("pendente");
    // já enviada, recebida, cancelada ou ainda solicitada: nada a fazer aqui
    for (const status of ["solicitado", "enviado", "em_transito", "recebido", "cancelado"]) {
      expect(envioDaCompra("compra_fechada", status)).toBeNull();
      expect(envioDaCompra("encaminhado_instituicao", status)).toBeNull();
    }
    expect(envioDaCompra("orcamentos", "aprovado")).toBeNull();
  });

  it("a compra sem fornecedor pede o fornecedor enquanto está em andamento", () => {
    expect(compraSemFornecedor({ id: 1, status: "aprovado", fornecedor_id: null })).toBe(true);
    expect(compraSemFornecedor({ id: 1, status: "enviado", fornecedor_id: null })).toBe(true);
    expect(compraSemFornecedor({ id: 1, status: "aprovado", fornecedor_id: 7 })).toBe(false);
    expect(compraSemFornecedor({ id: 1, status: "recebido", fornecedor_id: null })).toBe(false);
    expect(compraSemFornecedor({ id: 1, status: "cancelado", fornecedor_id: null })).toBe(false);
    expect(compraSemFornecedor(null)).toBe(false);
  });

  it("o nome digitado no orçamento acha o fornecedor cadastrado sem diferenciar maiúsculas", () => {
    const cadastrados = [{ id: 1, nome: "Sigma Aldrich" }, { id: 2, nome: "Thermo Fisher" }];
    expect(fornecedorCadastradoComNome("  sigma aldrich ", cadastrados)?.id).toBe(1);
    expect(fornecedorCadastradoComNome("Sigma", cadastrados)).toBeNull();
    expect(fornecedorCadastradoComNome(null, cadastrados)).toBeNull();
    expect(fornecedorCadastradoComNome("", cadastrados)).toBeNull();
  });

  it("a chegada da compra conta itens completos e sabe se algo já chegou", () => {
    expect(chegadaDaCompra([])).toEqual({ itens: 0, completos: 0, temRecebimento: false });
    expect(chegadaDaCompra([
      { quantidade: 3, quantidade_recebida: 3 },
      { quantidade: "4", quantidade_recebida: "1" },
      { quantidade: 2, quantidade_recebida: null },
    ])).toEqual({ itens: 3, completos: 1, temRecebimento: true });
    expect(chegadaDaCompra([{ quantidade: 2, quantidade_recebida: 0 }]).temRecebimento).toBe(false);
  });

  it("encerrar com pendência só faz sentido com a compra em andamento", () => {
    expect(["aprovado", "enviado", "em_transito"].every(compraEmAndamento)).toBe(true);
    expect(["solicitado", "recebido", "cancelado", null, undefined].some(compraEmAndamento)).toBe(false);
  });
});
