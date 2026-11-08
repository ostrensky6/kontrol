import { describe, expect, it } from "vitest";
import { agruparEquivalentes, type InsumoTipo } from "./equivalentes";

const cat: InsumoTipo[] = [
  { id: 1, especificacao: "Taq marca A", fabricante: "A", unidade: "µL", tipo_insumo_id: 10 },
  { id: 2, especificacao: "Taq marca B", fabricante: "B", unidade: "µL", tipo_insumo_id: 10 },
  { id: 3, especificacao: "Taq marca C (inativa)", fabricante: "C", unidade: "µL", tipo_insumo_id: 10, ativo: false },
  { id: 4, especificacao: "Taq marca D", fabricante: "D", unidade: "µL", tipo_insumo_id: 10 },
  { id: 5, especificacao: "Ponteira", fabricante: null, unidade: "un", tipo_insumo_id: null },
];

describe("agruparEquivalentes", () => {
  it("lista outros insumos ativos do mesmo tipo com saldo, maior saldo primeiro", () => {
    const r = agruparEquivalentes([1], cat, new Map([[2, 50], [3, 900], [4, 120], [1, 0]]));
    expect(r.get(1)?.map((e) => e.insumo_id)).toEqual([4, 2]);
  });
  it("ignora insumo sem tipo e equivalentes sem saldo", () => {
    expect(agruparEquivalentes([5], cat, new Map([[1, 10]])).size).toBe(0);
    expect(agruparEquivalentes([1], cat, new Map([[2, 0]])).size).toBe(0);
  });
});
