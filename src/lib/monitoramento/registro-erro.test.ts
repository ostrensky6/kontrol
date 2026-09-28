import { describe, expect, it } from "vitest";

import { limparRota, normalizarRegistro } from "./registro-erro";

describe("limparRota", () => {
  it("tira a consulta e troca trechos com cara de token", () => {
    expect(limparRota("/aprovar/Zk3p9QwErTyUiOpAsDfGhJkL1234567890?x=1")).toBe("/aprovar/:token");
    expect(limparRota("/compras/12#itens")).toBe("/compras/12");
    expect(limparRota("/orcamento/[id]")).toBe("/orcamento/[id]");
  });

  it("vazio vira nulo", () => {
    expect(limparRota("  ")).toBeNull();
    expect(limparRota(undefined)).toBeNull();
  });
});

describe("normalizarRegistro", () => {
  it("corta nos limites da 0141 e descarta usuário inválido", () => {
    const linha = normalizarRegistro({
      origem: "navegador",
      mensagem: "x".repeat(5000),
      detalhe: "y".repeat(9000),
      usuarioId: "não é uuid",
    });
    expect(linha.mensagem).toHaveLength(2000);
    expect(linha.detalhe).toHaveLength(8000);
    expect(linha.usuario_id).toBeNull();
  });

  it("mensagem vazia ganha um texto", () => {
    expect(normalizarRegistro({ origem: "servidor", mensagem: "" }).mensagem).toBe("Erro sem mensagem");
  });

  it("mantém usuário válido", () => {
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(normalizarRegistro({ origem: "banco", mensagem: "m", usuarioId: id }).usuario_id).toBe(id);
  });
});
