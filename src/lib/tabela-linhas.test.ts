import { describe, expect, it } from "vitest";

import { linhasGuardadas, mostraRodapeDePaginas, opcoesDeLinhas, TODAS_AS_LINHAS } from "./tabela-linhas";

describe("linhas por página das tabelas", () => {
  it("oferece 10, 25, 50 e 100, mais o tamanho inicial da tabela quando é outro", () => {
    expect(opcoesDeLinhas(10)).toEqual([10, 25, 50, 100]);
    expect(opcoesDeLinhas(15)).toEqual([10, 15, 25, 50, 100]);
  });

  it("só aceita preferência guardada que seja uma das opções", () => {
    expect(linhasGuardadas("25")).toBe(25);
    // "Todos" não vira padrão das outras tabelas
    expect(linhasGuardadas(String(TODAS_AS_LINHAS))).toBeNull();
    expect(linhasGuardadas("7")).toBeNull();
    expect(linhasGuardadas("abc")).toBeNull();
    expect(linhasGuardadas(null)).toBeNull();
  });

  it("o rodapé continua visível com Todos escolhido (dá para voltar a paginar)", () => {
    expect(mostraRodapeDePaginas(10)).toBe(false);
    expect(mostraRodapeDePaginas(11)).toBe(true);
  });
});
