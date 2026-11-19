import { describe, expect, it } from "vitest";

import {
  contarItensNovos,
  ehItemNovo,
  insumosParecidos,
  lerDadosInsumoDoItem,
  motivoItensSemCadastro,
  nomeNormalizado,
  sugerirInsumoDoItem,
} from "./item-novo";

/** Pergunta do Giorgi, trazida pela Rafaela em 19/11/2026: e se alguém quiser comprar algo que nunca foi comprado? */
describe("item novo: material ou equipamento sem insumo do cadastro", () => {
  it("material e equipamento sem insumo são item novo; serviço e item ligado não são", () => {
    expect(ehItemNovo({ tipo: "material", insumo_id: null })).toBe(true);
    expect(ehItemNovo({ tipo: "equipamento", insumo_id: "" })).toBe(true);
    // sem tipo informado, o pedido grava "material"
    expect(ehItemNovo({ insumo_id: null })).toBe(true);
    expect(ehItemNovo({ tipo: "servico", insumo_id: null })).toBe(false);
    expect(ehItemNovo({ tipo: "material", insumo_id: 12 })).toBe(false);
    expect(ehItemNovo({ tipo: "material", insumo_id: "12" })).toBe(false);
    expect(contarItensNovos([{ tipo: "material" }, { tipo: "servico" }, { tipo: "equipamento", insumo_id: 3 }])).toBe(1);
  });

  it("a formalização diz o que falta, e a quem pedir quando a pessoa não cadastra insumo", () => {
    const itens = [{ tipo: "material", insumo_id: null }, { tipo: "equipamento", insumo_id: null }, { tipo: "servico" }];
    expect(motivoItensSemCadastro(itens, { podeCadastrar: true })).toBe(
      "Há 2 itens novos, ainda sem cadastro. Use “Cadastrar insumo” na lista de itens antes de formalizar.",
    );
    expect(motivoItensSemCadastro(itens.slice(0, 1), { podeCadastrar: false })).toBe(
      "Há 1 item novo, ainda sem cadastro. Cadastrar o insumo pede a permissão “Editar insumos”. Peça ao administrador, em Usuários, ou a quem cuida do cadastro.",
    );
    expect(motivoItensSemCadastro([{ tipo: "material", insumo_id: 4 }, { tipo: "servico" }], { podeCadastrar: false })).toBeNull();
    expect(motivoItensSemCadastro([], { podeCadastrar: true })).toBeNull();
  });
});

describe("cadastro sugerido a partir do item escrito à mão", () => {
  it("“Volume” com número e unidade vira a embalagem", () => {
    expect(
      sugerirInsumoDoItem({ especificacao: " Tampão TE 1X ", modelo: "Sigma", volume: "500 mL", unidade: "frasco", orcamento_previo: 180 }),
    ).toEqual({ especificacao: "Tampão TE 1X", fabricante: "Sigma", unidade: "mL", quantidadeEmbalagem: "500", custoEmbalagem: "180" });
    expect(sugerirInsumoDoItem({ especificacao: "Etanol", volume: "2,5 L" })).toMatchObject({ unidade: "L", quantidadeEmbalagem: "2.5" });
  });

  it("sem volume legível, a embalagem é 1 da unidade do item", () => {
    expect(sugerirInsumoDoItem({ especificacao: "Ponteira 10 µL", volume: "caixa c/ 96", unidade: "caixa" })).toMatchObject({
      unidade: "caixa",
      quantidadeEmbalagem: "1",
      custoEmbalagem: "",
    });
    expect(sugerirInsumoDoItem({ especificacao: "Pinça" })).toMatchObject({ unidade: "un", quantidadeEmbalagem: "1" });
  });
});

describe("parecidos no cadastro", () => {
  const catalogo = [
    { id: 1, especificacao: "Tampão TE 1X pH 8,0", codigoFabricante: "T9285", sinonimos: ["TE buffer"] },
    { id: 2, especificacao: "Ponteira com filtro 10 µL", nomeItem: "Ponteira", sinonimos: ["tip", "pipette tip"] },
    { id: 3, especificacao: "Etanol absoluto", codigoFabricante: null },
    { id: 4, especificacao: "Kit de extração de DNA", codigoFabricante: "69504" },
  ];

  it("acha pelo nome, sem acento e sem caixa, e pelo sinônimo", () => {
    expect(insumosParecidos({ especificacao: "tampao te" }, catalogo).map((i) => i.id)).toEqual([1]);
    expect(insumosParecidos({ especificacao: "Tip 10 µL com filtro" }, catalogo).map((i) => i.id)).toEqual([2]);
  });

  it("acha pelo código do fabricante mesmo com outro nome", () => {
    expect(insumosParecidos({ especificacao: "DNeasy Blood & Tissue", codigoFabricante: " 69504 " }, catalogo).map((i) => i.id)).toEqual([4]);
  });

  it("item sem nada em comum não traz sugestão; a lista respeita o limite", () => {
    expect(insumosParecidos({ especificacao: "Centrífuga refrigerada" }, catalogo)).toEqual([]);
    expect(insumosParecidos({ especificacao: "" }, catalogo)).toEqual([]);
    const muitos = Array.from({ length: 8 }, (_, i) => ({ id: i + 10, especificacao: `Luva nitrílica tamanho ${i}` }));
    expect(insumosParecidos({ especificacao: "Luva nitrílica" }, muitos)).toHaveLength(3);
  });

  it("nome normalizado ignora acento, caixa, pontuação e espaço repetido", () => {
    expect(nomeNormalizado("  Tampão  TE-1X (pH 8,0) ")).toBe("tampao te 1x ph 8 0");
    expect(nomeNormalizado(null)).toBe("");
  });
});

describe("dados do formulário “Cadastrar insumo”", () => {
  function formulario(campos: Record<string, string>) {
    const dados = new FormData();
    for (const [campo, valor] of Object.entries(campos)) dados.set(campo, valor);
    return dados;
  }
  const completo = {
    insumo_especificacao: " Tampão TE 1X ",
    insumo_fabricante: "Sigma",
    insumo_codigo_fabricante: "",
    insumo_unidade: "mL",
    insumo_quantidade_embalagem: "500",
    insumo_custo_embalagem: "180,50",
  };

  it("lê os campos; valor R$ 0 vale e código vazio fica sem código", () => {
    expect(lerDadosInsumoDoItem(formulario(completo))).toEqual({
      ok: true,
      dados: {
        especificacao: "Tampão TE 1X",
        fabricante: "Sigma",
        codigo_fabricante: null,
        unidade: "mL",
        quantidade_embalagem: 500,
        custo_total_embalagem: 180.5,
        fator_conversao: 1,
      },
    });
    expect(lerDadosInsumoDoItem(formulario({ ...completo, insumo_custo_embalagem: "0" }))).toMatchObject({ ok: true });
  });

  it("recusa sem nome, sem unidade, embalagem zerada ou valor negativo", () => {
    expect(lerDadosInsumoDoItem(formulario({ ...completo, insumo_especificacao: "  " }))).toEqual({
      ok: false,
      message: "Informe o nome do insumo (item específico / SKU).",
    });
    expect(lerDadosInsumoDoItem(formulario({ ...completo, insumo_unidade: "" }))).toMatchObject({ ok: false });
    expect(lerDadosInsumoDoItem(formulario({ ...completo, insumo_quantidade_embalagem: "0" }))).toEqual({
      ok: false,
      message: "Informe quanto vem em 1 embalagem (maior que zero).",
    });
    expect(lerDadosInsumoDoItem(formulario({ ...completo, insumo_custo_embalagem: "-1" }))).toMatchObject({ ok: false });
    expect(lerDadosInsumoDoItem(formulario({ ...completo, insumo_custo_embalagem: "" }))).toMatchObject({ ok: false });
  });
});
