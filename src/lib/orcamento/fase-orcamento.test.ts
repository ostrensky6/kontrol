import { describe, expect, it } from "vitest";
import { faseDoOrcamento, resumirFases, valorDoOrcamento, type LinhaFase } from "./fase-orcamento";

const modulo = (status: string, grupo: LinhaFase["grupo"], total = 0): LinhaFase => ({ origem: "laboratorio", status, grupo, total, criadoEm: "2026-09-01" });
const versao = (status: string, total: number, criadoEm = "2026-09-10"): LinhaFase => ({ origem: "final", status, grupo: "emitidos", total, criadoEm });

describe("fase de cada orçamento (uma só, para o funil somar a lista)", () => {
  it("sem módulos nem proposta: em elaboração", () => {
    expect(faseDoOrcamento("nova", [])).toBe("em_elaboracao");
  });

  it("módulo pronto para revisão: em revisão", () => {
    expect(faseDoOrcamento("em_analise", [modulo("enviado", "revisao")])).toBe("revisao");
  });

  it("proposta viva manda sobre os módulos: emitida", () => {
    expect(faseDoOrcamento("orcada", [modulo("enviado", "revisao"), versao("enviado", 100)])).toBe("emitida");
  });

  it("aprovada vence emitida e recusada", () => {
    expect(faseDoOrcamento("orcada", [versao("recusado", 90), versao("aprovado", 100)])).toBe("aprovada");
  });

  it("recusada quando a proposta foi recusada e não há outra viva", () => {
    expect(faseDoOrcamento("orcada", [versao("recusado", 100)])).toBe("recusada");
    expect(faseDoOrcamento("recusada", [])).toBe("recusada");
  });

  it("cancelada manda sobre tudo", () => {
    expect(faseDoOrcamento("cancelada", [versao("aprovado", 100)])).toBe("cancelada");
  });

  it("módulo cancelado não conta como revisão", () => {
    expect(faseDoOrcamento("em_analise", [modulo("cancelado", "decididos")])).toBe("em_elaboracao");
  });

  it("resumo conta uma fase por orçamento", () => {
    expect(resumirFases(["em_elaboracao", "emitida", "emitida", "aprovada"])).toEqual({
      em_elaboracao: 1,
      revisao: 0,
      emitida: 2,
      aprovada: 1,
      recusada: 0,
      cancelada: 0,
    });
  });
});

describe("valor mostrado na lista", () => {
  it("usa a proposta mais recente que vale (aprovada ou viva)", () => {
    expect(valorDoOrcamento([modulo("enviado", "revisao", 50), versao("substituido", 80, "2026-09-05"), versao("enviado", 120, "2026-09-12")]))
      .toEqual({ valor: 120, origem: "proposta" });
  });

  it("sem proposta, soma os módulos em andamento como estimativa", () => {
    expect(valorDoOrcamento([modulo("rascunho", "em_elaboracao", 50), { ...modulo("rascunho", "em_elaboracao", 30), origem: "projeto" }, modulo("cancelado", "decididos", 999)]))
      .toEqual({ valor: 80, origem: "estimativa" });
  });

  it("sem nada, sem valor", () => {
    expect(valorDoOrcamento([])).toEqual({ valor: null, origem: null });
  });
});
