import { describe, expect, it } from "vitest";

import {
  acharPorCodigoFabricante,
  marcaComCodigo,
  normalizarCodigoFabricante,
  rotuloCodigoFabricante,
} from "./codigo-fabricante";

const catalogo = [
  { id: 1, codigoFabricante: "K9-100" },
  { id: 2, codigoFabricante: "A63881" },
  { id: 3, codigoFabricante: "T-300" },
  { id: 4, codigoFabricante: "t 300" },
  { id: 5, codigoFabricante: null },
];

describe("código do fabricante", () => {
  it("normaliza espaços, hífens e maiúsculas", () => {
    expect(normalizarCodigoFabricante(" K9-100 ")).toBe("k9100");
    expect(normalizarCodigoFabricante("k9 100")).toBe("k9100");
    expect(normalizarCodigoFabricante(null)).toBe("");
  });

  it("acha pelo código exato, mesmo digitado de outro jeito", () => {
    expect(acharPorCodigoFabricante(catalogo, "k9 100")?.id).toBe(1);
    expect(acharPorCodigoFabricante(catalogo, "a63881")?.id).toBe(2);
  });

  it("não escolhe quando o código é repetido, curto ou parcial", () => {
    expect(acharPorCodigoFabricante(catalogo, "T-300")).toBeNull();
    expect(acharPorCodigoFabricante(catalogo, "K9")).toBeNull();
    expect(acharPorCodigoFabricante(catalogo, "A6388")).toBeNull();
  });

  it("monta os rótulos", () => {
    expect(rotuloCodigoFabricante("K9-100")).toBe("cód. K9-100");
    expect(rotuloCodigoFabricante("  ")).toBe("");
    expect(marcaComCodigo("Kasvi", "K9-100")).toBe("Kasvi · cód. K9-100");
    expect(marcaComCodigo(null, "K9-100")).toBe("cód. K9-100");
    expect(marcaComCodigo("Kasvi", null)).toBe("Kasvi");
  });
});
