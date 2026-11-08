import { describe, expect, it } from "vitest";
import { ordenarAvisos, rotuloTipo, textoPrazo } from "./avisos";

describe("avisos de equipamentos (0158)", () => {
  it("descreve o prazo sem jargão", () => {
    expect(textoPrazo({ situacao: "vencido", dias_para_vencer: -1 })).toBe("Venceu há 1 dia");
    expect(textoPrazo({ situacao: "vencido", dias_para_vencer: -12 })).toBe("Venceu há 12 dias");
    expect(textoPrazo({ situacao: "proximo", dias_para_vencer: 0 })).toBe("Vence hoje");
    expect(textoPrazo({ situacao: "proximo", dias_para_vencer: 30 })).toBe("Vence em 30 dias");
    expect(textoPrazo({ situacao: "sem_registro", dias_para_vencer: null })).toBe("Nenhuma realizada registrada");
  });

  it("põe vencidos primeiro, depois sem registro, depois os mais próximos", () => {
    const lista = ordenarAvisos([
      { situacao: "proximo" as const, dias_para_vencer: 40 },
      { situacao: "sem_registro" as const, dias_para_vencer: null },
      { situacao: "proximo" as const, dias_para_vencer: 5 },
      { situacao: "vencido" as const, dias_para_vencer: -3 },
    ]);
    expect(lista.map((a) => a.dias_para_vencer)).toEqual([-3, null, 5, 40]);
  });

  it("nomeia os tipos", () => {
    expect(rotuloTipo("calibracao")).toBe("Calibração");
    expect(rotuloTipo("algo_novo")).toBe("algo novo");
  });
});
