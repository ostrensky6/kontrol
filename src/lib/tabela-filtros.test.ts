import { describe, expect, it } from "vitest";
import { chaveFiltros, restaurarFiltros, serializarFiltros } from "./tabela-filtros";

describe("filtros da tabela guardados na aba", () => {
  it("a chave separa página e tabela (conjunto de colunas)", () => {
    const a = chaveFiltros("/orcamento/demandas", ["titulo", "cliente", "statusLabel"]);
    const b = chaveFiltros("/orcamento/demandas", ["numero", "total"]);
    const c = chaveFiltros("/compras", ["titulo", "cliente", "statusLabel"]);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).toBe(chaveFiltros("/orcamento/demandas", ["titulo", "cliente", "statusLabel"]));
  });

  it("guarda e devolve busca e filtros por coluna", () => {
    const texto = serializarFiltros({
      busca: "cliente demo",
      colunas: [{ id: "statusLabel", value: "Rascunho" }],
    });
    expect(restaurarFiltros(texto, ["titulo", "statusLabel"])).toEqual({
      busca: "cliente demo",
      colunas: [{ id: "statusLabel", value: "Rascunho" }],
    });
  });

  it("descarta filtro de coluna que a tabela não tem mais", () => {
    const texto = serializarFiltros({ busca: "", colunas: [{ id: "antiga", value: "x" }, { id: "status", value: "ok" }] });
    expect(restaurarFiltros(texto, ["status"])).toEqual({ busca: "", colunas: [{ id: "status", value: "ok" }] });
  });

  it("ignora conteúdo inválido ou vazio sem quebrar a página", () => {
    expect(restaurarFiltros(null, ["a"])).toBeNull();
    expect(restaurarFiltros("não é json", ["a"])).toBeNull();
    expect(restaurarFiltros(JSON.stringify({ busca: 3, colunas: "x" }), ["a"])).toBeNull();
  });

  it("nada para guardar quando não há filtro", () => {
    expect(serializarFiltros({ busca: "", colunas: [] })).toBeNull();
  });
});
