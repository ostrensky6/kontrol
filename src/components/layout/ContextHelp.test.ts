import { describe, expect, it } from "vitest";

import { HELP, ajudaParaRota } from "./ContextHelp";

const JARGAO = /snapshot|engine|command palette|FEFO|in-app/i;

describe("ajuda contextual", () => {
  it("usa linguagem do usuário, sem jargão interno", () => {
    for (const { content } of HELP) {
      const texto = [content.title, content.description, ...content.checks].join(" ");
      expect(texto, content.title).not.toMatch(JARGAO);
    }
  });

  it("explica as ações novas do estoque", () => {
    const estoque = ajudaParaRota("/estoque").checks.join(" ");
    expect(estoque).toContain("+ Entrada");
    expect(estoque).toMatch(/número do lote/);
    expect(estoque).toMatch(/Dar baixa.*motivo.*perda.*vencimento/);
    expect(estoque).toMatch(/lote que vence antes/);
    expect(estoque).toContain("Planilha de insumos");
    expect(estoque).toContain("Cadastros");
  });

  it("escolhe a regra mais específica por rota", () => {
    expect(ajudaParaRota("/estoque/inventario").title).toBe("Inventário");
    expect(ajudaParaRota("/estoque/leitura").title).toBe("Entrada e saída por leitura");
    expect(ajudaParaRota("/orcamento/demandas").title).toBe("Orçamento");
    expect(ajudaParaRota("/parametros").title).toBe("Custeio");
    expect(ajudaParaRota("/qualquer-coisa").title).toBe("Kontrol");
  });
});
