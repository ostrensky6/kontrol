import { describe, expect, it } from "vitest";

import { diasEntre, montarACaminho, resumirACaminho } from "./a-caminho";

const base = {
  compras: [
    { id: 10, data_solicitacao: "2026-10-01", data_prevista_entrega: "2026-11-01", fornecedores: { nome: "Kasvi" } },
    { id: 11, data_solicitacao: "2026-11-05", data_prevista_entrega: null, fornecedores: [] },
  ],
  itens: [
    { id: 100, pedido_id: 10, quantidade: 10, quantidade_recebida: 4, quantidade_em: "unidade", conteudo_embalagem: null, lote_id: null },
    { id: 101, pedido_id: 11, quantidade: 3, quantidade_recebida: null, quantidade_em: "embalagem", conteudo_embalagem: 500, lote_id: null },
    { id: 102, pedido_id: 11, quantidade: 2, quantidade_recebida: null, quantidade_em: "unidade", conteudo_embalagem: null, lote_id: 7 },
  ],
  pedidosInternos: [
    { id: 5, pedido_compra_id: 10, instituicao_destino: "FUNPAR", modalidade_compra: "fundacao" },
    { id: 6, pedido_compra_id: 11, instituicao_destino: null, modalidade_compra: "compra_direta" },
  ],
  insumos: [
    { id: 1, especificacao: "Ponteira 200 µL", unidade: "caixa" },
    { id: 2, especificacao: "Etanol absoluto", unidade: "mL" },
  ],
  hojeIso: "2026-11-09",
};

describe("montarACaminho", () => {
  it("mostra só o que falta receber, com previsão informada ou estimada e atraso", () => {
    const lista = montarACaminho({
      ...base,
      prazos: [
        { pedido_id: 11, item_id: 101, insumo_id: 2, status: "aprovado", qtd_restante: 1500, prevista: "2026-11-20" },
        { pedido_id: 10, item_id: 100, insumo_id: 1, status: "enviado", qtd_restante: "6", prevista: "2026-11-01" },
        // recebido inteiro (qtd_restante 0) não entra
        { pedido_id: 11, item_id: 102, insumo_id: 1, status: "aprovado", qtd_restante: 0, prevista: "2026-11-20" },
      ],
    });
    expect(lista).toHaveLength(2);
    const [atrasado, estimado] = lista;
    expect(atrasado).toMatchObject({
      compraId: 10,
      pedidoInternoId: 5,
      especificacao: "Ponteira 200 µL",
      solicitado: "10 caixa",
      recebido: "4 caixa",
      pendente: "6 caixa",
      fornecedor: "Kasvi",
      caminho: "FUNPAR",
      previsaoInformada: true,
      diasAtraso: 8,
      situacao: "Enviada ao fornecedor",
    });
    expect(estimado).toMatchObject({
      compraId: 11,
      pendente: "3 frascos de 500 mL",
      recebido: "0 frascos de 500 mL",
      previsao: "2026-11-20",
      previsaoInformada: false,
      diasAtraso: null,
      caminho: "Compra direta",
      pendenteEstoque: 1500,
    });
    expect(resumirACaminho(lista)).toEqual({ itens: 2, compras: 2, atrasados: 1, semPrevisaoInformada: 1 });
  });

  it("sem previsão vai para o fim e não inventa data", () => {
    const lista = montarACaminho({
      ...base,
      prazos: [
        { pedido_id: 11, item_id: 101, insumo_id: 2, status: "solicitado", qtd_restante: 3, prevista: null },
        { pedido_id: 10, item_id: 100, insumo_id: 1, status: "aprovado", qtd_restante: 6, prevista: "2026-12-01" },
      ],
      compras: [{ ...base.compras[0], data_prevista_entrega: null }, base.compras[1]],
    });
    expect(lista.map((i) => i.compraId)).toEqual([10, 11]);
    expect(lista[1]).toMatchObject({ previsao: null, diasAtraso: null, situacao: "Compra aguardando aprovação" });
  });

  it("conta dias corridos entre datas", () => {
    expect(diasEntre("2026-11-01", "2026-11-09")).toBe(8);
    expect(diasEntre("2026-11-09", "2026-11-01")).toBe(-8);
  });
});
