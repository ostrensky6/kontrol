import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
const redirect = vi.fn();
const rpc = vi.fn();
const from = vi.fn();
const registrarEvento = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/roles", () => ({
  temPapel: vi.fn(async () => true),
  usuarioAtual: vi.fn(async () => ({ nome: "Coordenador", email: "coord@example.com", papel: "coordenador" })),
}));
vi.mock("@/lib/auth/permissao-efetiva", () => ({
  pode: vi.fn(async () => true),
  temPermissao: vi.fn(async () => true),
}));
vi.mock("./eventos", () => ({ registrarEvento }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from, rpc })),
}));

/**
 * O recebimento pelo item do pedido (receberItemPedidoInterno) saiu da tela
 * com o formulário antigo de chegada (auditoria de 16/11, item 10, proposta
 * 1): a chegada é registrada pela compra. Ficam aqui a formalização e o
 * estorno, que continuam em uso.
 */
describe("pedido interno: formalização e estorno de recebimento", () => {
  beforeEach(() => {
    revalidatePath.mockReset();
    redirect.mockReset();
    rpc.mockReset();
    from.mockReset();
    registrarEvento.mockReset();
    rpc.mockResolvedValue({ error: null });
  });

  it("formaliza pedido interno mantendo vinculo entre item interno e item da compra formal", async () => {
    const { formalizarPedidoInterno } = await import("./pedidos-internos");
    const formData = new FormData();
    formData.set("pedido_interno_id", "10");

    const result = await formalizarPedidoInterno({ ok: false }, formData);

    expect(result).toEqual({ ok: true, message: "Pedido formalizado e compra criada." });
    expect(rpc).toHaveBeenCalledWith(
      "formalizar_pedido_interno",
      expect.objectContaining({
        p_pedido_id: 10,
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/compras");
  });

  it("estorna um lançamento pelo RPC transacional, sem mutar estoque diretamente", async () => {
    const { estornarRecebimentoLancamento } = await import("./pedidos-internos");
    const formData = new FormData();
    formData.set("pedido_interno_id", "10");
    formData.set("item_id", "5");
    formData.set("recebimento_id", "15");

    const result = await estornarRecebimentoLancamento({ ok: false }, formData);

    expect(result).toEqual({ ok: true, message: "Lançamento de recebimento estornado." });
    expect(rpc).toHaveBeenCalledWith(
      "estornar_recebimento_item_pedido_interno",
      expect.objectContaining({
        p_pedido_id: 10,
        p_item_id: 5,
        p_recebimento_id: 15,
      }),
    );
  });
});
