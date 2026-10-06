import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("recebimento de item ligado a insumo inativo", () => {
  it("preserva somente o vínculo atual quando ele não está no catálogo ativo", () => {
    const fonte = readFileSync(
      resolve("src/components/pedido/ReceberItemPedidoInterno.tsx"),
      "utf8",
    );

    expect(fonte).toContain("insumos.some((insumo) => insumo.id === item.insumoId)");
    expect(fonte).toContain("`${item.especificacao} (inativo)`");
    expect(fonte).toContain("insumosDisponiveis.map((insumo)");
  });
});
