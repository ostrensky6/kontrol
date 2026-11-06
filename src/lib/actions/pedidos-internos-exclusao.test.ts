import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pode: vi.fn(), single: vi.fn(), selectDeleted: vi.fn(),
  revalidatePath: vi.fn(), redirect: vi.fn(), from: vi.fn(),
  filters: [] as unknown[][],
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/permissao-efetiva", () => ({ pode: mocks.pode }));
vi.mock("@/lib/auth/roles", () => ({ usuarioAtual: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: mocks.from }) }));
import { excluirPedidoInterno } from "./pedidos-internos";

describe("exclusão de rascunho interno", () => {
  let deletePedido: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.filters.length = 0;
    mocks.pode.mockResolvedValue(true);
    mocks.single.mockResolvedValue({ data: { status: "rascunho", pedido_compra_id: null }, error: null });
    mocks.selectDeleted.mockResolvedValue({ data: [{ id: 10 }], error: null });
    const query = {
      eq: (key: string, value: unknown) => { mocks.filters.push([key, value]); return query; },
      is: (key: string, value: unknown) => { mocks.filters.push([key, value]); return query; },
      select: mocks.selectDeleted,
      then: (resolve: (value: unknown) => unknown) => resolve({ error: null }),
    };
    deletePedido = vi.fn(() => query);
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ single: mocks.single }) }),
      delete: deletePedido,
    });
  });
  function excluir() {
    const fd = new FormData();
    fd.set("pedido_interno_id", "10");
    return excluirPedidoInterno({ ok: false }, fd);
  }
  it("nega sem pedido.aprovar antes do acesso ao banco", async () => {
    mocks.pode.mockResolvedValue(false);
    expect(await excluir()).toMatchObject({ ok: false });
    expect(mocks.pode).toHaveBeenCalledWith("pedido.aprovar");
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([
    { status: "em_validacao", pedido_compra_id: null },
    { status: "rascunho", pedido_compra_id: 20 },
  ])("bloqueia status/vínculo inválido: %j", async (pedido) => {
    mocks.single.mockResolvedValue({ data: pedido, error: null });
    expect(await excluir()).toMatchObject({ ok: false });
    expect(deletePedido).not.toHaveBeenCalled();
  });
  it("exclui por um único DELETE com as condições repetidas atomicamente", async () => {
    await excluir();
    expect(deletePedido).toHaveBeenCalledTimes(1);
    expect(mocks.filters).toEqual([["id", 10], ["status", "rascunho"], ["pedido_compra_id", null]]);
    expect(mocks.selectDeleted).toHaveBeenCalledWith("id");
    expect(mocks.redirect).toHaveBeenCalledWith("/pedido");
  });
  it.each([
    { data: [], error: null },
    { data: null, error: null },
    { data: null, error: { message: "Exclusão recusada." } },
  ])("não sinaliza sucesso em corrida/zero linhas/erro: %j", async (resultado) => {
    mocks.selectDeleted.mockResolvedValue(resultado);
    expect(await excluir()).toMatchObject({ ok: false });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
