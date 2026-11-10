import { describe, expect, it } from "vitest";

import { alertaEstoqueValido, hrefAlertaEstoque, hrefVisaoEstoque, visaoDoEstoque } from "./visao-estoque";

describe("visões da página do Estoque", () => {
  it("abre no saldo e aceita ?ver=", () => {
    expect(visaoDoEstoque({})).toBe("saldo");
    expect(visaoDoEstoque({ ver: "lotes" })).toBe("lotes");
    expect(visaoDoEstoque({ ver: "custos" })).toBe("custos");
    expect(visaoDoEstoque({ ver: "qualquer" })).toBe("saldo");
  });

  it("links antigos continuam valendo: consumo do insumo e entrada", () => {
    expect(visaoDoEstoque({ consumo_insumo: "7" })).toBe("consumo");
    expect(visaoDoEstoque({ entrada: "3", ver: "lotes" })).toBe("saldo");
  });

  it("alerta abre a visão certa: os de insumo no saldo, os de lote nos lotes", () => {
    expect(visaoDoEstoque({ alerta: "reposicao", ver: "lotes" })).toBe("saldo");
    expect(visaoDoEstoque({ alerta: "vencido" })).toBe("lotes");
    expect(alertaEstoqueValido("nada")).toBeNull();
    expect(visaoDoEstoque({ alerta: "nada", ver: "lotes" })).toBe("lotes");
  });

  it("clicar no alerta já escolhido desfaz o filtro e fica na mesma visão", () => {
    expect(hrefAlertaEstoque("vencido", null)).toBe("/estoque?alerta=vencido");
    expect(hrefAlertaEstoque("vencido", "vencido")).toBe("/estoque?ver=lotes");
    expect(hrefAlertaEstoque("reposicao", "reposicao")).toBe("/estoque");
    expect(hrefVisaoEstoque("consumo")).toBe("/estoque?ver=consumo");
  });
});
