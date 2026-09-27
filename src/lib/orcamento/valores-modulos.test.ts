import { describe, expect, it } from "vitest";
import { consolidarOrcamentoFinal } from "./orcamento-final";
import {
  criarResolvedorDeTaxas,
  valorLaboratorioNaProposta,
  valorProjetoNaProposta,
} from "./valores-modulos";

const globais = [
  { chave: "impostos", valor: 10 },
  { chave: "taxa_incubacao", valor: 2 },
  { chave: "fundo_reserva", valor: 5 },
  { chave: "fundo_investimento", valor: 3 },
  { chave: "margem_lucro", valor: 10 },
];

describe("criarResolvedorDeTaxas", () => {
  const resolver = criarResolvedorDeTaxas({
    projetos: [
      { id: 1, demanda_id: 7, impostos_legacy: 5, incubacao: 1, reserva: 0, investimentos: 0, lucro: 1 },
      { id: 2, demanda_id: 7, impostos_legacy: 12, incubacao: 2, reserva: 1, investimentos: 1, lucro: 8 },
    ],
    demandas: [
      { id: 7 },
      { id: 8, param_impostos: 6, param_incubacao: 2, param_reserva: 0, param_investimentos: 0, param_lucro: 4 },
      { id: 9 },
    ],
    parametrosGlobais: globais,
  });

  it("com projeto: usa as taxas do projeto mais recente da proposta, como a emissao", () => {
    expect(resolver(7)).toEqual({ impostos_legacy: 12, incubacao: 2, reserva: 1, investimentos: 1, lucro: 8 });
  });

  it("ignora projeto cancelado, como a emissao (ORC-8)", () => {
    const comCancelado = criarResolvedorDeTaxas({
      projetos: [
        { id: 1, demanda_id: 7, impostos_legacy: 5, incubacao: 1, reserva: 0, investimentos: 0, lucro: 1 },
        { id: 2, demanda_id: 7, status: "cancelado", impostos_legacy: 12, incubacao: 2, reserva: 1, investimentos: 1, lucro: 8 },
      ],
      demandas: [{ id: 7 }],
      parametrosGlobais: globais,
    });
    expect(comCancelado(7)).toEqual({ impostos_legacy: 5, incubacao: 1, reserva: 0, investimentos: 0, lucro: 1 });
  });

  it("sem projeto: usa as taxas gravadas na proposta", () => {
    expect(resolver(8)).toEqual({ impostos_legacy: 6, incubacao: 2, reserva: 0, investimentos: 0, lucro: 4 });
  });

  it("sem nada gravado: usa os padroes globais", () => {
    expect(resolver(9)).toEqual({ impostos_legacy: 10, incubacao: 2, reserva: 5, investimentos: 3, lucro: 10 });
  });

  it("modulo sem proposta: usa as taxas do proprio projeto", () => {
    expect(
      resolver(null, { id: 3, impostos_legacy: 1, incubacao: 0, reserva: 0, investimentos: 0, lucro: 0 }),
    ).toEqual({ impostos_legacy: 1, incubacao: 0, reserva: 0, investimentos: 0, lucro: 0 });
  });
});

describe("valor de cada modulo na proposta", () => {
  const rates = { impostos_legacy: 10, incubacao: 2, reserva: 5, investimentos: 3, lucro: 10 };
  const itensLaboratorio = [{ n_amostras: 10, custo_unitario: 50, preco_unitario: 90 }];
  const custos = [{ rubrica: "ST", quantidade: 1, custo_unitario: 1500, preco_unitario: 2000, meses_selecionados: [] }];

  it("laboratorio entra pelo custo tecnico (nao pelo preco de tabela)", () => {
    const soLab = consolidarOrcamentoFinal({
      laboratorioExigido: true,
      projetoExigido: false,
      laboratorioRevisado: true,
      projetoRevisado: true,
      itensLaboratorio,
      itensProjeto: [],
      parametrosProjeto: rates,
    });
    expect(valorLaboratorioNaProposta(itensLaboratorio, rates)).toBe(soLab.totalFinal);
  });

  it("laboratorio + projeto somam o total da proposta emitida", () => {
    const proposta = consolidarOrcamentoFinal({
      laboratorioExigido: true,
      projetoExigido: true,
      laboratorioRevisado: true,
      projetoRevisado: true,
      itensLaboratorio,
      itensProjeto: custos,
      parametrosProjeto: rates,
    });
    const soma =
      valorLaboratorioNaProposta(itensLaboratorio, rates) + valorProjetoNaProposta({ custos, analises: [] }, rates);
    expect(Math.abs(soma - proposta.totalFinal)).toBeLessThanOrEqual(0.01);
  });
});
