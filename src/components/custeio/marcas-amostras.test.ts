import { describe, expect, it } from "vitest";

import { marcasDeAmostras } from "./CusteioAmostrasChart";

describe("marcas do eixo de amostras no custeio", () => {
  it("usa passos redondos e no máximo umas 11 marcas", () => {
    expect(marcasDeAmostras(192)).toEqual([1, 24, 48, 72, 96, 120, 144, 168, 192]);
    expect(marcasDeAmostras(48)).toEqual([1, 6, 12, 18, 24, 30, 36, 42, 48]);
    for (const maximo of [12, 60, 96, 192, 384, 1000]) {
      const marcas = marcasDeAmostras(maximo);
      expect(marcas.length).toBeLessThanOrEqual(12);
      expect(marcas[0]).toBe(1);
      expect(marcas[marcas.length - 1]).toBe(maximo);
    }
  });
});
