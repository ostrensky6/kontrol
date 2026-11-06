import { describe, expect, it } from "vitest";
import { contemBusca, normalizarBusca } from "./busca";

describe("busca sem acento", () => {
  it("ignora acento e maiúsculas nos dois lados", () => {
    expect(contemBusca("Ácido clorídrico", "acido")).toBe(true);
    expect(contemBusca("acido cloridrico", "ÁCIDO CLORÍDRICO")).toBe(true);
    expect(contemBusca("Ponteira 10 µL", "ponteira")).toBe(true);
    expect(contemBusca("Tubo", "frasco")).toBe(false);
  });

  it("termo vazio casa com tudo; objeto e nulo viram texto vazio", () => {
    expect(contemBusca("x", "  ")).toBe(true);
    expect(normalizarBusca(null)).toBe("");
    expect(normalizarBusca({ a: 1 })).toBe("");
    expect(normalizarBusca(12.5)).toBe("12.5");
  });
});
