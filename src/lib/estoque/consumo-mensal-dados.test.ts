import { describe, expect, it } from "vitest";
import { consumoMensalDoBanco, explicarConsumo, rotuloUnidade, type ConsumoMensal } from "./consumo-mensal-dados";

const base: ConsumoMensal = {
  insumo_id: 7, unidade: "embalagem", janela_meses: 12, meses_historico: 8, meses_com_saida: 8,
  media_mensal: 2, variacao: 0.1, ajustes: 0, confianca: "alta",
  meses: [{ mes: "2026-10", saidas: 2, ajustes: 0 }], manual: null,
  referencia: { origem: "calculado", valor: 2 },
};

describe("consumo mensal (0157)", () => {
  it("aceita a resposta do banco só para o insumo pedido", () => {
    expect(consumoMensalDoBanco(base, 7)).toEqual(base);
    expect(consumoMensalDoBanco(base, 8)).toBeNull();
    expect(consumoMensalDoBanco({ ...base, confianca: "certificada" }, 7)).toBeNull();
    expect(consumoMensalDoBanco(null, 7)).toBeNull();
  });

  it("explica a confiança e a referência em linguagem simples", () => {
    expect(explicarConsumo(base)).toEqual(["Calculado com 8 meses completos; houve saída em 8 meses."]);
    const curto = { ...base, meses_historico: 2, meses_com_saida: 2, confianca: "baixa" as const, ajustes: 1,
      manual: { embalagens_mes: 5, valor: 5, fonte: "x", data_referencia: "2026-11-01", revisao: 1 },
      referencia: { origem: "manual" as const, valor: 5 } };
    expect(explicarConsumo(curto)).toEqual([
      "Calculado com 2 meses completos; houve saída em 2 meses.",
      "Com mais meses de uso registrados a confiança sobe.",
      "1 ajuste de estoque no período não conta como consumo.",
      "Por isso a referência usa a estimativa manual informada.",
    ]);
    const vazio = { ...base, meses_historico: 0, meses_com_saida: 0, media_mensal: null, variacao: null,
      confianca: "sem_dados" as const, meses: [], referencia: { origem: "nenhuma" as const, valor: null } };
    expect(explicarConsumo(vazio)).toEqual([
      "Ainda não há nenhum mês completo desde o primeiro registro deste insumo.",
      "Informe uma estimativa manual abaixo para ter uma referência.",
    ]);
  });

  it("nomeia a unidade", () => {
    expect(rotuloUnidade("embalagem", 1)).toBe("embalagem");
    expect(rotuloUnidade("embalagem", 2)).toBe("embalagens");
    expect(rotuloUnidade("g", 2)).toBe("g");
  });
});
