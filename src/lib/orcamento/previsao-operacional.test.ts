import { describe, expect, it } from "vitest";
import { calcularPrevisaoOperacionalDemanda } from "./previsao-operacional";

describe("previsao de reagentes usa a mesma selecao do planejamento", () => {
  it("em um grupo de escolha considera so uma alternativa (a de maior custo por amostra, por segurança)", () => {
    const [previsao] = calcularPrevisaoOperacionalDemanda({
      analises: [{ codigo_analise: "PCR", quantidade_amostras: 10 }],
      etapas: [{ codigo_analise: "PCR", nome_etapa: "Extração", nome_atividade: "Extrair", execucoes_por_dia: 1, amostras_por_execucao: 10 }],
      insumos: [
        { codigo_analise: "PCR", especificacao_insumo: "Kit A", unidade: "un", quantidade_por_amostra: 1, modo_cobranca: "por_amostra", grupo_escolha: "kit", custo_unitario: 5 },
        { codigo_analise: "PCR", especificacao_insumo: "Kit B", unidade: "un", quantidade_por_amostra: 1, modo_cobranca: "por_amostra", grupo_escolha: "kit", custo_unitario: 9 },
        { codigo_analise: "PCR", especificacao_insumo: "Tampão", unidade: "mL", quantidade_por_amostra: 2, modo_cobranca: "por_amostra", grupo_escolha: null, custo_unitario: 1 },
      ],
    });
    expect(previsao.reagentes.map((r) => [r.especificacao, r.consumo_total])).toEqual([
      ["Tampão", 20],
      ["Kit B", 10],
    ]);
  });
});
