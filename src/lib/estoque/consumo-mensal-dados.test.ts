import { describe, expect, it } from "vitest";
import { consumoMensalDoBanco, explicarConsumo, rotuloUnidade, sugestaoCobertura, type ConsumoMensal } from "./consumo-mensal-dados";

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

describe("sugestão para cobrir o prazo (item 6)", () => {
  const consumo = (valor: number | null, unidade = "embalagem") => ({
    insumo_id: 1, unidade, janela_meses: 12, meses_historico: 0, meses_com_saida: 0, media_mensal: null, variacao: null,
    ajustes: 0, confianca: "sem_dados" as const, meses: [], manual: null,
    referencia: { origem: (valor === null ? "nenhuma" : "manual") as "manual" | "nenhuma", valor },
  });
  const previsao = { disponivel: 2, qtd_pedida_aberta: 1, estoque_seguranca: 1, lead_time_dias: 60, qtd_sugerida_compra: 0, unidade_saldo: "frasco", modelo_quantidade: "EMBALAGEM_FECHADA" };

  it("usa a estimativa manual quando não há histórico e desconta disponível e pedido aberto", () => {
    // 3/mês × 60 dias = 6 + segurança 1 = 7; falta 7 − 2 − 1 = 4
    expect(sugestaoCobertura(consumo(3), previsao)).toEqual({ quantidade: 4, necessidade: 7, prazoDias: 60, sugestaoAtual: 0 });
  });
  it("sem referência, sem prazo ou com unidades diferentes não sugere", () => {
    expect(sugestaoCobertura(consumo(null), previsao)).toBeNull();
    expect(sugestaoCobertura(consumo(3), { ...previsao, lead_time_dias: 0 })).toBeNull();
    expect(sugestaoCobertura(consumo(3, "mL"), { ...previsao, modelo_quantidade: "FRACIONADO", unidade_saldo: "L" })).toBeNull();
  });
});
