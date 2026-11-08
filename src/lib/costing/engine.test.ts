import { describe, it, expect } from "vitest";
import {
  equipCustoDia,
  calcularAnaliseOrcamento,
  gargalo,
  horasBancadaPorExecucao,
  horasBancadaPorAmostra,
  insumosSelecionados,
  insumosSemCusto,
  reagentesPorAmostra,
  reagentesTotal,
  calcularAnalise,
  calcularCurvaCustoAmostras,
  type Etapa,
  type InsumoLinha,
  type Parametros,
} from "./engine";

describe("equipCustoDia", () => {
  it("usa depreciação linear (custo/vida_util) + manutenção (fração), rateada por dias úteis", () => {
    // custo total = 2×1000 = 2000; deprec = 2000/5 = 400; manut = 2000×0,05 = 100; (400+100)/200 = 2,5
    const v = equipCustoDia(
      {
        quantidade: 2,
        custo_unitario: 1000,
        vida_util_anos: 5,
        percentual_manutencao_anual: 0.05,
        manutencao_anual_fixa: null,
      },
      200,
    );
    expect(v).toBeCloseTo(2.5, 6);
  });

  it("manutenção fixa substitui a fração quando informada", () => {
    // custo 1000; deprec 1000/10=100; manut fixa 300; (100+300)/100 = 4
    const v = equipCustoDia(
      {
        quantidade: 1,
        custo_unitario: 1000,
        vida_util_anos: 10,
        percentual_manutencao_anual: 0.5,
        manutencao_anual_fixa: 300,
      },
      100,
    );
    expect(v).toBeCloseTo(4, 6);
  });

  it("cai para 222 dias úteis quando diasUteisAno <= 0", () => {
    // deprec 222/1=222; manut 0; /222 = 1
    const v = equipCustoDia(
      {
        quantidade: 1,
        custo_unitario: 222,
        vida_util_anos: 1,
        percentual_manutencao_anual: 0,
        manutencao_anual_fixa: null,
      },
      0,
    );
    expect(v).toBeCloseTo(1, 6);
  });
});

const etapa = (over: Partial<Etapa>): Etapa => ({
  nome_etapa: "E",
  nome_atividade: "A",
  execucoes_por_dia: null,
  amostras_por_execucao: null,
  tempo_maquina_h: null,
  tempo_bancada_h: null,
  ...over,
});

describe("gargalo", () => {
  it("usa os mínimos de exec/dia e amostras/exec", () => {
    const g = gargalo([
      etapa({ execucoes_por_dia: 3, amostras_por_execucao: 10 }),
      etapa({ execucoes_por_dia: 2, amostras_por_execucao: 24 }),
    ]);
    expect(g.execucoesDia).toBe(2);
    expect(g.amostrasPorExecucao).toBe(10);
    expect(g.amostrasDia).toBe(20);
  });

  it("ignora etapas Qubit ao calcular o gargalo", () => {
    const g = gargalo([
      etapa({ nome_atividade: "Quantificação Qubit", execucoes_por_dia: 1, amostras_por_execucao: 1 }),
      etapa({ nome_atividade: "PCR", execucoes_por_dia: 4, amostras_por_execucao: 8 }),
    ]);
    expect(g.execucoesDia).toBe(4);
    expect(g.amostrasPorExecucao).toBe(8);
  });
});

describe("horasBancadaPorAmostra", () => {
  it("usa a síntese operacional: soma bancada por execução e divide pelo gargalo, ignorando Qubit", () => {
    const h = horasBancadaPorAmostra([
      etapa({ tempo_bancada_h: 2, amostras_por_execucao: 4 }),
      etapa({ nome_atividade: "Qubit", tempo_bancada_h: 8, amostras_por_execucao: 1 }),
    ]);
    expect(h).toBeCloseTo(0.5, 6);
  });
});

describe("horasBancadaPorExecucao", () => {
  it("soma tempo de bancada da execução, ignorando Qubit quando há outras etapas", () => {
    const h = horasBancadaPorExecucao([
      etapa({ nome_atividade: "PCR", tempo_bancada_h: 2 }),
      etapa({ nome_atividade: "Qubit", tempo_bancada_h: 8 }),
    ]);
    expect(h).toBeCloseTo(2, 6);
  });
});

const ins = (over: Partial<InsumoLinha>): InsumoLinha => ({
  nome_etapa: "E",
  nome_atividade: "A",
  especificacao_insumo: "x",
  grupo_escolha: null,
  quantidade_por_amostra: 1,
  modo_cobranca: null,
  custo_unitario: 1,
  ...over,
});

describe("insumosSelecionados", () => {
  it("inclui sempre os sem grupo e, por padrão, a opção de MAIOR custo de cada grupo", () => {
    const sel = insumosSelecionados([
      ins({ especificacao_insumo: "base", grupo_escolha: null, custo_unitario: 5 }),
      ins({ especificacao_insumo: "kitA", grupo_escolha: "kit", custo_unitario: 100 }),
      ins({ especificacao_insumo: "kitB", grupo_escolha: "kit", custo_unitario: 40 }),
    ]);
    expect(sel.map((s) => s.especificacao_insumo).sort()).toEqual(["base", "kitA"]);
  });

  it("opção sem preço não vence por custo zero", () => {
    const sel = insumosSelecionados([
      ins({ especificacao_insumo: "kitA", grupo_escolha: "kit", custo_unitario: 40 }),
      ins({ especificacao_insumo: "kitSemPreco", grupo_escolha: "kit", custo_unitario: null }),
    ]);
    expect(sel.map((s) => s.especificacao_insumo)).toEqual(["kitA"]);
  });

  it("aponta insumos selecionados sem custo", () => {
    expect(insumosSemCusto([
      ins({ especificacao_insumo: "ok", custo_unitario: 3 }),
      ins({ especificacao_insumo: "semPreco", custo_unitario: null }),
      ins({ especificacao_insumo: "zero", custo_unitario: 0 }),
      ins({ especificacao_insumo: "naoUsado", custo_unitario: null, quantidade_por_amostra: 0 }),
    ])).toEqual(["semPreco", "zero"]);
  });

  it("respeita a escolha explícita do grupo", () => {
    const sel = insumosSelecionados(
      [
        ins({ especificacao_insumo: "kitA", grupo_escolha: "kit", custo_unitario: 100 }),
        ins({ especificacao_insumo: "kitB", grupo_escolha: "kit", custo_unitario: 40 }),
      ],
      { kit: "kitA" },
    );
    expect(sel.map((s) => s.especificacao_insumo)).toEqual(["kitA"]);
  });
});

describe("reagentesPorAmostra", () => {
  it("por_amostra independe do lote; por_execucao divide pelo tamanho do lote", () => {
    const linhas: InsumoLinha[] = [
      ins({ custo_unitario: 2, quantidade_por_amostra: 3, modo_cobranca: "por_amostra" }), // 6
      ins({ custo_unitario: 96, quantidade_por_amostra: 1, modo_cobranca: "por_execucao" }), // 96/24 = 4
    ];
    expect(reagentesPorAmostra(linhas, 24).total).toBeCloseTo(10, 6);
  });
});

describe("reagentesTotal", () => {
  it("multiplica itens por execução pelo teto de amostras/lote", () => {
    const linhas: InsumoLinha[] = [
      ins({ custo_unitario: 2, quantidade_por_amostra: 3, modo_cobranca: "por_amostra" }),
      ins({ custo_unitario: 96, quantidade_por_amostra: 1, modo_cobranca: "por_execucao" }),
    ];
    expect(reagentesTotal(linhas, 25, 24).total).toBeCloseTo(342, 6);
  });

  it("converte custo de estoque para a unidade de consumo antes de custear a ficha", () => {
    const linha = (custoEstoque: number) => ({
      ...ins({
        custo_unitario: custoEstoque,
        quantidade_por_amostra: 2,
        modo_cobranca: "por_amostra",
      }),
      unidade_estoque: "frasco",
      unidade_consumo: "reação",
      fator_conversao: 100,
      fonte_custo: custoEstoque === 5 ? "custo_padrao" : "custo_medio_ponderado",
      custo_unitario_estoque: custoEstoque,
      custo_unitario_consumo: custoEstoque / 100,
    });
    const consumoReacoes = 10 * 2;
    const equivalenteFrascos = consumoReacoes / 100;

    expect({
      consumoReacoes,
      equivalenteFrascos,
      custoPadrao: reagentesTotal([linha(5)], 10, 10).total,
      custoMedio: reagentesTotal([linha(500)], 10, 10).total,
    }).toEqual({
      consumoReacoes: 20,
      equivalenteFrascos: 0.2,
      custoPadrao: 1,
      custoMedio: 100,
    });
  });
});

describe("calcularAnalise — cascata custo→preço", () => {
  const base = {
    codigo: "TESTE",
    etapas: [etapa({ execucoes_por_dia: 1, amostras_por_execucao: 10, tempo_bancada_h: 5 })],
    equip: [{ peso: 1, custoDia: 100 }],
    insumos: [ins({ custo_unitario: 2, quantidade_por_amostra: 1, modo_cobranca: "por_amostra" })],
    valorHoraPessoal: 0,
    custoHoraOverhead: 0,
  };
  const params0: Parametros = {
    dias_uteis_ano: 222,
    margem_lucro: 0,
    impostos: 0,
    taxas: 0,
    fundo_reserva: 0,
    fundo_investimento: 0,
  };

  it("compõe reagentes + equipamento/amostra + pessoal/overhead", () => {
    const b = calcularAnalise({ ...base, params: params0 });
    // reagentes=2; equip/amostra=100/(1*10)=10; pessoal=(5/10)*0=0; overhead=0
    expect(b.reagentes).toBeCloseTo(2, 6);
    expect(b.equipamento).toBeCloseTo(10, 6);
    expect(b.custoAnalitico).toBeCloseTo(12, 6);
    expect(b.custoTotal).toBeCloseTo(12, 6);
  });

  it("ignora equipamentos com peso zero, negativo ou invalido", () => {
    const b = calcularAnalise({
      ...base,
      params: params0,
      equip: [
        { peso: 0, custoDia: 1000 },
        { peso: -1, custoDia: 1000 },
        { peso: Number.NaN, custoDia: 1000 },
        { peso: 0.5, custoDia: 100 },
      ],
    });

    expect(b.equipamento).toBeCloseTo(5, 6);
  });

  it("com fatores = 0, preço == custo total (regressão do achado da auditoria)", () => {
    const b = calcularAnalise({ ...base, params: params0 });
    expect(b.preco).toBeCloseTo(b.custoTotal, 6);
  });

  it("aplica a soma dos fatores: preço = custoTotal × (1 + Σ%/100)", () => {
    const b = calcularAnalise({ ...base, params: { ...params0, margem_lucro: 20, impostos: 10 } });
    expect(b.fatores).toBeCloseTo(0.3, 6);
    expect(b.preco).toBeCloseTo(b.custoTotal * 1.3, 6);
  });

  it("calcula orçamento por quantidade real, com execuções inteiras e unitário derivado do total", () => {
    const b = calcularAnaliseOrcamento({
      ...base,
      params: params0,
      numeroAmostras: 11,
      insumos: [ins({ custo_unitario: 100, quantidade_por_amostra: 1, modo_cobranca: "por_execucao" })],
      valorHoraPessoal: 10,
      custoHoraOverhead: 1,
    });
    expect(b.numeroExecucoes).toBe(2);
    expect(b.totais.reagentes).toBeCloseTo(200, 6);
    expect(b.totais.equipamento).toBeCloseTo(110, 6);
    expect(b.totais.pessoal).toBeCloseTo(100, 6);
    expect(b.totais.overhead).toBeCloseTo(10, 6);
    expect(b.custoTotal).toBeCloseTo(420 / 11, 6);
  });

  it("recalcula mão de obra por etapa, respeitando a capacidade própria de cada etapa", () => {
    const b = calcularAnaliseOrcamento({
      ...base,
      params: params0,
      numeroAmostras: 25,
      etapas: [
        etapa({ nome_etapa: "Extração", nome_atividade: "Batch 24", execucoes_por_dia: 1, amostras_por_execucao: 24, tempo_bancada_h: 10 }),
        etapa({ nome_etapa: "PCR", nome_atividade: "Batch 96", execucoes_por_dia: 1, amostras_por_execucao: 96, tempo_bancada_h: 5 }),
      ],
      equip: [],
      insumos: [],
      valorHoraPessoal: 10,
      custoHoraOverhead: 0,
    });

    expect(b.numeroExecucoes).toBe(2);
    expect(b.totais.pessoal).toBeCloseTo(250, 6);
    expect(b.pessoal).toBeCloseTo(10, 6);
  });

  it("rateia insumo por execução pelo lote da etapa da linha, não pelo gargalo global", () => {
    const b = calcularAnaliseOrcamento({
      ...base,
      params: params0,
      numeroAmostras: 25,
      etapas: [
        etapa({ nome_etapa: "Extração", nome_atividade: "Batch 24", execucoes_por_dia: 1, amostras_por_execucao: 24, tempo_bancada_h: 0 }),
        etapa({ nome_etapa: "PCR", nome_atividade: "Batch 96", execucoes_por_dia: 1, amostras_por_execucao: 96, tempo_bancada_h: 0 }),
      ],
      equip: [],
      insumos: [
        ins({
          nome_etapa: "PCR",
          nome_atividade: "Batch 96",
          custo_unitario: 960,
          quantidade_por_amostra: 1,
          modo_cobranca: "por_execucao",
        }),
      ],
      valorHoraPessoal: 0,
      custoHoraOverhead: 0,
    });

    expect(b.numeroExecucoes).toBe(2);
    expect(b.totais.reagentes).toBeCloseTo(960, 6);
    expect(b.reagentes).toBeCloseTo(38.4, 6);
  });

  it("gera curva operacional que dilui dentro da capacidade e reinicia no ciclo seguinte", () => {
    const curva = calcularCurvaCustoAmostras({
      ...base,
      params: params0,
      maxAmostras: 12,
    });

    expect(curva[0].capacidadeOperacional).toBe(10);
    expect(curva[0].custoUnitarioCiclo).toBeCloseTo(102, 6);
    expect(curva[9].custoUnitarioCiclo).toBeCloseTo(12, 6);
    expect(curva[10].ciclo).toBe(2);
    expect(curva[10].amostrasNoCiclo).toBe(1);
    expect(curva[10].custoUnitarioCiclo).toBeCloseTo(102, 6);
    expect(curva[10].custoUnitarioMedio).toBeCloseTo(222 / 11, 6);
  });
});
