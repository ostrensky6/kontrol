import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pode: vi.fn(), single: vi.fn(), selectDeleted: vi.fn(),
  revalidatePath: vi.fn(), redirect: vi.fn(), from: vi.fn(),
  rpc: vi.fn(), remove: vi.fn(), storageFrom: vi.fn(),
  filters: [] as unknown[][],
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/permissao-efetiva", () => ({ pode: mocks.pode }));
vi.mock("@/lib/auth/roles", () => ({ usuarioAtual: vi.fn() }));
vi.mock("@/lib/supabase/server", () => {
  const cliente = async () => ({ from: mocks.from, rpc: mocks.rpc, storage: { from: mocks.storageFrom } });
  return { createClient: cliente, createClientUntyped: cliente };
});
import { excluirPedidoInterno } from "./pedidos-internos";

const SEM_FUNCAO = { code: "PGRST202", message: "Could not find the function public.excluir_pedido_interno" };

describe("apagar pedido (0186: qualquer etapa)", () => {
  let deletePedido: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.filters.length = 0;
    mocks.pode.mockResolvedValue(true);
    mocks.rpc.mockResolvedValue({
      data: { pedido_id: 10, arquivos: [{ bucket: "pedidos-internos-anexos", path: "10/termo.pdf" }, { bucket: "pedidos-internos-anexos", path: "10/orc.pdf" }] },
      error: null,
    });
    mocks.remove.mockResolvedValue({ error: null });
    mocks.storageFrom.mockReturnValue({ remove: mocks.remove });
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
  function excluir(extra: Record<string, string> = {}) {
    const fd = new FormData();
    fd.set("pedido_interno_id", "10");
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    return excluirPedidoInterno({ ok: false }, fd);
  }

  it("nega sem pedido.aprovar antes do acesso ao banco", async () => {
    mocks.pode.mockResolvedValue(false);
    expect(await excluir()).toMatchObject({ ok: false });
    expect(mocks.pode).toHaveBeenCalledWith("pedido.aprovar");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("apaga pela função do banco, remove os arquivos e volta à lista de onde veio", async () => {
    await excluir({ motivo: "Pedido de teste", voltar: "/pedido?ver=aprovacoes" });
    expect(mocks.rpc).toHaveBeenCalledWith("excluir_pedido_interno", { p_pedido_id: 10, p_motivo: "Pedido de teste" });
    expect(mocks.storageFrom).toHaveBeenCalledWith("pedidos-internos-anexos");
    expect(mocks.remove).toHaveBeenCalledWith(["10/termo.pdf", "10/orc.pdf"]);
    expect(deletePedido).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/pedido?ver=aprovacoes");
  });

  it("não volta para endereço fora de Pedidos", async () => {
    await excluir({ voltar: "https://exemplo.invalid/pedido" });
    expect(mocks.redirect).toHaveBeenCalledWith("/pedido");
  });

  it("arquivo que não sai do Storage não trava a exclusão", async () => {
    mocks.remove.mockResolvedValue({ error: { message: "falhou" } });
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    await excluir();
    expect(mocks.redirect).toHaveBeenCalledWith("/pedido");
    aviso.mockRestore();
  });

  it("mostra a recusa do banco (material já chegou ao estoque)", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "Já chegou material deste pedido no estoque, e o histórico do estoque depende dele. Ele não pode ser apagado: use Cancelar." } });
    const r = await excluir();
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toContain("Já chegou material");
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  describe("banco antes da 0186: só rascunho sem compra, como antes", () => {
    beforeEach(() => mocks.rpc.mockResolvedValue({ data: null, error: SEM_FUNCAO }));

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
});
