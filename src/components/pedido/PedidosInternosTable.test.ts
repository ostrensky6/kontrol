import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";

vi.mock("@/components/common/DataTable", () => ({ DataTable: () => null }));
vi.mock("@/lib/actions/pedidos-internos", () => ({ excluirPedidoInterno: vi.fn() }));
import { PedidosInternosTable, type PedidoInternoRow } from "./PedidosInternosTable";

describe("paridade de exclusão desktop/mobile", () => {
  it.each([
    [true, "rascunho", null, true],
    [false, "rascunho", null, false],
    [true, "em_validacao", null, false],
    [true, "cancelado", null, false],
    [true, "rascunho", 20, false],
    [true, "rascunho", undefined, false],
  ])("permissão=%s status=%s compra=%s", (podeExcluir, status, pedidoCompraId, esperado) => {
    const row = { id: 10, status, pedidoCompraId, numero: "PI-10", itensDetalhe: [] } as unknown as PedidoInternoRow;
    const table = PedidosInternosTable({ rows: [row], podeExcluir });
    const coluna = table.props.columns.find((c: { id?: string }) => c.id === "acoes");
    const desktop = coluna?.cell as ((ctx: { row: { original: PedidoInternoRow } }) => unknown) | undefined;
    const mobile = table.props.getMobileMeta!(row) as ReactElement<{ children: unknown[] }>;
    expect(isValidElement(desktop?.({ row: { original: row } }))).toBe(esperado);
    expect(isValidElement(mobile.props.children.at(-1))).toBe(esperado);
  });
});
