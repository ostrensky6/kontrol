import { describe, expect, it } from "vitest";

import { criariaCicloLocal, nomesDosPais } from "./locais";

const locais = [
  { id: 1, parent_id: null, nome: "Prédio" },
  { id: 2, parent_id: 1, nome: "Sala" },
  { id: 3, parent_id: 2, nome: "Freezer" },
  { id: 4, parent_id: null, nome: "Depósito" },
];

describe("hierarquia dos locais", () => {
  it("aceita mover para outro ramo ou para o primeiro nível", () => {
    expect(criariaCicloLocal(locais, 3, 4)).toBe(false);
    expect(criariaCicloLocal(locais, 2, null)).toBe(false);
    expect(criariaCicloLocal(locais, 4, 3)).toBe(false);
  });

  it("recusa ficar dentro de si mesmo ou de um descendente", () => {
    expect(criariaCicloLocal(locais, 2, 2)).toBe(true);
    expect(criariaCicloLocal(locais, 1, 3)).toBe(true);
  });

  it("laço já existente nos dados é tratado como ciclo", () => {
    const quebrado = [
      { id: 10, parent_id: 11 },
      { id: 11, parent_id: 10 },
    ];
    expect(criariaCicloLocal(quebrado, 99, 10)).toBe(true);
  });

  it("resolve o nome do local pai", () => {
    const nomes = nomesDosPais(locais);
    expect(nomes.get("3")).toBe("Sala");
    expect(nomes.has("1")).toBe(false);
  });
});
