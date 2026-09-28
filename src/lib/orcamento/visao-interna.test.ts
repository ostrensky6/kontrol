import { describe, expect, it } from "vitest";

import { calcularPropostaEconomica, parametrosDeRates } from "./engine-economica";
import {
  descreverMeses,
  entradaDoSnapshot,
  formatarQuantidade,
  mascararPessoalVisao,
  montarFundos,
  montarVisaoInterna,
  type EntradaVisaoInterna,
} from "./visao-interna";

// Cenário das maquetes aprovadas em 28/09: custos de R$ 7.000, Σ = 20%, total R$ 8.750.
const RATES = { impostos_legacy: 10, incubacao: 5, reserva: 2.5, investimentos: 1, lucro: 2 };
const itensLaboratorio = [
  { codigo_analise: "ExtDNA", n_amostras: 12, custo_unitario: 45, preco_unitario: 70 },
  { codigo_analise: "qPCR16S", n_amostras: 12, custo_unitario: 60, preco_unitario: 95 },
];
const custosProjeto = [
  { rubrica: "PE", descricao: "Técnico de laboratório", quantidade: 1, custo_unitario: 1200, meses_selecionados: [1, 2, 3, 4] },
  { rubrica: "MC", descricao: "Kit de extração", quantidade: 2, unidade: "un", custo_unitario: 300 },
  { rubrica: "MC", descricao: "Ponteiras com filtro", quantidade: 4, unidade: "cx", custo_unitario: 85 },
];
const economia = calcularPropostaEconomica({
  custoLaboratorioTecnico: 1260,
  custoDiretoProjeto: 5740,
  parametros: parametrosDeRates(RATES),
});

function entrada(extra: Partial<EntradaVisaoInterna> = {}): EntradaVisaoInterna {
  return {
    itensLaboratorio,
    custosProjeto,
    analisesProjeto: [],
    parametros: economia.parametros,
    total: economia.totalFinal,
    legado: false,
    nomesAnalises: { ExtDNA: "Extração de DNA", qPCR16S: "qPCR 16S" },
    ...extra,
  };
}

const soma = (valores: number[]) => Math.round(valores.reduce((a, v) => a + v, 0) * 100) / 100;

describe("montarVisaoInterna", () => {
  it("agrupa só as rubricas com itens, na ordem canônica", () => {
    const visao = montarVisaoInterna(entrada());
    expect(visao.total).toBe(8750);
    expect(visao.grupos.map((g) => g.id)).toEqual(["laboratorio", "PE", "MC"]);
    expect(visao.grupos.map((g) => g.custoTotal)).toEqual([1260, 4800, 940]);
    expect(visao.custosEfetivos).toBe(7000);
    expect(visao.custosOperacionais).toBe(1750);
    expect(visao.grupos[0].percentualDoTotal).toBeCloseTo(14.4, 5);
    expect(visao.grupos[0].rotuloCliente).toBe("Análises laboratoriais");
    expect(visao.grupos[1].rotulo).toBe("PE · Pessoal");
  });

  it("reparte o total entre os itens e fecha exatamente", () => {
    const visao = montarVisaoInterna(entrada());
    const itens = visao.grupos.flatMap((g) => g.itens);
    expect(itens.map((i) => i.naProposta)).toEqual([675, 900, 6000, 750, 425]);
    expect(soma(itens.map((i) => i.naProposta))).toBe(8750);
    expect(visao.grupos.map((g) => g.naProposta)).toEqual([1575, 6000, 1175]);
  });

  it("usa meses no pessoal e nomes do catálogo nas análises", () => {
    const visao = montarVisaoInterna(entrada());
    const pe = visao.grupos[1].itens[0];
    expect(pe.quantidade).toBe(4);
    expect(pe.unidade).toBe("mês");
    expect(pe.detalhe).toBe("meses 1 a 4");
    expect(pe.custoTotal).toBe(4800);
    const lab = visao.grupos[0].itens[0];
    expect(lab.codigo).toBe("ExtDNA");
    expect(lab.descricao).toBe("Extração de DNA");
    expect(lab.precoReferencia).toBe(70);
  });

  it("classifica os operacionais e aplica a regra da incubação", () => {
    const visao = montarVisaoInterna(entrada());
    const porChave = Object.fromEntries(visao.operacionais.map((o) => [o.chave, o]));
    expect(porChave.impostos_legacy.tipo).toBe("imposto");
    expect(porChave.incubacao.tipo).toBe("taxa");
    expect(porChave.reserva.tipo).toBe("fundo");
    expect(porChave.investimentos.tipo).toBe("fundo");
    expect(porChave.lucro.tipo).toBe("margem");
    expect(porChave.incubacao.percentualInformado).toBe(5);
    expect(porChave.incubacao.percentualSobrePreco).toBeCloseTo(4.5, 10);
    expect(porChave.incubacao.valorLimpo).toBe(393.75);
    expect(visao.somaPercentual).toBeCloseTo(20, 10);
  });

  it("mostra o imposto compensado de cada linha e fecha com a linha de impostos", () => {
    const visao = montarVisaoInterna(entrada());
    const naoTributarias = visao.operacionais.filter((o) => o.tipo !== "imposto");
    expect(naoTributarias.map((o) => o.parteNota)).toEqual([437.5, 243.06, 97.22, 194.44]);
    expect(naoTributarias.map((o) => o.impostoCompensado)).toEqual([43.75, 24.31, 9.72, 19.44]);
    expect(visao.efetivosCompensacao).toEqual({ impostoCompensado: 777.78, parteNota: 7777.78 });
    const compensado = soma([
      visao.efetivosCompensacao!.impostoCompensado,
      ...naoTributarias.map((o) => o.impostoCompensado ?? 0),
    ]);
    expect(compensado).toBe(875);
    expect(soma([visao.efetivosCompensacao!.parteNota, ...naoTributarias.map((o) => o.parteNota ?? 0)])).toBe(8750);
    const impostos = visao.operacionais.find((o) => o.tipo === "imposto")!;
    expect(impostos.valorLimpo).toBe(875);
    expect(impostos.impostoCompensado).toBeNull();
  });

  it("sem imposto a parte da nota é o próprio valor", () => {
    const eco = calcularPropostaEconomica({
      custoLaboratorioTecnico: 1260,
      custoDiretoProjeto: 5740,
      parametros: parametrosDeRates({ lucro: 20 }),
    });
    const visao = montarVisaoInterna(entrada({ parametros: eco.parametros, total: eco.totalFinal }));
    expect(visao.efetivosCompensacao).toEqual({ impostoCompensado: 0, parteNota: 7000 });
  });

  it("marca item de projeto sem descrição congelada", () => {
    const visao = montarVisaoInterna(
      entrada({ custosProjeto: [{ rubrica: "ST", quantidade: 1, custo_unitario: 7000 - 1260 }] }),
    );
    const item = visao.grupos.find((g) => g.id === "ST")!.itens[0];
    expect(item.descricaoAusente).toBe(true);
    expect(item.descricao).toBe("Descrição não registrada na emissão");
  });

  it("versão legado não calcula compensação", () => {
    const visao = montarVisaoInterna(
      entrada({
        legado: true,
        parametros: [{ chave: "lucro", label: "Lucro", percentual: 10, valorNominal: 50 }],
        total: 7050,
      }),
    );
    expect(visao.legado).toBe(true);
    expect(visao.efetivosCompensacao).toBeNull();
    expect(visao.operacionais[0].impostoCompensado).toBeNull();
    expect(visao.operacionais[0].parteNota).toBeNull();
  });

  it("proposta vazia não quebra", () => {
    const visao = montarVisaoInterna(
      entrada({ itensLaboratorio: [], custosProjeto: [], parametros: [], total: 0 }),
    );
    expect(visao.grupos).toEqual([]);
    expect(visao.custosEfetivos).toBe(0);
    expect(visao.custosOperacionais).toBe(0);
  });
});

describe("entradaDoSnapshot", () => {
  it("lê itens, parâmetros da engine e nomes congelados", () => {
    const snapshot = {
      nomes_analises: { ExtDNA: "Extração de DNA (congelado)" },
      orcamentos_analises: [{ id: 4, orcamento_itens: itensLaboratorio }],
      orcamentos_projeto: [{ id: 9, orcamento_projeto_custos: custosProjeto, orcamento_projeto_analises: [] }],
      consolidado: { economia: { ...economia } },
    };
    const e = entradaDoSnapshot(snapshot, 8750, { ExtDNA: "Catálogo atual", qPCR16S: "qPCR 16S" });
    expect(e.legado).toBe(false);
    expect(e.itensLaboratorio).toHaveLength(2);
    expect(e.custosProjeto).toHaveLength(3);
    expect(e.parametros).toHaveLength(5);
    expect(e.nomesAnalises).toEqual({ ExtDNA: "Extração de DNA (congelado)", qPCR16S: "qPCR 16S" });
  });

  it("snapshot legado usa parametrosProjeto", () => {
    const e = entradaDoSnapshot(
      { consolidado: { parametrosProjeto: [{ key: "lucro", label: "Lucro", nominalRate: 10, amount: 30 }] } },
      330,
    );
    expect(e.legado).toBe(true);
    expect(e.parametros).toEqual([{ chave: "lucro", label: "Lucro", percentual: 10, valorNominal: 30 }]);
  });

  it("snapshot inválido vira entrada vazia", () => {
    const e = entradaDoSnapshot(null, 0);
    expect(e.itensLaboratorio).toEqual([]);
    expect(e.parametros).toEqual([]);
  });
});

describe("montarFundos", () => {
  it("antes da aprovação mostra só o previsto", () => {
    const { linhas, percentualRecebido } = montarFundos(montarVisaoInterna(entrada()), null);
    expect(percentualRecebido).toBeNull();
    expect(linhas.map((l) => [l.chave, l.previsto, l.impostoCompensado, l.liberado])).toEqual([
      ["reserva", 218.75, 24.31, null],
      ["investimentos", 87.5, 9.72, null],
    ]);
  });

  it("com pagamento lançado calcula liberado, usado e saldo", () => {
    const { linhas, percentualRecebido } = montarFundos(montarVisaoInterna(entrada()), {
      valorRecebido: 4375,
      impostosPagos: 0,
      incubacaoPaga: 0,
      reservaGasta: 50,
      investimentoGasto: 0,
    });
    expect(percentualRecebido).toBe(0.5);
    expect(linhas[0]).toMatchObject({ liberado: 109.38, usado: 50, saldo: 59.38 });
    expect(linhas[1]).toMatchObject({ liberado: 43.75, usado: 0, saldo: 43.75 });
  });
});

describe("formatação", () => {
  it("pluraliza unidades conhecidas", () => {
    expect(formatarQuantidade(12, "amostra")).toBe("12 amostras");
    expect(formatarQuantidade(1, "amostra")).toBe("1 amostra");
    expect(formatarQuantidade(4, "mês")).toBe("4 meses");
    expect(formatarQuantidade(2, "un")).toBe("2 un");
    expect(formatarQuantidade(2.5, null)).toBe("2,5");
  });

  it("descreve meses contínuos e salteados", () => {
    expect(descreverMeses([1, 2, 3, 4])).toBe("meses 1 a 4");
    expect(descreverMeses([3, 1, 5])).toBe("meses 1, 3 e 5");
    expect(descreverMeses([7])).toBe("mês 7");
    expect(descreverMeses([])).toBeNull();
  });
});

describe("mascararPessoalVisao (DC8)", () => {
  it("zera e marca só o pessoal; o total da proposta continua", () => {
    const visao = montarVisaoInterna(
      entrada({
        custosProjeto: [
          { id: 1, rubrica: "PE", descricao: "Bolsista", quantidade: 1, custo_unitario: 4000, meses_selecionados: [1, 2] },
          { id: 2, rubrica: "MC", descricao: "Reagente", quantidade: 2, custo_unitario: 100 },
        ],
      }),
    );
    const mascarada = mascararPessoalVisao(visao);
    const pe = mascarada.grupos.find((g) => g.id === "PE")!;
    expect(pe).toMatchObject({ mascarado: true, custoTotal: 0, naProposta: 0 });
    expect(pe.itens[0]).toMatchObject({ mascarado: true, custoUnitario: 0, custoTotal: 0, naProposta: 0, descricao: "Bolsista" });
    expect(JSON.stringify(pe)).not.toContain("4000");
    expect(mascarada.grupos.find((g) => g.id === "MC")).toEqual(visao.grupos.find((g) => g.id === "MC"));
    expect(mascarada.total).toBe(visao.total);
    const semPessoal = montarVisaoInterna(entrada({ custosProjeto: [{ rubrica: "MC", quantidade: 1, custo_unitario: 10 }] }));
    expect(mascararPessoalVisao(semPessoal)).toBe(semPessoal);
  });
});
