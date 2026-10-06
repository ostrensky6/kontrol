import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
const redirect = vi.fn();
const rpc = vi.fn();
const from = vi.fn();
const itemSingle = vi.fn();
const pedidoSingle = vi.fn();
const itensPedidoEq = vi.fn();
const updatePedido = vi.fn();
const updatePedidoIdEq = vi.fn();
const updatePedidoStatusEq = vi.fn();
const registrarEvento = vi.fn();
const parametroMaybeSingle = vi.fn();

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
vi.mock("@/lib/costing/demanda", () => ({ computarDemandaPlano: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from, rpc })),
  createClientUntyped: vi.fn(async () => ({ from, rpc })),
}));

function formRecebimento(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const base: Record<string, string> = {
    pedido_id: "20",
    item_id: "8",
    operacao_id: "11111111-1111-4111-8111-111111111111",
    quantidade_recebida: "3",
    codigo: "L-001",
  };
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    formData.set(key, value);
  }
  return formData;
}

function configureSupabase() {
  from.mockImplementation((table: string) => {
    if (table === "pedidos_compra_itens") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((column: string) => {
            if (column === "pedido_id") return itensPedidoEq();
            return {
              eq: vi.fn(() => ({
                single: itemSingle,
              })),
            };
          }),
        })),
      };
    }
    if (table === "pedidos_compra") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: pedidoSingle,
          })),
        })),
        update: updatePedido,
      };
    }
    if (table === "parametros") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: parametroMaybeSingle,
          })),
        })),
      };
    }
    return {};
  });
}

describe("recebimento de pedido formal de compra", () => {
  beforeEach(() => {
    revalidatePath.mockReset();
    redirect.mockReset();
    rpc.mockReset();
    from.mockReset();
    itemSingle.mockReset();
    pedidoSingle.mockReset();
    itensPedidoEq.mockReset();
    updatePedido.mockReset();
    updatePedidoIdEq.mockReset();
    updatePedidoStatusEq.mockReset();
    registrarEvento.mockReset();
    parametroMaybeSingle.mockReset();
    parametroMaybeSingle.mockResolvedValue({ data: null, error: null });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T12:00:00.000Z"));

    configureSupabase();
    itemSingle.mockResolvedValue({
      data: { insumo_id: 12, insumos: { categoria_compra: "operacional" } },
      error: null,
    });
    pedidoSingle.mockResolvedValue({ data: { status: "aprovado" }, error: null });
    itensPedidoEq.mockResolvedValue({ data: [], error: null });
    updatePedido.mockReturnValue({ eq: updatePedidoIdEq });
    updatePedidoIdEq.mockReturnValue({ eq: updatePedidoStatusEq });
    updatePedidoStatusEq.mockResolvedValue({ error: null });
    rpc.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bloqueia insumo critico sem validade antes da RPC", async () => {
    itemSingle.mockResolvedValue({
      data: { insumo_id: 12, insumos: { categoria_compra: "critico" } },
      error: null,
    });
    const { receberItemPedido } = await import("./compras");

    await expect(receberItemPedido(formRecebimento())).resolves.toEqual({
      ok: false,
      message: "Validade é obrigatória para receber insumo crítico.",
    });

    expect(rpc).not.toHaveBeenCalled();
  });

  it("devolve mensagem (sem fechar como sucesso) quando falta permissão", async () => {
    const permissoes = await import("@/lib/auth/permissao-efetiva");
    vi.mocked(permissoes.pode).mockResolvedValueOnce(false);
    const { receberItemPedido } = await import("./compras");

    const resultado = await receberItemPedido(formRecebimento({ validade: "2026-12-31" }));

    expect(resultado.ok).toBe(false);
    expect(resultado.message).toMatch(/não tem permissão/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("devolve o erro da RPC como mensagem", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "Pedido não está aprovado." } });
    const { receberItemPedido } = await import("./compras");

    await expect(receberItemPedido(formRecebimento({ validade: "2026-12-31" }))).resolves.toEqual({
      ok: false,
      message: "Pedido não está aprovado.",
    });
  });

  it("rejeita operacao_id ausente antes da RPC", async () => {
    const { receberItemPedido } = await import("./compras");

    await expect(receberItemPedido(formRecebimento({ operacao_id: "" }))).resolves.toEqual({
      ok: false,
      message: "Identificador da operação de recebimento inválido.",
    });

    expect(rpc).not.toHaveBeenCalled();
  });

  it("mantem recebimento formal operacional", async () => {
    const { receberItemPedido } = await import("./compras");

    await expect(receberItemPedido(formRecebimento({ validade: "2026-12-31" }))).resolves.toMatchObject({ ok: true });

    expect(rpc).toHaveBeenCalledWith("receber_item_pedido_compra", expect.objectContaining({
      p_pedido_id: 20,
      p_item_id: 8,
      p_quantidade: 3,
      p_validade: "2026-12-31",
      p_codigo: "L-001",
      p_responsavel: "Coordenador",
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/compras/20");
    expect(revalidatePath).toHaveBeenCalledWith("/estoque");
    expect(revalidatePath).toHaveBeenCalledWith("/recebimento");
  });

  it("encaminha operacao_id estavel para a RPC de recebimento formal", async () => {
    const operacaoId = "11111111-1111-4111-8111-111111111111";
    const { receberItemPedido } = await import("./compras");

    await receberItemPedido(formRecebimento({
      validade: "2026-12-31",
      operacao_id: operacaoId,
    }));

    expect(rpc).toHaveBeenCalledWith("receber_item_pedido_compra", expect.objectContaining({
      p_operacao_id: operacaoId,
    }));
  });

  it("permite encaminhar uma quantidade parcial para a RPC formal", async () => {
    const { receberItemPedido } = await import("./compras");

    await receberItemPedido(formRecebimento({ quantidade_recebida: "1", validade: "2026-12-31" }));

    expect(rpc).toHaveBeenCalledWith("receber_item_pedido_compra", expect.objectContaining({
      p_quantidade: 1,
    }));
  });

  it("aprovarPedido usa lead time do insumo quando presente", async () => {
    pedidoSingle.mockResolvedValue({ data: { fornecedores: { prazo_medio_dias: 20 } }, error: null });
    itensPedidoEq.mockResolvedValue({
      data: [{ insumos: { lead_time_dias: 7, fornecedores: { prazo_medio_dias: 20 } } }],
      error: null,
    });
    const { aprovarPedido } = await import("./compras");
    const formData = new FormData();
    formData.set("pedido_id", "20");

    const result = await aprovarPedido({ ok: false }, formData);

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("transicionar_pedido_compra", expect.objectContaining({
      p_status_destino: "aprovado",
      p_data_prevista_entrega: "2026-07-06",
    }));
    for (const rota of ["/compras/20", "/compras", "/recebimento", "/suprimentos"]) {
      expect(revalidatePath).toHaveBeenCalledWith(rota);
    }
  });

  it("aprovarPedido cai para prazo medio do fornecedor quando insumo nao tem lead time", async () => {
    pedidoSingle.mockResolvedValue({ data: { fornecedores: { prazo_medio_dias: 20 } }, error: null });
    itensPedidoEq.mockResolvedValue({
      data: [{ insumos: { lead_time_dias: 0, fornecedores: { prazo_medio_dias: 12 } } }],
      error: null,
    });
    const { aprovarPedido } = await import("./compras");
    const formData = new FormData();
    formData.set("pedido_id", "20");

    await aprovarPedido({ ok: false }, formData);

    expect(rpc).toHaveBeenCalledWith("transicionar_pedido_compra", expect.objectContaining({
      p_data_prevista_entrega: "2026-07-11",
    }));
  });

  it("aprovarPedido usa maior prazo efetivo entre multiplos itens", async () => {
    pedidoSingle.mockResolvedValue({ data: { fornecedores: { prazo_medio_dias: 5 } }, error: null });
    itensPedidoEq.mockResolvedValue({
      data: [
        { insumos: { lead_time_dias: 4, fornecedores: { prazo_medio_dias: 30 } } },
        { insumos: { lead_time_dias: null, fornecedores: { prazo_medio_dias: 15 } } },
        { insumos: { lead_time_dias: 9, fornecedores: { prazo_medio_dias: 2 } } },
      ],
      error: null,
    });
    const { aprovarPedido } = await import("./compras");
    const formData = new FormData();
    formData.set("pedido_id", "20");

    await aprovarPedido({ ok: false }, formData);

    expect(rpc).toHaveBeenCalledWith("transicionar_pedido_compra", expect.objectContaining({
      p_data_prevista_entrega: "2026-07-14",
    }));
  });

  it("aprovarPedido sem itens usa fallback pelo fornecedor do cabecalho", async () => {
    pedidoSingle.mockResolvedValue({ data: { fornecedores: { prazo_medio_dias: 6 } }, error: null });
    itensPedidoEq.mockResolvedValue({ data: [], error: null });
    const { aprovarPedido } = await import("./compras");
    const formData = new FormData();
    formData.set("pedido_id", "20");

    await aprovarPedido({ ok: false }, formData);

    expect(rpc).toHaveBeenCalledWith("transicionar_pedido_compra", expect.objectContaining({
      p_data_prevista_entrega: "2026-07-05",
    }));
  });

  it("aprovarPedido soma a tramitação na universidade ao prazo do fornecedor (0132)", async () => {
    parametroMaybeSingle.mockResolvedValue({ data: { valor: 90 }, error: null });
    pedidoSingle.mockResolvedValue({ data: { fornecedores: { prazo_medio_dias: 20 } }, error: null });
    itensPedidoEq.mockResolvedValue({
      data: [{ insumos: { lead_time_dias: 7, fornecedores: { prazo_medio_dias: 20 } } }],
      error: null,
    });
    const { aprovarPedido } = await import("./compras");
    const formData = new FormData();
    formData.set("pedido_id", "20");

    await aprovarPedido({ ok: false }, formData);

    // 29/06 + 90 de tramitação + 7 do fornecedor = 04/10
    expect(rpc).toHaveBeenCalledWith("transicionar_pedido_compra", expect.objectContaining({
      p_status_destino: "aprovado",
      p_data_prevista_entrega: "2026-10-04",
    }));
  });

  it("aprovarPedido sem prazo de fornecedor ainda conta a tramitação (0132)", async () => {
    parametroMaybeSingle.mockResolvedValue({ data: { valor: 90 }, error: null });
    pedidoSingle.mockResolvedValue({ data: { fornecedores: null }, error: null });
    itensPedidoEq.mockResolvedValue({ data: [], error: null });
    const { aprovarPedido } = await import("./compras");
    const formData = new FormData();
    formData.set("pedido_id", "20");

    await aprovarPedido({ ok: false }, formData);

    expect(rpc).toHaveBeenCalledWith("transicionar_pedido_compra", expect.objectContaining({
      p_data_prevista_entrega: "2026-09-27",
    }));
  });

  it("marcarEnviado recalcula a previsão como envio + prazo do fornecedor, sem tramitação (0132)", async () => {
    parametroMaybeSingle.mockResolvedValue({ data: { valor: 90 }, error: null });
    pedidoSingle.mockResolvedValue({ data: { fornecedores: { prazo_medio_dias: 20 } }, error: null });
    itensPedidoEq.mockResolvedValue({
      data: [{ insumos: { lead_time_dias: 0, fornecedores: { prazo_medio_dias: 12 } } }],
      error: null,
    });
    const { marcarEnviado } = await import("./compras");
    const formData = new FormData();
    formData.set("pedido_id", "20");

    const result = await marcarEnviado({ ok: false }, formData);

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("transicionar_pedido_compra", expect.objectContaining({
      p_status_destino: "enviado",
      p_data_prevista_entrega: "2026-07-11",
    }));
  });

  it("marcarEnviado sem prazo cadastrado mantém a data da aprovação (0132)", async () => {
    pedidoSingle.mockResolvedValue({ data: { fornecedores: null }, error: null });
    itensPedidoEq.mockResolvedValue({ data: [], error: null });
    const { marcarEnviado } = await import("./compras");
    const formData = new FormData();
    formData.set("pedido_id", "20");

    await marcarEnviado({ ok: false }, formData);

    expect(rpc).toHaveBeenCalledWith("transicionar_pedido_compra", expect.objectContaining({
      p_status_destino: "enviado",
      p_data_prevista_entrega: undefined,
    }));
  });

  it("encerrarPedidoComPendencia exige destino e motivo antes de chamar o banco (0130)", async () => {
    const { encerrarPedidoComPendencia } = await import("./compras");
    const semDestino = new FormData();
    semDestino.set("pedido_id", "20");
    semDestino.set("motivo", "fornecedor sem estoque");
    expect(await encerrarPedidoComPendencia({ ok: false }, semDestino)).toEqual({
      ok: false,
      message: "Escolha o destino do que faltou.",
    });
    const semMotivo = new FormData();
    semMotivo.set("pedido_id", "20");
    semMotivo.set("destino", "desistencia");
    semMotivo.set("motivo", " x ");
    expect((await encerrarPedidoComPendencia({ ok: false }, semMotivo)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("encerrarPedidoComPendencia com nova compra informa o número criado", async () => {
    rpc.mockResolvedValue({ data: { pedido_compra_id: 20, destino: "nova_compra", nova_compra_id: 31 }, error: null });
    const { encerrarPedidoComPendencia } = await import("./compras");
    const formData = new FormData();
    formData.set("pedido_id", "20");
    formData.set("destino", "nova_compra");
    formData.set("motivo", "fornecedor entrega o resto no mês que vem");

    const result = await encerrarPedidoComPendencia({ ok: false }, formData);

    expect(rpc).toHaveBeenCalledWith("encerrar_compra_com_pendencia", {
      p_pedido_id: 20,
      p_destino: "nova_compra",
      p_motivo: "fornecedor entrega o resto no mês que vem",
    });
    expect(result).toEqual({
      ok: true,
      message: "Compra encerrada. O que faltou virou a compra #31, que aguarda aprovação.",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/compras/31");
  });

  it("comprarFaltasDoPlano ajusta quantidade pela compra minima", async () => {
    const { computarDemandaPlano } = await import("@/lib/costing/demanda");
    vi.mocked(computarDemandaPlano).mockResolvedValue([
      {
        insumo_id: 10,
        especificacao: "Solvente",
        unidade: "L",
        demanda: 0.2,
        disponivel: 0,
        falta: 0.2,
        custoUnitario: 50,
        custoEstimado: 10,
        quantidadeMinimaCompra: 1,
        quantidadeEmbalagem: null,
        quantidadeCompra: 1,
        valorCompraEstimado: 50,
      },
    ]);
    from.mockImplementation((table: string) => {
      if (table === "insumos") {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [{ id: 10, ativo: true, custo_unitario: 55, fornecedores: { nome: "Fornecedor A" } }],
              error: null,
            }),
          })),
        };
      }
      return {};
    });
    rpc.mockResolvedValue({ data: { pedido_id: 77, itens: 1 }, error: null });
    const { comprarFaltasDoPlano } = await import("./compras");
    const formData = new FormData();
    formData.set("planejamento_id", "5");

    await comprarFaltasDoPlano({ ok: false }, formData);

    // Uma única RPC transacional (sem INSERT solto) que desconta o já pedido.
    expect(rpc).toHaveBeenCalledWith("criar_pedido_faltas_planejamento", {
      p_planejamento_id: 5,
      p_itens: [
        expect.objectContaining({
          insumo_id: 10,
          quantidade: 1,
          unidade: "L",
          orcamento_previo: 50,
          fornecedor_sugerido: "Fornecedor A",
          observacao: expect.stringContaining("compra de 1 L"),
        }),
      ],
    });
    expect(redirect).toHaveBeenCalledWith("/pedido/77");
  });

  it("comprarFaltasDoPlano devolve a recusa do banco sem lançar", async () => {
    const { computarDemandaPlano } = await import("@/lib/costing/demanda");
    vi.mocked(computarDemandaPlano).mockResolvedValue([
      {
        insumo_id: 10,
        especificacao: "Solvente",
        unidade: "L",
        demanda: 1,
        disponivel: 0,
        falta: 1,
        custoUnitario: 50,
        custoEstimado: 50,
        quantidadeMinimaCompra: null,
        quantidadeEmbalagem: null,
        quantidadeCompra: 1,
        valorCompraEstimado: 50,
      },
    ]);
    from.mockImplementation(() => ({
      select: vi.fn(() => ({
        in: vi.fn().mockResolvedValue({
          data: [{ id: 10, ativo: true, custo_unitario: 50, fornecedores: null }],
          error: null,
        }),
      })),
    }));
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "As faltas deste planejamento já estão em pedido interno aberto (#77). Acompanhe por lá." },
    });
    const { comprarFaltasDoPlano } = await import("./compras");
    const formData = new FormData();
    formData.set("planejamento_id", "5");

    await expect(comprarFaltasDoPlano({ ok: false }, formData)).resolves.toEqual({
      ok: false,
      message: "As faltas deste planejamento já estão em pedido interno aberto (#77). Acompanhe por lá.",
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("comprarFaltasDoPlano recusa insumo inativo antes da RPC", async () => {
    const { computarDemandaPlano } = await import("@/lib/costing/demanda");
    vi.mocked(computarDemandaPlano).mockResolvedValue([
      {
        insumo_id: 10,
        especificacao: "Solvente",
        unidade: "L",
        demanda: 1,
        disponivel: 0,
        falta: 1,
        custoUnitario: 50,
        custoEstimado: 50,
        quantidadeMinimaCompra: null,
        quantidadeEmbalagem: null,
        quantidadeCompra: 1,
        valorCompraEstimado: 50,
      },
    ]);
    from.mockImplementation((table: string) => {
      if (table === "insumos") {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [{ id: 10, ativo: false, custo_unitario: 50, fornecedores: null }],
              error: null,
            }),
          })),
        };
      }
      return {};
    });
    const { comprarFaltasDoPlano } = await import("./compras");
    const formData = new FormData();
    formData.set("planejamento_id", "5");

    await expect(comprarFaltasDoPlano({ ok: false }, formData)).resolves.toEqual({
      ok: false,
      message: "Insumo inativo. Reative o cadastro para iniciar uma nova operação.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("adicionarItemPedido falha fechado quando não comprova insumo ativo", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    from.mockImplementation((table: string) => {
      if (table === "insumos") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "consulta indisponível" },
              }),
            })),
          })),
        };
      }
      if (table === "pedidos_compra_itens") return { insert };
      return {};
    });
    const { adicionarItemPedido } = await import("./compras");
    const formData = new FormData();
    formData.set("pedido_id", "20");
    formData.set("insumo_id", "10");
    formData.set("quantidade", "1");

    await expect(adicionarItemPedido({ ok: false }, formData)).resolves.toEqual({
      ok: false,
      message: "Insumo inativo. Reative o cadastro para iniciar uma nova operação.",
    });
    expect(insert).not.toHaveBeenCalled();
  });
});
