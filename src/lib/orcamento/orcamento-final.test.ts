import { describe, expect, it } from "vitest";
import {
  consolidarOrcamentoFinal,
  explicarOrigem,
  PENDENCIA_LABORATORIO_FORA_DO_TIPO,
  PENDENCIA_PROJETO_FORA_DO_TIPO,
} from "./orcamento-final";

// Política A (DEC-ORC-001): laboratório como custo técnico + projeto como custo
// direto, gross-up único sobre o subtotal técnico.
describe("consolidarOrcamentoFinal (Política A)", () => {
  it("bloqueia emissao quando modulo exigido ainda nao foi revisado", () => {
    const resultado = consolidarOrcamentoFinal({
      laboratorioExigido: true,
      projetoExigido: false,
      laboratorioRevisado: false,
      projetoRevisado: true,
      itensLaboratorio: [{ n_amostras: 2, custo_unitario: 10, preco_unitario: 15 }],
      itensProjeto: [],
      parametrosProjeto: {},
    });

    expect(resultado.pronto).toBe(false);
    expect(resultado.pendencias).toEqual(["revisar custos laboratoriais"]);
    // sem parâmetros → total = subtotal técnico (custo técnico do laboratório)
    expect(resultado.totalLaboratorioCusto).toBe(20);
    expect(resultado.subtotalTecnico).toBe(20);
    expect(resultado.totalFinal).toBe(20);
  });

  it("consolida laboratorio (técnico) e projeto (direto) com gross-up único", () => {
    const resultado = consolidarOrcamentoFinal({
      laboratorioExigido: true,
      projetoExigido: true,
      laboratorioRevisado: true,
      projetoRevisado: true,
      itensLaboratorio: [{ n_amostras: 2, custo_unitario: 10, preco_unitario: 15 }],
      itensProjeto: [{ rubrica: "MC", quantidade: 1, custo_unitario: 70 }],
      parametrosProjeto: { lucro: 30 },
    });

    expect(resultado.pronto).toBe(true);
    expect(resultado.pendencias).toEqual([]);
    expect(resultado.totalLaboratorioCusto).toBe(20); // custo técnico
    expect(resultado.totalLaboratorioPreco).toBe(30); // referência apenas
    expect(resultado.totalProjetoCusto).toBe(70); // custo direto
    expect(resultado.subtotalTecnico).toBe(90); // 20 + 70
    // 90 / (1 - 0,30) = 128,5714… → 128,57
    expect(resultado.totalFinal).toBe(128.57);
    expect(resultado.parametrosProjeto.find((p) => p.key === "lucro")?.amount).toBe(
      Math.round(128.57 * 0.3 * 100) / 100,
    );
    expect(resultado.origens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ campo: "totalLaboratorioCusto", valor: 20 }),
        expect.objectContaining({ campo: "subtotalTecnico", valor: 90 }),
        expect.objectContaining({ campo: "totalFinal", valor: 128.57 }),
      ]),
    );
  });

  it("bloqueia quando a soma dos parâmetros >= 100%", () => {
    const resultado = consolidarOrcamentoFinal({
      laboratorioExigido: false,
      projetoExigido: true,
      laboratorioRevisado: true,
      projetoRevisado: true,
      itensLaboratorio: [],
      itensProjeto: [{ rubrica: "MC", quantidade: 1, custo_unitario: 100 }],
      parametrosProjeto: { impostos_legacy: 60, lucro: 40 },
    });
    expect(resultado.pronto).toBe(false);
    expect(resultado.totalFinal).toBe(0);
    expect(resultado.pendencias.join(" ")).toMatch(/menor que 100%/i);
  });

  it("explica cada origem em linguagem de usuário, sem nomes de tabela", () => {
    expect(explicarOrigem({ campo: "subtotalTecnico", regra: "x" })).toBe("Custo do laboratório + custo do projeto.");
    expect(explicarOrigem({ campo: "totalLaboratorioCusto" })).not.toMatch(/orcamento_itens|Política/);
    expect(explicarOrigem({ campo: "outro", regra: "regra original" })).toBe("regra original");
  });
});

describe("consolidarOrcamentoFinal — o tipo do orçamento decide o que entra", () => {
  const lab = [{ n_amostras: 2, custo_unitario: 10, preco_unitario: 15 }];
  const proj = [{ rubrica: "MC", quantidade: 1, custo_unitario: 70 }];
  const revisados = { laboratorioRevisado: true, projetoRevisado: true };

  it("apenas projeto: análises esquecidas no laboratório não somam e bloqueiam a emissão", () => {
    const r = consolidarOrcamentoFinal({
      ...revisados,
      laboratorioExigido: false,
      projetoExigido: true,
      itensLaboratorio: lab,
      itensProjeto: proj,
      parametrosProjeto: {},
    });
    expect(r.totalLaboratorioCusto).toBe(0);
    expect(r.totalLaboratorioPreco).toBe(0);
    expect(r.totalProjetoCusto).toBe(70);
    expect(r.totalFinal).toBe(70);
    expect(r.pronto).toBe(false);
    expect(r.pendencias).toEqual([PENDENCIA_LABORATORIO_FORA_DO_TIPO]);
  });

  it("apenas análises: custos de projeto lançados não somam e bloqueiam a emissão", () => {
    const r = consolidarOrcamentoFinal({
      ...revisados,
      laboratorioExigido: true,
      projetoExigido: false,
      itensLaboratorio: lab,
      itensProjeto: proj,
      parametrosProjeto: {},
    });
    expect(r.totalProjetoCusto).toBe(0);
    expect(r.totalFinal).toBe(20);
    expect(r.pronto).toBe(false);
    expect(r.pendencias).toEqual([PENDENCIA_PROJETO_FORA_DO_TIPO]);
  });

  it("misto: soma os dois e aplica os parâmetros uma única vez", () => {
    const r = consolidarOrcamentoFinal({
      ...revisados,
      laboratorioExigido: true,
      projetoExigido: true,
      itensLaboratorio: lab,
      itensProjeto: proj,
      parametrosProjeto: { lucro: 30 },
    });
    expect(r.subtotalTecnico).toBe(90);
    expect(r.totalFinal).toBe(128.57);
    expect(r.pronto).toBe(true);
    expect(r.pendencias).toEqual([]);
  });

  it("módulo fora do tipo e vazio não gera pendência", () => {
    const r = consolidarOrcamentoFinal({
      ...revisados,
      laboratorioExigido: false,
      projetoExigido: true,
      itensLaboratorio: [],
      itensProjeto: proj,
      parametrosProjeto: {},
    });
    expect(r.pronto).toBe(true);
    expect(r.pendencias).toEqual([]);
  });
});
