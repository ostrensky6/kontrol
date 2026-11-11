import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
const redirect = vi.fn();
const rpc = vi.fn();
const from = vi.fn();
const itemSingle = vi.fn();
const insumoInsert = vi.fn();
const insumoInsertSingle = vi.fn();
const insumoCategorySingle = vi.fn();
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

function itemRecebimento() {
  return {
    id: 5,
    insumo_id: null,
    quantidade: 2,
    unidade: "frasco",
    especificacao: "Kit extração DNA",
    fornecedor_sugerido: "Fornecedor A",
    orcamento_previo: 150,
    recebido_em: null,
    pedidos_internos: {
      status: "aprovado_para_compra",
      projetos: { nome: "Projeto A" },
    },
  };
}

function formRecebimento(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const base: Record<string, string> = {
    item_id: "5",
    pedido_interno_id: "10",
    operacao_id: "22222222-2222-4222-8222-222222222222",
    quantidade: "2",
    unidade: "frasco",
    novo_insumo: "Kit extração DNA",
    categoria_compra: "operacional",
    fator_conversao: "1",
    custo: "150",
  };
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    formData.set(key, value);
  }
  return formData;
}

function configureSupabase() {
  from.mockImplementation((table: string) => {
    if (table === "pedidos_internos_itens") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: itemSingle,
            })),
          })),
        })),
      };
    }
    if (table === "insumos") {
      return {
        insert: insumoInsert,
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: insumoCategorySingle,
          })),
        })),
      };
    }
    return {};
  });
  insumoInsert.mockReturnValue({
    select: vi.fn(() => ({
      single: insumoInsertSingle,
    })),
  });
}

describe("recebimento de pedido interno", () => {
  beforeEach(() => {
    revalidatePath.mockReset();
    redirect.mockReset();
    rpc.mockReset();
    from.mockReset();
    itemSingle.mockReset();
    insumoInsert.mockReset();
    insumoInsertSingle.mockReset();
    insumoCategorySingle.mockReset();
    registrarEvento.mockReset();

    configureSupabase();
    itemSingle.mockResolvedValue({ data: itemRecebimento(), error: null });
    insumoInsertSingle.mockResolvedValue({ data: { id: 77 }, error: null });
    insumoCategorySingle.mockResolvedValue({ data: { categoria_compra: "operacional" }, error: null });
    rpc.mockResolvedValue({ error: null });
  });

  it("rejeita recebimento sem insumo_id canonico", async () => {
    const { receberItemPedidoInterno } = await import("./pedidos-internos");
    const result = await receberItemPedidoInterno(
      { ok: false },
      formRecebimento({ novo_insumo: "", insumo_id: "" }),
    );

    expect(result.ok).toBe(false);
    expect(insumoInsert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejeita operacao_id ausente antes da RPC", async () => {
    const { receberItemPedidoInterno } = await import("./pedidos-internos");
    const result = await receberItemPedidoInterno(
      { ok: false },
      formRecebimento({ operacao_id: "" }),
    );

    expect(result).toEqual({
      ok: false,
      message: "Identificador da operação de recebimento inválido.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("nao cria cadastro mestre quando o insumo_id e ambiguo", async () => {
    const { receberItemPedidoInterno } = await import("./pedidos-internos");
    const result = await receberItemPedidoInterno({ ok: false }, formRecebimento());

    expect.soft(result.ok).toBe(false);
    expect.soft(insumoInsert).not.toHaveBeenCalled();
    expect.soft(rpc).not.toHaveBeenCalled();
  });

  it("mantem fluxo com insumo existente operacional", async () => {
    itemSingle.mockResolvedValue({
      data: { ...itemRecebimento(), insumo_id: 88 },
      error: null,
    });
    const { receberItemPedidoInterno } = await import("./pedidos-internos");
    const result = await receberItemPedidoInterno(
      { ok: false },
      formRecebimento({ novo_insumo: "", insumo_id: "88" }),
    );

    expect(result.ok).toBe(true);
    expect(insumoInsert).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("receber_item_pedido_interno", expect.objectContaining({
      p_insumo_id: 88,
    }));
  });

  it("nao registra auditoria fora da RPC de recebimento", async () => {
    itemSingle
      .mockResolvedValueOnce({
        data: { ...itemRecebimento(), insumo_id: 88 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ...itemRecebimento(), insumo_id: 88, quantidade_recebida: 2 },
        error: null,
      });
    const { receberItemPedidoInterno } = await import("./pedidos-internos");

    await receberItemPedidoInterno(
      { ok: false },
      formRecebimento({ novo_insumo: "", insumo_id: "88" }),
    );

    expect(registrarEvento).not.toHaveBeenCalled();
  });

  it("encaminha operacao_id estavel para a RPC de recebimento interno", async () => {
    const operacaoId = "22222222-2222-4222-8222-222222222222";
    itemSingle.mockResolvedValue({
      data: { ...itemRecebimento(), insumo_id: 88 },
      error: null,
    });
    const { receberItemPedidoInterno } = await import("./pedidos-internos");

    await receberItemPedidoInterno(
      { ok: false },
      formRecebimento({ novo_insumo: "", insumo_id: "88", operacao_id: operacaoId }),
    );

    expect(rpc).toHaveBeenCalledWith("receber_item_pedido_interno", expect.objectContaining({
      p_operacao_id: operacaoId,
    }));
  });

  it("reenvia retry com item atualizado usando o mesmo operacao_id", async () => {
    const operacaoId = "22222222-2222-4222-8222-222222222222";
    const itemAtualizado = {
      ...itemRecebimento(),
      insumo_id: 88,
      quantidade_recebida: 2,
      recebido_em: "2026-08-08T12:00:00.000Z",
    };
    itemSingle
      .mockResolvedValueOnce({ data: itemAtualizado, error: null })
      .mockResolvedValueOnce({ data: itemAtualizado, error: null });
    const { receberItemPedidoInterno } = await import("./pedidos-internos");

    const result = await receberItemPedidoInterno(
      { ok: false },
      formRecebimento({ novo_insumo: "", insumo_id: "88", operacao_id: operacaoId }),
    );

    expect(result).toEqual({
      ok: true,
      message: "Item recebido integralmente e lançado em estoque.",
    });
    expect(rpc).toHaveBeenCalledWith("receber_item_pedido_interno", expect.objectContaining({
      p_operacao_id: operacaoId,
    }));
  });

  it("permite recebimento parcial mantendo saldo pendente", async () => {
    itemSingle
      .mockResolvedValueOnce({
        data: { ...itemRecebimento(), quantidade_recebida: 0, insumo_id: 88 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ...itemRecebimento(), quantidade_recebida: 1, insumo_id: 88 },
        error: null,
      });
    const { receberItemPedidoInterno } = await import("./pedidos-internos");
    const result = await receberItemPedidoInterno(
      { ok: false },
      formRecebimento({ novo_insumo: "", insumo_id: "88", quantidade: "1" }),
    );

    expect(result).toEqual({
      ok: true,
      message: "Recebimento parcial registrado. Saldo pendente: 1 frasco.",
    });
    expect(rpc).toHaveBeenCalledWith("receber_item_pedido_interno", expect.objectContaining({
      p_item_id: 5,
      p_quantidade: 1,
    }));
  });

  it("bloqueia recebimento acima do saldo pendente", async () => {
    itemSingle.mockResolvedValue({
      data: { ...itemRecebimento(), quantidade_recebida: 1.5, insumo_id: 88 },
      error: null,
    });
    rpc.mockResolvedValue({
      error: { message: "Quantidade recebida excede o saldo pendente (0.5 frasco)." },
    });
    const { receberItemPedidoInterno } = await import("./pedidos-internos");
    const result = await receberItemPedidoInterno(
      { ok: false },
      formRecebimento({ novo_insumo: "", insumo_id: "88", quantidade: "1" }),
    );

    expect(result).toEqual({
      ok: false,
      message: "Quantidade recebida excede o saldo pendente (0.5 frasco).",
    });
    expect(rpc).toHaveBeenCalledWith("receber_item_pedido_interno", expect.objectContaining({
      p_quantidade: 1,
    }));
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

  it("bloqueia recebimento interno quando o item tem compra formal pendente", async () => {
    itemSingle.mockResolvedValue({
      data: {
        ...itemRecebimento(),
        insumo_id: 88,
        pedidos_internos: {
          status: "aprovado_para_compra",
          projetos: { nome: "Projeto A" },
        },
      },
      error: null,
    });
    rpc.mockResolvedValue({
      error: { message: "Item vinculado a compra formal deve ser recebido pelo pedido de compra." },
    });
    const { receberItemPedidoInterno } = await import("./pedidos-internos");

    const result = await receberItemPedidoInterno(
      { ok: false },
      formRecebimento({ novo_insumo: "", insumo_id: "88" }),
    );

    expect(result).toEqual({
      ok: false,
      // a recusa do banco chega com as palavras do glossário (10.5)
      message: "Item vinculado a compra deve ser recebido pela compra.",
    });
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
