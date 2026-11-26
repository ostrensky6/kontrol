import { describe, expect, it } from "vitest";

import { quantos } from "./plural";

describe("quantos", () => {
  it("usa o singular só para 1", () => {
    expect(quantos(1, "registro")).toBe("1 registro");
    expect(quantos(0, "registro")).toBe("0 registros");
    expect(quantos(12, "registro")).toBe("12 registros");
  });

  it("aceita plural irregular", () => {
    expect(quantos(1, "item", "itens")).toBe("1 item");
    expect(quantos(2, "item", "itens")).toBe("2 itens");
    expect(quantos(3, "mês", "meses")).toBe("3 meses");
  });
});
