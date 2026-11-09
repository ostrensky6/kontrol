import { describe, expect, it } from "vitest";
import { avisoControlados, ehFunpar, itensControlados } from "./controlados";

describe("produtos controlados (D9, 0174)", () => {
  it("insumo marcado ou, sem insumo, o nome na especificação", () => {
    expect(
      itensControlados([
        { especificacao: "Clorofórmio PA 1 L", insumo_id: null },
        { especificacao: "Acetona 99,5%", insumo_id: 4, insumos: { especificacao: "Acetona PA", controlado: true } },
        { especificacao: "Acetonitrila HPLC", insumo_id: null },
        { especificacao: "Etanol", insumo_id: 7, insumos: { especificacao: "Etanol", controlado: false } },
      ]),
    ).toEqual(["Clorofórmio PA 1 L", "Acetona PA"]);
  });

  it("insumo ligado e não marcado não é controlado só pelo nome (o cadastro decide)", () => {
    expect(itensControlados([{ especificacao: "Acetona", insumo_id: 3, insumos: { controlado: false } }])).toEqual([]);
  });

  it("aviso explica FUNPAR, projeto e encaminhamento", () => {
    expect(avisoControlados([])).toBeNull();
    const aviso = avisoControlados(["Clorofórmio"]);
    expect(aviso).toContain("só sai pela FUNPAR");
    expect(aviso).toContain("sem compra direta");
    expect(ehFunpar("Fundação FUNPAR")).toBe(true);
    expect(ehFunpar("Recurso interno")).toBe(false);
  });
});
