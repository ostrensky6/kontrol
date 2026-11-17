import { describe, expect, it } from "vitest";

import {
  MAXIMO_ITENS_NOVO_PEDIDO,
  faltaNoItem,
  faltaNosItens,
  lerItensNovoPedido,
  normalizarItemNovoPedido,
} from "./itens-novo-pedido";

const PONTEIRA = { tipo: "material", insumo_id: "12", especificacao: " Ponteira 200 uL ", quantidade: "5", unidade: "cx", orcamento_previo: "80,5" };

describe("itens do Novo pedido (ajuste 4 de 17/11/2026)", () => {
  it("converte o texto do formulário no item que o banco recebe", () => {
    expect(normalizarItemNovoPedido(PONTEIRA)).toEqual({
      tipo: "material",
      insumo_id: 12,
      especificacao: "Ponteira 200 uL",
      quantidade: 5,
      unidade: "cx",
      modelo: null,
      volume: null,
      fornecedor_sugerido: null,
      orcamento_previo: 80.5,
      observacao: null,
      caracteristicas: null,
      exigencia_tecnica: null,
      exclusividade: null,
      outros_fornecedores: null,
    });
  });

  it("tipo desconhecido vira material; insumo inválido e objeto no lugar de texto ficam vazios", () => {
    const item = normalizarItemNovoPedido({ tipo: "outro", insumo_id: "-3", especificacao: { x: 1 }, quantidade: "abc" });
    expect(item.tipo).toBe("material");
    expect(item.insumo_id).toBeNull();
    expect(item.especificacao).toBeNull();
    expect(item.quantidade).toBeNull();
    expect(normalizarItemNovoPedido({ tipo: "servico" }).tipo).toBe("servico");
  });

  it("corta os textos longos no limite das colunas", () => {
    const item = normalizarItemNovoPedido({ caracteristicas: "x".repeat(2500), outros_fornecedores: "y".repeat(1500) });
    expect(item.caracteristicas).toHaveLength(2000);
    expect(item.outros_fornecedores).toHaveLength(1000);
  });

  it("item só entra na lista com especificação, quantidade e unidade", () => {
    expect(faltaNoItem({ especificacao: null, quantidade: 1, unidade: "un" })).toBe("Informe a especificação do item.");
    expect(faltaNoItem({ especificacao: "Luva", quantidade: 0, unidade: "un" })).toBe("Informe uma quantidade maior que zero.");
    expect(faltaNoItem({ especificacao: "Luva", quantidade: 2, unidade: null })).toContain("Informe a unidade");
    expect(faltaNoItem({ especificacao: "Luva", quantidade: 2, unidade: "cx" })).toBeNull();
  });

  it("lê a lista do formulário e junta o item que ficou em preenchimento", () => {
    const { itens, erro } = lerItensNovoPedido(JSON.stringify([PONTEIRA]), { especificacao: "Luva nitrílica", quantidade: "2", unidade: "cx" });
    expect(erro).toBeNull();
    expect(itens.map((item) => item.especificacao)).toEqual(["Ponteira 200 uL", "Luva nitrílica"]);
    // campos de item vazios (só a quantidade padrão) não viram item
    expect(lerItensNovoPedido(JSON.stringify([PONTEIRA]), { especificacao: "  ", quantidade: "1" }).itens).toHaveLength(1);
    expect(lerItensNovoPedido(null).itens).toEqual([]);
    expect(lerItensNovoPedido("  ").itens).toEqual([]);
  });

  it("lista ilegível ou grande demais vira erro, sem gravar parte", () => {
    for (const ruim of ["{", '{"a":1}', "[1]", "[null]", "[[]]"]) {
      const lido = lerItensNovoPedido(ruim);
      expect(lido.itens, ruim).toEqual([]);
      expect(lido.erro, ruim).toContain("não pôde ser lida");
    }
    const muitos = JSON.stringify(Array.from({ length: MAXIMO_ITENS_NOVO_PEDIDO + 1 }, () => PONTEIRA));
    expect(lerItensNovoPedido(muitos).erro).toContain(`até ${MAXIMO_ITENS_NOVO_PEDIDO} itens`);
  });

  it("para enviar exige ao menos um item completo; rascunho aceita lista vazia e item sem unidade", () => {
    const completo = normalizarItemNovoPedido(PONTEIRA);
    const semUnidade = normalizarItemNovoPedido({ especificacao: "Luva", quantidade: "2" });
    const semQuantidade = normalizarItemNovoPedido({ especificacao: "Luva", quantidade: "0", unidade: "cx" });
    expect(faltaNosItens([], true)).toBe("Inclua ao menos um material, serviço ou equipamento antes de enviar.");
    expect(faltaNosItens([], false)).toBeNull();
    expect(faltaNosItens([completo], true)).toBeNull();
    expect(faltaNosItens([completo, semUnidade], true)).toBe("Todos os itens precisam de especificação, quantidade e unidade.");
    expect(faltaNosItens([completo, semUnidade], false)).toBeNull();
    expect(faltaNosItens([semQuantidade], false)).toBe("Todo item precisa de especificação e de quantidade maior que zero.");
  });
});
