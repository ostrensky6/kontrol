import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const contexto = vi.hoisted(() => ({
  pedido: {} as Record<string, unknown>,
  pode: vi.fn(),
}));
vi.mock("@/lib/auth/permissao-efetiva", () => ({ pode: contexto.pode }));
vi.mock("@/lib/actions/eventos", () => ({ listarEventos: async () => [] }));
vi.mock("@/lib/supabase/server", () => ({
  createClientUntyped: async () => ({
    from: () => {
      const query = {
        select: () => query, eq: () => query, order: () => query,
        not: () => query, limit: () => query, neq: () => query, gt: () => query, range: () => query,
        single: async () => ({ data: contexto.pedido }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: [] }),
      };
      return query;
    },
  }),
}));
import PedidoInternoDetalhe from "./[id]/page";
import { PedidoInternoCabecalhoAcoes } from "@/components/pedido/PedidoInternoCabecalhoAcoes";

function cabecalho(node: unknown): ReactElement | undefined {
  if (!isValidElement<{ children?: React.ReactNode }>(node)) return;
  if (node.type === PedidoInternoCabecalhoAcoes) return node;
  return Children.toArray(node.props.children).map(cabecalho).find(Boolean);
}

describe("exclusão no detalhe do pedido", () => {
  beforeEach(() => {
    contexto.pode.mockReset();
    contexto.pode.mockResolvedValue(true);
    contexto.pedido = { id: 10, titulo: "Rascunho", status: "rascunho", pedido_compra_id: null };
  });
  it.each([
    [true, "rascunho", null, true],
    [true, "rascunho", 20, false],
    [true, "rascunho", undefined, false],
    [true, "em_validacao", null, false],
    [false, "rascunho", null, false],
  ] as const)("permissão=%s status=%s compra=%s", async (permitido, status, compraId, esperado) => {
    contexto.pedido.status = status;
    contexto.pedido.pedido_compra_id = compraId;
    contexto.pode.mockImplementation(async (permissao: string) => permissao === "pedido.aprovar" && permitido);
    const page = await PedidoInternoDetalhe({ params: Promise.resolve({ id: "10" }) });
    const acoes = cabecalho(page);
    expect(acoes).toBeDefined();
    const html = renderToStaticMarkup(acoes!);
    expect(html.includes("Excluir")).toBe(esperado);
  });
});
