import { describe, expect, it } from "vitest";
import { montarEtapasProposta, ORDEM_ETAPAS, type EntradaEtapasProposta } from "./etapas-proposta";

const base: EntradaEtapasProposta = {
  demandaId: 7,
  modalidade: "analises",
  demandaCompleta: true,
  demandaFaltante: 0,
  laboratorioStatus: "pendente",
  laboratorioLabel: "Pendente",
  projetoStatus: "pendente",
  projetoLabel: "Pendente",
  parametrosLiberados: false,
  orcamentoFinalPronto: false,
  versoesFinais: 0,
};

function etapa(modalidade: string, id: string, extra: Partial<EntradaEtapasProposta> = {}) {
  return montarEtapasProposta({ ...base, ...extra, modalidade }).find((item) => item.id === id);
}

const aplicaveis = (modalidade: string) =>
  montarEtapasProposta({ ...base, modalidade })
    .filter((e) => e.aplicavel)
    .map((e) => e.label);

describe("montarEtapasProposta — modelo único", () => {
  it("ordem e ids são fixos e incluem histórico", () => {
    const ids = montarEtapasProposta({ ...base, modalidade: "analises" }).map((e) => e.id);
    expect(ids).toEqual(ORDEM_ETAPAS);
    expect(ids).toEqual(["demanda", "laboratorio", "projeto", "parametros", "final", "historico"]);
  });

  it("cada etapa traz o modelo unificado completo", () => {
    const lab = etapa("analises", "laboratorio");
    expect(lab).toMatchObject({
      id: "laboratorio",
      label: "Orçamento laboratorial",
      aplicavel: true,
      obrigatoria: true,
    });
    expect(lab).toHaveProperty("estado");
    expect(lab).toHaveProperty("status");
    expect(lab?.href).toBe("/orcamento/demandas/7?etapa=laboratorio");
  });

  it("apenas análises: laboratório aplicável, projeto pulado", () => {
    expect(aplicaveis("analises")).toEqual([
      "Dados",
      "Orçamento laboratorial",
      "Parâmetros econômicos",
      "Proposta final",
      "Histórico e auditoria",
    ]);
    expect(etapa("analises", "laboratorio")).toMatchObject({ obrigatoria: true, estado: "ativo" });
    expect(etapa("analises", "projeto")).toMatchObject({ aplicavel: false, obrigatoria: false, estado: "pulado" });
  });

  it("apenas projeto: projeto aplicável, laboratório pulado", () => {
    expect(aplicaveis("projeto")).toEqual([
      "Dados",
      "Custos do projeto",
      "Parâmetros econômicos",
      "Proposta final",
      "Histórico e auditoria",
    ]);
    expect(etapa("projeto", "laboratorio")).toMatchObject({ aplicavel: false, estado: "pulado" });
    expect(etapa("projeto", "projeto")).toMatchObject({ obrigatoria: true, estado: "ativo" });
  });

  it("reconhece a modalidade canônica projeto_com_analises", () => {
    expect(aplicaveis("projeto_com_analises")).toEqual([
      "Dados",
      "Orçamento laboratorial",
      "Custos do projeto",
      "Parâmetros econômicos",
      "Proposta final",
      "Histórico e auditoria",
    ]);
    expect(etapa("projeto_com_analises", "laboratorio")).toMatchObject({ obrigatoria: true, estado: "ativo" });
    // laboratório pendente bloqueia projeto
    expect(etapa("projeto_com_analises", "projeto")).toMatchObject({ obrigatoria: true, estado: "bloqueado" });
  });

  it("reconhece as modalidades legadas como projeto+laboratório", () => {
    for (const legada of ["analises_projeto", "projeto_analises_custos"]) {
      expect(etapa(legada, "laboratorio")).toMatchObject({ aplicavel: true });
      expect(etapa(legada, "projeto")).toMatchObject({ aplicavel: true });
    }
  });

  it("libera projeto depois que laboratório deixa de estar pendente", () => {
    expect(
      etapa("projeto_com_analises", "projeto", {
        laboratorioStatus: "preenchido",
        laboratorioLabel: "Preenchido",
      }),
    ).toMatchObject({ obrigatoria: true, estado: "ativo" });
  });

  it("projeto associado força a etapa de projeto mesmo em modalidade só de análises", () => {
    expect(etapa("analises", "projeto", { projetoAssociado: true })).toMatchObject({ aplicavel: true });
  });

  it("parâmetros e final ficam bloqueados até liberação", () => {
    expect(etapa("projeto_com_analises", "parametros")).toMatchObject({ estado: "bloqueado", status: "Bloqueado" });
    expect(etapa("projeto_com_analises", "final")).toMatchObject({ estado: "bloqueado", status: "Bloqueado" });
  });

  it("histórico nunca é obrigatório e reporta a contagem de versões", () => {
    expect(etapa("analises", "historico", { versoesFinais: 3 })).toMatchObject({
      obrigatoria: false,
      aplicavel: true,
      status: "3 versão(ões)",
    });
  });
});
