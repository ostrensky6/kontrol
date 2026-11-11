import { describe, expect, it } from "vitest";

import { destinoAntigoDoEstoque, hrefVisaoEstoque, VISOES_ESTOQUE, visaoDoEstoque } from "./visao-estoque";

describe("visões da página do Estoque", () => {
  it("a barra tem só saldo e lotes (D1, L10)", () => {
    expect(VISOES_ESTOQUE.map((v) => v.rotulo)).toEqual(["Saldo por insumo", "Lotes em estoque"]);
  });

  it("abre no saldo e aceita ?ver=", () => {
    expect(visaoDoEstoque({})).toBe("saldo");
    expect(visaoDoEstoque({ ver: "lotes" })).toBe("lotes");
    expect(visaoDoEstoque({ ver: "qualquer" })).toBe("saldo");
    expect(hrefVisaoEstoque("lotes")).toBe("/estoque?ver=lotes");
    expect(hrefVisaoEstoque("saldo")).toBe("/estoque");
  });

  it("o consumo abre pela ficha do insumo; a entrada abre o saldo", () => {
    expect(visaoDoEstoque({ consumo_insumo: "7" })).toBe("consumo");
    expect(visaoDoEstoque({ ver: "consumo" })).toBe("consumo");
    expect(visaoDoEstoque({ entrada: "3", ver: "lotes" })).toBe("saldo");
  });

  it("endereços antigos levam ao novo lugar: alertas na Situação, custos no relatório", () => {
    expect(destinoAntigoDoEstoque({ alerta: "vencido" })).toBe("/estoque/situacao");
    expect(destinoAntigoDoEstoque({ alerta: "reposicao", ver: "lotes" })).toBe("/estoque/situacao");
    expect(destinoAntigoDoEstoque({ ver: "custos" })).toBe("/estoque/custos");
    // prova negativa: o resto continua na página do Estoque
    expect(destinoAntigoDoEstoque({})).toBeNull();
    expect(destinoAntigoDoEstoque({ ver: "lotes" })).toBeNull();
    expect(destinoAntigoDoEstoque({ alerta: "" })).toBeNull();
  });
});
