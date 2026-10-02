import { describe, expect, it } from "vitest";
import {
  calcularDivergenciaInventario,
  descreverDiferencaInventario,
  exigeJustificativaInventario,
  unidadeDoLote,
} from "./contagem";

describe("contagem de inventario", () => {
  it("calcula divergencia positiva", () => {
    expect(calcularDivergenciaInventario(10, 12)).toEqual({
      quantidadeSistema: 10,
      quantidadeContada: 12,
      divergencia: 2,
      temDivergencia: true,
    });
  });

  it("calcula divergencia negativa", () => {
    expect(calcularDivergenciaInventario(10, 7).divergencia).toBe(-3);
  });

  it("nao exige justificativa quando a contagem bate com o sistema", () => {
    expect(exigeJustificativaInventario(5, 5)).toBe(false);
  });

  it("exige justificativa quando ha divergencia", () => {
    expect(exigeJustificativaInventario(5, 4.5)).toBe(true);
  });
});

describe("frase da diferença de inventário", () => {
  it("diz quanto falta, com o que o sistema tem e o que foi encontrado", () => {
    expect(descreverDiferencaInventario(50, 40, "un")).toEqual({
      curta: "Faltam 10 un",
      frase: "Faltam 10 un: o sistema tem 50, foram encontrados 40.",
      tipo: "falta",
    });
  });

  it("diz quanto sobra", () => {
    expect(descreverDiferencaInventario(50, 55).frase).toBe("Sobram 5: o sistema tem 50, foram encontrados 55.");
  });

  it("usa o singular para 1", () => {
    expect(descreverDiferencaInventario(3, 2, "frasco").curta).toBe("Falta 1 frasco");
    expect(descreverDiferencaInventario(3, 4).curta).toBe("Sobra 1");
  });

  it("confirma quando bate", () => {
    expect(descreverDiferencaInventario(50, 50)).toEqual({
      curta: "Confere",
      frase: "Confere: o sistema tem 50 e foram encontrados 50.",
      tipo: "confere",
    });
  });

  it("usa vírgula decimal", () => {
    expect(descreverDiferencaInventario(2.5, 1, "L").curta).toBe("Faltam 1,5 L");
  });

  it("unidade do lote igual à do Controle de Estoque", () => {
    expect(
      unidadeDoLote(
        { modelo_quantidade: "EMBALAGEM_FECHADA", conteudo_embalagem_snapshot: "1000", unidade_fisica_snapshot: "Un" },
        "Un",
      ),
    ).toBe("frasco(s) de 1000 Un");
    expect(unidadeDoLote({ modelo_quantidade: "LEGADO" }, "mL")).toBe("mL");
    expect(unidadeDoLote(null, "mL")).toBe("mL");
  });
});
