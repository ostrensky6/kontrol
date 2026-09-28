import { describe, expect, it } from "vitest";
import type { LinhaPlanoCatalogo } from "./catalogo-vivo";
import {
  anosDoProjeto,
  conferenciaRevisao,
  estadoEdicaoProjeto,
  linhasViagemFaltantes,
  normalizarMeses,
  resumirRubricas,
  situacaoQuantidadeViagem,
  subtotalCusto,
} from "./editor";
import { normalizarViagemInputs } from "./travel";

describe("editor de custos de projeto", () => {
  it("calcula PE por meses marcados e as demais rubricas por quantidade", () => {
    expect(subtotalCusto({ rubrica: "PE", quantidade: 1, custo_unitario: 5000, meses_selecionados: [1, 2, 3] })).toBe(15000);
    expect(subtotalCusto({ rubrica: "PE", quantidade: 2, custo_unitario: 5000, meses_selecionados: [] })).toBe(10000);
    expect(subtotalCusto({ rubrica: "MC", quantidade: 2.5, custo_unitario: 10, meses_selecionados: [1] })).toBe(25);
  });

  it("resume as seis rubricas na ordem PE, MC, MP, ST, VD, OU", () => {
    const resumo = resumirRubricas([
      { rubrica: "MC", quantidade: 1, custo_unitario: 500 },
      { rubrica: "MC", quantidade: 2, custo_unitario: 10 },
      { rubrica: "PE", quantidade: 1, custo_unitario: 100, meses_selecionados: [1, 2] },
      { rubrica: null, quantidade: 1, custo_unitario: 7 },
    ]);
    expect(resumo.map((r) => r.codigo)).toEqual(["PE", "MC", "MP", "ST", "VD", "OU"]);
    expect(resumo.find((r) => r.codigo === "MC")).toMatchObject({ total: 520, itens: 2 });
    expect(resumo.find((r) => r.codigo === "PE")).toMatchObject({ total: 200, itens: 1 });
    expect(resumo.find((r) => r.codigo === "OU")).toMatchObject({ total: 7, itens: 1 });
  });

  it("pagina a grade de meses por ano", () => {
    expect(anosDoProjeto(30).map((a) => [a.ano, a.inicio, a.fim])).toEqual([
      [1, 1, 12],
      [2, 13, 24],
      [3, 25, 30],
    ]);
    expect(anosDoProjeto(0)).toHaveLength(1);
  });

  it("normaliza meses: inteiros no prazo, sem repetição, ordenados", () => {
    expect(normalizarMeses(["3", 1, "1", 0, 13, "x", 2.5, 12], 12)).toEqual([1, 3, 12]);
  });

  it("marca quantidade de viagem como calculada, ajustada ou manual", () => {
    const inputs = normalizarViagemInputs({ pessoas: 2, dias_campo: 3 });
    expect(situacaoQuantidadeViagem({ descricao: "Alimentação", quantidade: 6 }, inputs)).toEqual({ situacao: "calculado", calculada: 6 });
    expect(situacaoQuantidadeViagem({ descricao: "Alimentação", quantidade: 8 }, inputs)).toEqual({ situacao: "ajustado", calculada: 6 });
    expect(situacaoQuantidadeViagem({ descricao: "Taxa de embarque especial", quantidade: 1 }, inputs).situacao).toBe("manual");
  });

  it("sugere só as linhas padrão de viagem que faltam e têm quantidade", () => {
    const inputs = normalizarViagemInputs({ pessoas: 2, dias_campo: 3, quartos: 1, diarias_hospedagem: 2 });
    const catalogo = [
      { id: "VD-1", descricao: "Alimentação", categoria: "Alimentação" },
      { id: "VD-2", descricao: "Hospedagem", categoria: "Hospedagem" },
      { id: "VD-3", descricao: "Combustível", categoria: "Deslocamento" },
      { id: "VD-9", descricao: "Brindes", categoria: "Outros" },
    ];
    const faltantes = linhasViagemFaltantes(catalogo, [{ descricao: "Alimentação da equipe", categoria: "deslocamento" }], inputs);
    expect(faltantes.map((f) => [f.item.id, f.quantidade])).toEqual([["VD-2", 2]]);
  });

  it("explica quando a edição está bloqueada e o que o status permite (tudo reabre, menos cancelado)", () => {
    expect(estadoEdicaoProjeto("rascunho")).toMatchObject({ editavel: true, podeConcluir: true, podeReabrir: false });
    expect(estadoEdicaoProjeto("enviado")).toMatchObject({ editavel: false, rotulo: "Revisado", podeReabrir: true });
    expect(estadoEdicaoProjeto("enviado").motivo).toContain("reabra a revisão");
    expect(estadoEdicaoProjeto("aprovado")).toMatchObject({ editavel: false, podeReabrir: true });
    expect(estadoEdicaoProjeto("aprovado").motivo).toContain("reformulação");
    expect(estadoEdicaoProjeto("recusado")).toMatchObject({ editavel: false, podeReabrir: true });
    expect(estadoEdicaoProjeto("cancelado")).toMatchObject({ podeReabrir: false });
    expect(estadoEdicaoProjeto("cancelado").motivo).toContain("cancelado");
  });

  it("o cartão MC soma as análises antigas do projeto, como o total e a planilha", () => {
    const resumo = resumirRubricas([{ rubrica: "MC", quantidade: 1, custo_unitario: 100 }], { total: 250, itens: 2 });
    expect(resumo.find((r) => r.codigo === "MC")).toMatchObject({ total: 350, itens: 3 });
  });
});

describe("conferenciaRevisao (antes de concluir)", () => {
  const viagem = normalizarViagemInputs({ pessoas: 2, dias_campo: 3 });
  const hoje = new Date("2026-09-28T12:00:00Z");
  const linhaPlano = (extra: Partial<LinhaPlanoCatalogo>): LinhaPlanoCatalogo => ({
    linhaId: 1,
    rubrica: "MC",
    descricao: "Papel toalha",
    unidade: "fardo",
    valor: 50,
    catalogoItemId: "MC-6",
    acao: "inalterado",
    valorCatalogo: 50,
    valorCatalogoEm: "2026-09-01T00:00:00Z",
    ...extra,
  });

  it("aponta valor zero, pessoal sem meses, viagem ajustada, catálogo mudou e valor velho", () => {
    const avisos = conferenciaRevisao({
      custos: [
        { id: 1, rubrica: "MC", descricao: "Papel toalha", quantidade: 1, custo_unitario: 50 },
        { id: 2, rubrica: "MC", descricao: "Brinde", quantidade: 1, custo_unitario: 0 },
        { id: 3, rubrica: "PE", descricao: "Bolsista", quantidade: 1, custo_unitario: 4000, meses_selecionados: [] },
        { id: 4, rubrica: "VD", descricao: "Alimentação", quantidade: 9, custo_unitario: 130 },
        { id: 5, rubrica: "MC", descricao: "Álcool", quantidade: 1, custo_unitario: 130 },
      ],
      viagem,
      plano: [
        linhaPlano({ linhaId: 1, valor: 50, valorCatalogo: 60 }),
        linhaPlano({ linhaId: 5, descricao: "Álcool", valor: 130, valorCatalogo: 130, valorCatalogoEm: "2025-12-01T00:00:00Z" }),
      ],
      hoje,
    });
    expect(avisos.map((a) => a.tipo)).toEqual(["valor_zero", "pessoal_sem_meses", "viagem_ajustada", "catalogo_mudou", "valor_velho"]);
    expect(avisos[0].texto).toContain("Brinde");
    expect(avisos[1].texto).toContain("Bolsista");
    expect(avisos[2].texto).toContain("Alimentação");
    expect(avisos[2].texto).toContain("calculado: 6");
    expect(avisos[3].texto).toContain("Papel toalha");
    expect(avisos[4].texto).toContain("Álcool");
  });

  it("sem nada a conferir devolve lista vazia", () => {
    expect(
      conferenciaRevisao({
        custos: [{ id: 1, rubrica: "MC", descricao: "Papel toalha", quantidade: 1, custo_unitario: 50 }],
        viagem,
        plano: [linhaPlano({})],
        hoje,
      }),
    ).toEqual([]);
  });
});
