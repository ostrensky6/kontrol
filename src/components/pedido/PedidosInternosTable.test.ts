import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";

vi.mock("@/components/common/DataTable", () => ({ DataTable: () => null }));
vi.mock("@/lib/actions/pedidos-internos", () => ({ excluirPedidoInterno: vi.fn() }));
vi.mock("./ApagarPedido", () => ({ ApagarPedido: () => null }));
import { PedidosInternosTable, type PedidoInternoRow } from "./PedidosInternosTable";

// 0186 (Antonio, 27/11/2026): apagar vale em qualquer etapa, com ou sem compra; só a permissão decide
describe("paridade de exclusão desktop/mobile", () => {
  it.each([
    [true, "rascunho", null, true],
    [false, "rascunho", null, false],
    [true, "em_validacao", null, true],
    [true, "cancelado", null, true],
    [true, "rascunho", 20, true],
    [false, "aprovado_para_compra", 20, false],
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
