import { describe, expect, it } from "vitest";

import { naturezaValida, objetivoValido, rotuloNatureza, rotuloUso, separarSinonimos } from "./natureza";

describe("natureza e objetivo do pedido", () => {
  it("aceita só valores da lista que o banco aceita", () => {
    expect(naturezaValida("material_consumo_lab")).toBe("material_consumo_lab");
    expect(naturezaValida("diaria")).toBe("diaria");
    expect(naturezaValida("inventada")).toBeNull();
    expect(naturezaValida(null)).toBeNull();
    expect(objetivoValido("manutencao_lab")).toBe("manutencao_lab");
    expect(objetivoValido("Projeto")).toBeNull();
    expect(rotuloNatureza("material_consumo_geral")).toBe("Material de consumo geral (campo, coleta)");
    expect(rotuloNatureza(null)).toBeNull();
  });

  it("mostra o uso com o rótulo do formulário, nunca o valor do banco", () => {
    expect(rotuloUso("laboratorio")).toBe("Laboratório");
    expect(rotuloUso("laboratorio_campo")).toBe("Lab./campo");
    expect(rotuloUso(null)).toBe("Laboratório");
  });

  it("separa sinônimos sem vazios nem repetidos", () => {
    expect(separarSinonimos("ponteira; Tip;;  PONTEIRA\npipette tip")).toEqual([
      "ponteira",
      "Tip",
      "pipette tip",
    ]);
    expect(separarSinonimos(null)).toEqual([]);
  });
});
