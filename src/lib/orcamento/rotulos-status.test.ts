import { describe, expect, it } from "vitest";
import {
  hojeCalendario,
  rotuloStatusModulo,
  rotuloStatusOrcamento,
  rotuloStatusVersaoFinal,
  statusEfetivoVersaoFinal,
} from "./rotulos-status";

describe("status da versão final", () => {
  it("mostra como vencida a versão emitida com validade passada", () => {
    expect(statusEfetivoVersaoFinal({ status: "emitido", valido_ate: "2026-09-24" }, "2026-09-25")).toBe("vencido");
    expect(statusEfetivoVersaoFinal({ status: "emitido", valido_ate: "2026-09-25" }, "2026-09-25")).toBe("emitido");
  });

  it("não altera status já classificados nem versões sem validade", () => {
    expect(statusEfetivoVersaoFinal({ status: "aprovado", valido_ate: "2020-01-01" }, "2026-09-25")).toBe("aprovado");
    expect(statusEfetivoVersaoFinal({ status: "emitido", valido_ate: null }, "2026-09-25")).toBe("emitido");
    // ORC-7: enviada fora da validade também vence
    expect(statusEfetivoVersaoFinal({ status: "enviado", valido_ate: "2026-09-24" }, "2026-09-25")).toBe("vencido");
  });

  it("usa rótulos legíveis e a data de calendário de São Paulo", () => {
    expect(rotuloStatusVersaoFinal("alterado_reenviado")).toBe("Alterada e reenviada");
    expect(rotuloStatusVersaoFinal("desconhecido")).toBe("desconhecido");
    expect(rotuloStatusModulo("rascunho")).toBe("Rascunho");
    expect(rotuloStatusOrcamento("em_analise")).toBe("Em análise");
    expect(rotuloStatusOrcamento(null)).toBe("—");
    // 02:00 UTC ainda é o dia anterior em São Paulo (UTC−3).
    expect(hojeCalendario(new Date("2026-09-26T02:00:00Z"))).toBe("2026-09-25");
  });
});
