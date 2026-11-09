import { describe, expect, it } from "vitest";

import { montarEstoqueParaPedido } from "./estoque-para-pedido";

describe("montarEstoqueParaPedido", () => {
  it("separa disponível, reservado e a caminho e lista os locais guardados", () => {
    const mapa = montarEstoqueParaPedido(
      [{ insumo_id: 1, disponivel: "4", reservado: 2, unidade_saldo: "frasco", unidade: "mL" }],
      [
        { insumo_id: 1, qtd_pedida_aberta: 3, qtd_compra_atrasada: 1 },
        { insumo_id: 2, qtd_pedida_aberta: 5, qtd_compra_atrasada: 0 },
      ],
      [
        { insumo_id: 1, status: "aceito", quantidade_atual: 2, locais: { nome: "LQA · Geladeira 2" } },
        { insumo_id: 1, status: "em_uso", quantidade_atual: 1, locais: [{ nome: "Genética · Armário A" }] },
        { insumo_id: 1, status: "aceito", quantidade_atual: 1, locais: { nome: "LQA · Geladeira 2" } },
        { insumo_id: 1, status: "consumido", quantidade_atual: 1, locais: { nome: "Descarte" } },
        { insumo_id: 1, status: "aceito", quantidade_atual: 0, locais: { nome: "Vazio" } },
        { insumo_id: 1, status: "quarentena", quantidade_atual: 1, locais: null },
      ],
    );
    expect(mapa.get(1)).toEqual({
      disponivel: 4,
      reservado: 2,
      aCaminho: 3,
      aCaminhoAtrasado: 1,
      unidade: "frasco",
      locais: ["Genética · Armário A", "LQA · Geladeira 2", "Sem local informado"],
    });
    // sem saldo registrado, mas com compra aberta: disponível fica desconhecido, não zero
    expect(mapa.get(2)).toMatchObject({ disponivel: null, aCaminho: 5, locais: [] });
  });
});
