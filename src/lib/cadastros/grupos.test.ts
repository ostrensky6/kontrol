import { describe, expect, it } from "vitest";

import { ORDEM_CADASTROS, getCadastrosOrdenados } from "./config";
import { GRUPOS_CADASTROS, grupoDoCadastro, grupoPorId, rotaDoGrupo, slugDaRotaDeCadastro } from "./grupos";

describe("grupos de cadastros (revisão de 11/11, 8.8)", () => {
  it("são 4 grupos e cada cadastro fica em exatamente um", () => {
    expect(GRUPOS_CADASTROS.map((grupo) => grupo.label)).toEqual(["Materiais", "Pessoas e áreas", "Comercial", "Custos"]);
    const agrupados = GRUPOS_CADASTROS.flatMap((grupo) => [...grupo.slugs]);
    expect(new Set(agrupados).size).toBe(agrupados.length);
    expect([...agrupados].sort()).toEqual(getCadastrosOrdenados().map((cadastro) => cadastro.slug).sort());
    expect([...agrupados].sort()).toEqual([...ORDEM_CADASTROS].sort());
  });

  it("acha o grupo pelo cadastro e pela rota; fora de um cadastro não há grupo", () => {
    expect(grupoDoCadastro("insumos")?.id).toBe("materiais");
    expect(grupoDoCadastro("responsaveis")?.id).toBe("pessoas");
    expect(grupoDoCadastro("fornecedores")?.id).toBe("comercial");
    expect(grupoDoCadastro("overhead")?.id).toBe("custos");
    expect(grupoDoCadastro("qualidade")).toBeNull();
    expect(slugDaRotaDeCadastro("/cadastros/insumos")).toBe("insumos");
    expect(slugDaRotaDeCadastro("/cadastros/insumos/export")).toBe("insumos");
    expect(slugDaRotaDeCadastro("/cadastros")).toBeNull();
    expect(slugDaRotaDeCadastro("/cadastros/qualidade")).toBeNull();
    expect(slugDaRotaDeCadastro("/cadastros/grupo/materiais")).toBeNull();
    expect(slugDaRotaDeCadastro("/estoque/insumos")).toBeNull();
  });

  it("o endereço do grupo é próprio e grupo desconhecido não existe", () => {
    expect(rotaDoGrupo("materiais")).toBe("/cadastros/grupo/materiais");
    expect(grupoPorId("materiais")?.slugs[0]).toBe("insumos");
    expect(grupoPorId("outro")).toBeNull();
  });

  it("o nome do cadastro de responsáveis cabe na aba", () => {
    const titulos = getCadastrosOrdenados().map((cadastro) => cadastro.titulo);
    expect(titulos).toContain("Responsáveis por etapa");
    expect(Math.max(...titulos.map((titulo) => titulo.length))).toBeLessThanOrEqual(26);
  });
});
