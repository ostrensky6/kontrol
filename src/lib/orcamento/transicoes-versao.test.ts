import { describe, expect, it } from "vitest";

import { classificacoesPermitidas, estaVencida, podeTransicionarVersao } from "./transicoes-versao";

describe("transições da versão final", () => {
  it("segue a matriz do banco", () => {
    expect(podeTransicionarVersao("emitido", "aprovado")).toBe(true);
    expect(podeTransicionarVersao("recusado", "aprovado")).toBe(false);
    expect(podeTransicionarVersao("aprovado", "recusado")).toBe(false);
    expect(podeTransicionarVersao("substituido", "enviado")).toBe(false);
  });

  it("não oferece aprovar versão vencida", () => {
    const opcoes = classificacoesPermitidas({ status: "enviado", valido_ate: "2026-09-01", hoje: "2026-09-26" });
    expect(opcoes).not.toContain("aprovado");
    expect(opcoes).toContain("recusado");
    expect(estaVencida("2026-09-26", "2026-09-26")).toBe(false);
  });

  it("com outra versão aprovada, não aprova nem reenvia", () => {
    const opcoes = classificacoesPermitidas({ status: "recusado", hoje: "2026-09-26", outraAprovada: true });
    expect(opcoes).toEqual([]);
  });

  it("recusada só pode ser reenviada", () => {
    expect(classificacoesPermitidas({ status: "recusado", hoje: "2026-09-26" })).toEqual(["alterado_reenviado"]);
  });
});
