import { describe, expect, it } from "vitest";

import { HELP, ajudaParaRota } from "./ContextHelp";

const JARGAO = /snapshot|engine|command palette|FEFO|in-app/i;

describe("ajuda contextual", () => {
  it("ORD163 associa consumidores reais sem capturar rotas vizinhas", () => {
    expect(ajudaParaRota("/nomeacoes").title).toBe("Nomear funções sem gerenciar contas");
    expect(ajudaParaRota("/projetos/123").title).toBe("Consultar e alterar vínculos de um projeto");
    expect(ajudaParaRota("/estoque/equipamentos").checks.join(" ")).toMatch(/Nenhum deles.*comprova envio de e-mail/);
    expect(ajudaParaRota("/analises/EXEMPLO").checks.join(" ")).toContain("até desmontar");
    expect(ajudaParaRota("/estoque").checks.join(" ")).toContain("não é telemetria");
    for (const path of ["/nomeacoes-extra", "/projetos/123/editar", "/projetos/novo"]) expect(ajudaParaRota(path).title).toBe("Kontrol");
    expect(ajudaParaRota("/analises/nova").title).toBe("Análises");
  });
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
