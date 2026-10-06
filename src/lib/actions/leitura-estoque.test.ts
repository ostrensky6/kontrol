import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const maybeSingle = vi.fn();
const revalidatePath = vi.fn();
const conflitosCodigos = vi.fn();
const sincronizarCodigosInsumo = vi.fn();

const from = vi.fn((table: string) => {
  if (table === "insumos") {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle })),
      })),
    };
  }
  throw new Error(`Consulta inesperada em ${table}`);
});

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/permissao-efetiva", () => ({ pode: vi.fn(async () => true) }));
vi.mock("@/lib/auth/roles", () => ({
  usuarioAtual: vi.fn(async () => ({ id: "1", email: "coord@example.com" })),
}));
vi.mock("@/lib/scanner/vinculos-codigo", () => ({
  buscarIdentificadorAtivo: vi.fn(),
  conflitosCodigos,
  mensagemConflitos: vi.fn(() => "Conflito"),
  sincronizarCodigosInsumo,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClientUntyped: vi.fn(async () => ({ from, rpc })),
}));

const INATIVO = "Insumo inativo. Reative o cadastro para iniciar uma nova operação.";
const OPERACAO = "33333333-3333-4333-8333-333333333333";

describe("operações de estoque por leitura para insumo inativo", () => {
  beforeEach(() => {
    rpc.mockReset();
    maybeSingle.mockReset();
    maybeSingle.mockResolvedValue({ data: { ativo: false }, error: null });
    revalidatePath.mockReset();
    conflitosCodigos.mockReset();
    sincronizarCodigosInsumo.mockReset();
    from.mockClear();
  });

  it("recusa novo vínculo de código", async () => {
    const { vincularCodigoLeitura } = await import("./leitura-estoque");

    const result = await vincularCodigoLeitura({ codigo: "7891234567895", insumoId: 7 });

    expect(result).toEqual({ ok: false, message: INATIVO });
    expect(conflitosCodigos).not.toHaveBeenCalled();
    expect(sincronizarCodigosInsumo).not.toHaveBeenCalled();
  });

  it("recusa entrada avulsa", async () => {
    const { registrarEntradaLeitura } = await import("./leitura-estoque");

    const result = await registrarEntradaLeitura({
      codigo: "7891234567895",
      insumoId: 7,
      quantidade: 2,
      validade: null,
      localId: null,
      pedido: null,
      operacaoId: OPERACAO,
    });

    expect(result).toEqual({ ok: false, message: INATIVO });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("não inicia entrada avulsa sem comprovar que o insumo está ativo", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "consulta indisponível" } });
    const { registrarEntradaLeitura } = await import("./leitura-estoque");

    const result = await registrarEntradaLeitura({
      codigo: "7891234567895",
      insumoId: 7,
      quantidade: 2,
      validade: null,
      localId: null,
      pedido: null,
      operacaoId: OPERACAO,
    });

    expect(result).toEqual({ ok: false, message: INATIVO });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("preserva recebimento de pedido preexistente", async () => {
    rpc.mockResolvedValue({
      data: {
        insumo_id: 7,
        especificacao: "Insumo legado",
        codigo_lote: "PED-7",
        validade: null,
        quantidade_embalagens: 2,
        fechadas: 2,
        pedido_id: 19,
      },
      error: null,
    });
    const { registrarEntradaLeitura } = await import("./leitura-estoque");

    const result = await registrarEntradaLeitura({
      codigo: "7891234567895",
      insumoId: 7,
      quantidade: 2,
      validade: null,
      localId: null,
      pedido: { pedidoId: 19, itemId: 4 },
      operacaoId: OPERACAO,
    });

    expect(result.ok).toBe(true);
    expect(from).not.toHaveBeenCalledWith("insumos");
    expect(rpc).toHaveBeenCalledWith("registrar_recebimento_por_leitura", expect.objectContaining({
      p_insumo_id: 7,
      p_pedido_id: 19,
      p_item_id: 4,
    }));
  });

  it("recusa abertura de embalagem", async () => {
    const { registrarSaidaLeitura } = await import("./leitura-estoque");

    const result = await registrarSaidaLeitura({
      codigo: "7891234567895",
      insumoId: 7,
      operacaoId: OPERACAO,
    });

    expect(result).toEqual({ ok: false, message: INATIVO });
    expect(rpc).not.toHaveBeenCalled();
  });
});
