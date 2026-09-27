import { describe, expect, it } from "vitest";
import { avaliarCompletudeDemanda } from "./demanda-completude";

describe("avaliarCompletudeDemanda", () => {
  it("considera demanda de analises completa com cliente e escopo", () => {
    const resultado = avaliarCompletudeDemanda({
      titulo: "Analises de agua",
      cliente_nome: "Cliente",
      modalidade: "analises",
      escopo_preliminar: "10 amostras",
      matriz_amostra: "Água",
      quantidade_amostras_estimada: 10,
    });

    expect(resultado).toEqual({
      completa: true,
      faltante: 0,
      pendencias: [],
    });
  });

  it("exige projeto vinculado para modalidades com projeto", () => {
    const resultado = avaliarCompletudeDemanda({
      titulo: "Projeto ambiental",
      cliente_nome: "Cliente",
      modalidade: "projeto",
      descricao: "Escopo inicial",
    });

    expect(resultado.completa).toBe(false);
    expect(resultado.faltante).toBe(20);
    expect(resultado.pendencias).toContain("vincular um projeto para modalidades com projeto");
  });

  it("calcula percentual proporcional aos criterios pendentes", () => {
    const resultado = avaliarCompletudeDemanda({
      modalidade: "analises",
    });

    expect(resultado.completa).toBe(false);
    expect(resultado.faltante).toBe(83);
    expect(resultado.pendencias).toEqual([
      "informar o título",
      "informar o cliente (cadastrado ou pelo nome)",
      "descrever o escopo ou a descrição",
      "informar matriz ou tipo de amostra",
      "informar quantidade estimada de amostras",
    ]);
  });

  it("exige matriz e quantidade para modalidades com analises", () => {
    const resultado = avaliarCompletudeDemanda({
      titulo: "Análises",
      cliente_nome: "Cliente",
      modalidade: "analises",
      escopo_preliminar: "Escopo",
    });

    expect(resultado.completa).toBe(false);
    expect(resultado.pendencias).toEqual([
      "informar matriz ou tipo de amostra",
      "informar quantidade estimada de amostras",
    ]);
  });
});
