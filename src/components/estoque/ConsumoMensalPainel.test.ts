import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConsumoMensalPainel, nomeMes } from "./ConsumoMensalPainel";

vi.mock("@/components/common/HelpTip", () => ({ HelpTip: () => null }));

describe("ConsumoMensalPainel", () => {
  it("mostra referência, confiança e meses", () => {
    const html = renderToStaticMarkup(createElement(ConsumoMensalPainel, {
      especificacao: "Etanol",
      leitura: { ok: true, dados: {
        insumo_id: 1, unidade: "embalagem", janela_meses: 12, meses_historico: 3, meses_com_saida: 2,
        media_mensal: 1.5, variacao: 0.3, ajustes: 0, confianca: "media",
        meses: [{ mes: "2026-10", saidas: 2, ajustes: 0 }, { mes: "2026-09", saidas: 0, ajustes: 1 }],
        manual: { embalagens_mes: 4, valor: 4, fonte: "x", data_referencia: "2026-10-01", revisao: 1 },
        referencia: { origem: "manual", valor: 4 },
      } },
    }));
    expect(html).toContain("Consumo mensal · Etanol");
    expect(html).toContain("(estimativa manual)");
    expect(html).toContain("Confiança média");
    expect(html).toContain("out/26");
    expect(html).toContain("Média calculada: 1,5 embalagens/mês.");
  });

  it("falha de leitura não vira zero", () => {
    const html = renderToStaticMarkup(createElement(ConsumoMensalPainel, {
      especificacao: "Etanol", leitura: { ok: false, message: "Tente de novo." } }));
    expect(html).toContain("Consumo mensal indisponível. Tente de novo.");
    expect(html).not.toContain("0 embalagens");
  });

  it("formata o mês", () => expect(nomeMes("2026-01")).toBe("jan/26"));
});
