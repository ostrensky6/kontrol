import { describe, expect, it } from "vitest";
import { insumosSemCustoDoSnapshot, insumosSemCustoDosItens } from "./insumos-sem-custo";

describe("insumos sem preço no orçamento", () => {
  it("lê a lista gravada e ignora formatos inválidos", () => {
    expect(insumosSemCustoDoSnapshot({ insumos_sem_custo: ["Kit X", "", 3] })).toEqual(["Kit X"]);
    expect(insumosSemCustoDoSnapshot(null)).toEqual([]);
    expect(insumosSemCustoDoSnapshot({})).toEqual([]);
  });
  it("junta sem repetir", () => {
    expect(insumosSemCustoDosItens([
      { valor_snapshot: { insumos_sem_custo: ["A", "B"] } },
      { valor_snapshot: { insumos_sem_custo: ["B"] } },
      { valor_snapshot: null },
    ])).toEqual(["A", "B"]);
  });
});
