import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { CADASTROS, getCadastrosParaImportacao } from "./config";
import {
  diferencas,
  formatoPercentual,
  normalizarChave,
  erroLinha,
  lerAbaCadastro,
  mapaCabecalhos,
  operacaoIdDeterministico,
  parseDataBr,
  parseNumeroBr,
  payloadRpcInsumo,
  registroAtualizado,
  registroNovo,
  valorParaCampo,
} from "./importacao";

function abaInsumos(linhas: unknown[][], cabecalho: string[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Insumos");
  sheet.addRow(cabecalho);
  for (const linha of linhas) sheet.addRow(linha);
  return sheet;
}

describe("numeros em formato brasileiro", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["12,50", 12.5],
    ["R$ 1.500,00", 1500],
    ["1.500", 1500],
    ["0.5", 0.5],
    ["1234.5", 1234.5],
    ["1,234.56", 1234.56],
    ["12,5%", 12.5],
    ["-3,5", -3.5],
    [7, 7],
  ])("%s → %s", (entrada, esperado) => {
    expect(parseNumeroBr(entrada)).toBeCloseTo(esperado as number, 10);
  });

  it.each(["abc", "1,2,3", "", "12a"])("rejeita %s", (entrada) => {
    expect(parseNumeroBr(entrada)).toBeNull();
  });
});

describe("datas em formato brasileiro", () => {
  it("aceita dd/mm/aaaa, ISO, Date e serial do Excel", () => {
    expect(parseDataBr("05/03/2027")).toBe("2027-03-05");
    expect(parseDataBr("5/3/2027")).toBe("2027-03-05");
    expect(parseDataBr("2027-03-05")).toBe("2027-03-05");
    expect(parseDataBr(new Date(Date.UTC(2027, 2, 5)))).toBe("2027-03-05");
    expect(parseDataBr(46451)).toBe("2027-03-05");
  });

  it("rejeita datas impossiveis", () => {
    expect(parseDataBr("31/02/2027")).toBeNull();
    expect(parseDataBr("amanhã")).toBeNull();
  });
});

describe("mapeamento de cabecalhos", () => {
  it("reconhece rotulos (sem acento/caixa), nomes internos e a coluna de quantidade", () => {
    const mapa = mapaCabecalhos(CADASTROS.insumos);
    expect(mapa.get("valor da embalagem (r$)")).toBe("custo_total_embalagem");
    expect(mapa.get("item especifico / sku")).toBe("especificacao");
    expect(mapa.get("custo_total_embalagem")).toBe("custo_total_embalagem");
    expect(mapa.get("quantidade (embalagens fechadas)")).toBe("quantidade");
    expect(mapa.get("fornecedor principal id")).toBe("fornecedor_id__id");
    expect(mapa.get("id")).toBe("id");
    // colunas antigas "(calculado)" nao mapeiam para nada
    expect(mapa.has("unidades fechadas (calculado)")).toBe(false);
  });

  it("le a aba com pt-BR e mensagens por rotulo e linha", () => {
    const sheet = abaInsumos(
      [
        ["Kit A", "12,50", "10", "kit", "3", "05/03/2027"],
        ["Kit B", "", "10", "kit", "", ""],
        ["Kit C", "abc", "10", "kit", "1,5", "31/02/2027"],
      ],
      [
        "Item específico / SKU",
        "Valor da embalagem (R$)",
        "Quantidade na embalagem",
        "Unidade",
        "Quantidade (embalagens fechadas)",
        "Data de validade",
      ],
    );
    const { linhas, colunas } = lerAbaCadastro(sheet, CADASTROS.insumos, {});

    expect(colunas.has("quantidade")).toBe(true);
    expect(linhas[0]).toMatchObject({
      excelRow: 2,
      quantidade: 3,
      erros: [],
      valores: {
        especificacao: "Kit A",
        custo_total_embalagem: 12.5,
        quantidade_embalagem: 10,
        unidade: "kit",
        data_validade: "2027-03-05",
      },
    });
    expect(linhas[1].valores).not.toHaveProperty("custo_total_embalagem");
    expect(linhas[2].erros).toEqual([
      "Linha 4, Valor da embalagem (R$): número inválido",
      "Linha 4, Data de validade: data inválida (use dd/mm/aaaa)",
    ]);
    expect(linhas[2].quantidade).toBe(1.5);
  });

  it("formata erros com rotulo e linha", () => {
    expect(erroLinha(5, "Valor da embalagem (R$)", "Obrigatório")).toBe(
      "Linha 5, Valor da embalagem (R$): obrigatório",
    );
  });

  it("resolve selects pelo rotulo e acusa valor desconhecido", () => {
    const campo = CADASTROS.insumos.campos.find((c) => c.name === "fornecedor_id")!;
    const opcoes = new Map([["7", "Fornecedor Ágil"]]);
    expect(valorParaCampo("fornecedor agil", campo, opcoes)).toEqual({ ok: true, valor: "7" });
    expect(valorParaCampo("Outro", campo, opcoes)).toEqual({
      ok: false,
      erro: '"Outro" não encontrado no cadastro',
    });
  });
});

describe("registro para criar/atualizar", () => {
  const existente = {
    id: 9,
    especificacao: "Kit A",
    tipo_insumo_id: 4,
    codigo_interno: "INT-9",
    custo_total_embalagem: 100,
    quantidade_embalagem: 10,
    unidade: "kit",
    unidade_consumo: "kit",
    fator_conversao: 1,
    fabricante: "Marca X",
    custo_unitario: 10,
  };

  it("celula vazia e coluna ausente preservam o valor atual (sem anular)", () => {
    const obj = registroAtualizado(CADASTROS.insumos, existente, {
      especificacao: "Kit A",
      custo_total_embalagem: 120,
      fabricante: "",
    });
    expect(obj).toMatchObject({
      tipo_insumo_id: 4,
      codigo_interno: "INT-9",
      fabricante: "Marca X",
      custo_total_embalagem: 120,
    });
  });

  it("diferencas devolve so o que mudou, tolerando tipos e arredondamento", () => {
    expect(
      diferencas(
        { custo_total_embalagem: 120, quantidade_embalagem: "10", custo_unitario: 12.000000000001, fabricante: "Marca X" },
        existente,
      ),
    ).toEqual({ custo_total_embalagem: 120, custo_unitario: 12.000000000001 });
    expect(diferencas({ especificacao: "Kit A", fabricante: null }, { especificacao: "Kit A", fabricante: "" })).toEqual({});
  });

  it("registro novo aplica padroes do formulario", () => {
    expect(registroNovo(CADASTROS.insumos, { especificacao: "Kit", unidade: "kit" })).toMatchObject({
      fator_conversao: "1",
      unidade_consumo: "kit",
    });
    expect(registroNovo(CADASTROS.clientes, { nome: "Cliente" })).toMatchObject({ ativo: "true" });
  });

  it("payload da RPC de insumo so leva campos aceitos pela funcao", () => {
    const payload = payloadRpcInsumo({ especificacao: "Kit", custo_unitario: 5, quantidade: 3, unidade: "kit" });
    expect(payload).toEqual({ especificacao: "Kit", unidade: "kit" });
  });
});

describe("operacao_id deterministico", () => {
  it("gera o mesmo UUID para o mesmo arquivo/aba/linha e outro para linha diferente", () => {
    const a = operacaoIdDeterministico("hash-arquivo", "insumos", 2);
    expect(a).toBe(operacaoIdDeterministico("hash-arquivo", "insumos", 2));
    expect(a).not.toBe(operacaoIdDeterministico("hash-arquivo", "insumos", 3));
    expect(a).not.toBe(operacaoIdDeterministico("outro-arquivo", "insumos", 2));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("CAD-5: percentual e ordem da importação", () => {
  const percentual = { name: "percentual_dedicado", label: "% dedicado", tipo: "percent" } as const;

  it("número sem formato de % já está em pontos percentuais (1 é 1%, não 100%)", () => {
    expect(valorParaCampo(1, percentual)).toEqual({ ok: true, valor: 1 });
    expect(valorParaCampo(0.5, percentual)).toEqual({ ok: true, valor: 0.5 });
    expect(valorParaCampo("12,5%", percentual)).toEqual({ ok: true, valor: 12.5 });
  });

  it("célula formatada como % (planilha exportada) guarda fração", () => {
    expect(valorParaCampo(0.5, percentual, undefined, { celulaEmPercentual: true })).toEqual({ ok: true, valor: 50 });
    expect(valorParaCampo(0.01, percentual, undefined, { celulaEmPercentual: true })).toEqual({ ok: true, valor: 1 });
    expect(formatoPercentual({ numFmt: "0.0%" })).toBe(true);
    expect(formatoPercentual({ numFmt: "#,##0.###" })).toBe(false);
  });

  it("importa cada aba depois das abas que ela referencia", () => {
    const ordem = getCadastrosParaImportacao().map((cfg) => cfg.slug);
    const antes = (a: string, b: string) => expect(ordem.indexOf(a), `${a} antes de ${b}`).toBeLessThan(ordem.indexOf(b));
    antes("fornecedores", "insumos");
    antes("tipo_insumos", "insumos");
    antes("clientes", "projetos");
    expect(new Set(ordem).size).toBe(Object.keys(CADASTROS).length);
  });

  it("aceita o cabeçalho antigo de colunas renomeadas", () => {
    const mapa = mapaCabecalhos(CADASTROS.insumos);
    expect(mapa.get(normalizarChave("Data da última compra"))).toBe("data_aquisicao");
    expect(mapa.get(normalizarChave("Unidade"))).toBe("unidade");
    expect(mapa.get(normalizarChave("Unidade da embalagem"))).toBe("unidade");
  });
});
