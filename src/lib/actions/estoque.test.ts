import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const single = vi.fn();
const revalidatePath = vi.fn();
let origemLote: Record<string, { data: Array<{ id: number }>; error: { message: string } | null }>;
let loteConsultado: { data: Record<string, unknown> | null; error: { message: string } | null };
const from = vi.fn((table: string) => {
  if (table === "lotes_estoque") {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: vi.fn(async () => loteConsultado) })),
      })),
    };
  }
  if (table === "insumos") {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single })),
      })),
    };
  }
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        limit: vi.fn(async () => origemLote[table]),
      })),
    })),
  };
});

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/roles", () => ({
  usuarioAtual: vi.fn(async () => ({ nome: "Coordenador", email: "coord@example.com" })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc,
    from,
  })),
}));

describe("actions de estoque", () => {
  beforeEach(() => {
    rpc.mockReset();
    single.mockReset();
    single.mockResolvedValue({ data: { categoria_compra: "operacional" }, error: null });
    from.mockClear();
    origemLote = {
      pedidos_compra_item_recebimentos: { data: [], error: null },
      pedidos_internos_item_recebimentos: { data: [], error: null },
    };
    revalidatePath.mockReset();
  });

  it("valida entrada de inventário antes de chamar a RPC", async () => {
    const { entradaInventario } = await import("./estoque");
    const formData = new FormData();
    formData.set("insumo_id", "1");
    formData.set("quantidade", "0");

    const result = await entradaInventario({ ok: false }, formData);

    expect(result.ok).toBe(false);
    expect(result.errors?.quantidade).toBe("Deve ser > 0");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("exige validade para entrada de inventário de insumo crítico", async () => {
    single.mockResolvedValue({ data: { categoria_compra: "critico" }, error: null });
    const { entradaInventario } = await import("./estoque");
    const formData = new FormData();
    formData.set("insumo_id", "7");
    formData.set("quantidade", "12.5");

    const result = await entradaInventario({ ok: false }, formData);

    expect(result.ok).toBe(false);
    expect(result.errors?.validade).toBe("Obrigatório para crítico");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("registra entrada de inventário por RPC e revalida a tela de estoque", async () => {
    rpc.mockResolvedValue({ error: null });
    const { entradaInventario } = await import("./estoque");
    const formData = new FormData();
    formData.set("insumo_id", "7");
    formData.set("quantidade", "12.5");
    formData.set("validade", "2026-12-31");
    formData.set("custo", "3.25");
    formData.set("codigo", "L-123");
    formData.set("fornecedor", "Fornecedor A");
    formData.set("motivo", "contagem cíclica");

    const result = await entradaInventario({ ok: false }, formData);

    expect(result).toEqual({
      ok: true,
      message: "Entrada de inventário registrada (lote em quarentena).",
    });
    // 0127: idempotente por operacao_id (gerado se o formulário não mandar).
    expect(rpc).toHaveBeenCalledWith("entrada_inventario", {
      p_insumo_id: 7,
      p_quantidade: 12.5,
      p_operacao_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      p_validade: "2026-12-31",
      p_custo: 3.25,
      p_codigo: "L-123",
      p_fornecedor: "Fornecedor A",
      p_motivo: "contagem cíclica",
      p_local_id: undefined,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/estoque");
  });

  it("mantem transicoes de lote restritas a RPCs nomeadas", async () => {
    rpc.mockResolvedValue({ error: null });
    const { aceitarLote, bloquearLote, desbloquearLote, descartarLote } = await import("./estoque");
    const base = new FormData();
    base.set("lote_id", "9");

    await aceitarLote(base);
    const bloquear = new FormData();
    bloquear.set("lote_id", "9");
    bloquear.set("motivo", "Investigacao");
    await bloquearLote(bloquear);
    await desbloquearLote(base);
    const descartar = new FormData();
    descartar.set("lote_id", "9");
    descartar.set("justificativa", "Vencido");
    await descartarLote(descartar);

    expect(rpc.mock.calls.map(([fn]) => fn)).toEqual([
      "aceitar_lote",
      "bloquear_lote",
      "desbloquear_lote",
      "descartar_lote",
    ]);
    expect(rpc).toHaveBeenNthCalledWith(1, "aceitar_lote", {
      p_lote_id: 9,
      p_responsavel: "Coordenador",
      p_criterio: null,
    });
  });

  it("registra baixa manual e ajuste de saldo por RPCs transacionais", async () => {
    rpc.mockResolvedValue({ error: null });
    const { baixarManualLote, ajustarSaldoLote } = await import("./estoque");
    const baixa = new FormData();
    baixa.set("lote_id", "9");
    baixa.set("quantidade", "2.5");
    baixa.set("motivo", "consumo extra");
    const ajuste = new FormData();
    ajuste.set("lote_id", "9");
    ajuste.set("quantidade_nova", "8");
    ajuste.set("motivo", "contagem cíclica");

    await baixarManualLote({ ok: false }, baixa);
    await ajustarSaldoLote({ ok: false }, ajuste);

    expect(rpc).toHaveBeenNthCalledWith(1, "baixa_manual_lote", {
      p_lote_id: 9,
      p_quantidade: 2.5,
      p_motivo: "consumo extra",
      p_operacao_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "ajustar_saldo_lote", {
      p_lote_id: 9,
      p_quantidade_nova: 8,
      p_motivo: "contagem cíclica",
    });
  });

  it("estorna uma entrada pela RPC auditavel e revalida o estoque", async () => {
    rpc.mockResolvedValue({ error: null });
    const { estornarRecebimentoLote } = await import("./estoque");
    const formData = new FormData();
    formData.set("lote_id", "9");
    formData.set("motivo", "quantidade digitada incorretamente");

    const result = await estornarRecebimentoLote({ ok: false }, formData);

    expect(result).toEqual({ ok: true, message: "Entrada estornada." });
    expect(rpc).toHaveBeenCalledWith("estornar_recebimento_lote", {
      p_lote_id: 9,
      p_motivo: "quantidade digitada incorretamente",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("pedidos_compra_item_recebimentos");
    expect(from).toHaveBeenCalledWith("pedidos_internos_item_recebimentos");
    expect(revalidatePath).toHaveBeenCalledWith("/estoque");
    expect(revalidatePath).toHaveBeenCalledWith("/estoque/lotes/9");
  });

  it.each([
    "pedidos_compra_item_recebimentos",
    "pedidos_internos_item_recebimentos",
  ])("lote vinculado em %s usa o estorno bilateral (EST-2)", async (table) => {
    rpc.mockResolvedValue({ data: { pedido_compra_id: 5, repetido: false }, error: null });
    origemLote[table] = { data: [{ id: 41 }], error: null };
    const { estornarRecebimentoLote } = await import("./estoque");
    const formData = new FormData();
    formData.set("lote_id", "9");
    formData.set("motivo", "quantidade digitada incorretamente");

    const result = await estornarRecebimentoLote({ ok: false }, formData);

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("estornar_recebimento_do_lote", {
      p_lote_id: 9,
      p_motivo: "quantidade digitada incorretamente",
    });
    expect(rpc).not.toHaveBeenCalledWith("estornar_recebimento_lote", expect.anything());
  });

  it("estorno repetido de lote vinculado não chama a primitiva e informa que já estava estornado", async () => {
    rpc.mockResolvedValue({ data: { pedido_interno_id: 3, repetido: true }, error: null });
    origemLote.pedidos_internos_item_recebimentos = { data: [{ id: 42 }], error: null };
    const { estornarRecebimentoLote } = await import("./estoque");
    const formData = new FormData();
    formData.set("lote_id", "9");
    formData.set("motivo", "quantidade digitada incorretamente");

    const resultado = await estornarRecebimentoLote({ ok: false }, formData);

    expect(resultado).toEqual({ ok: true, message: "Este recebimento já estava estornado." });
    expect(rpc).not.toHaveBeenCalledWith("estornar_recebimento_lote", expect.anything());
  });

  it("nao inicia estorno sem motivo auditavel", async () => {
    const { estornarRecebimentoLote } = await import("./estoque");
    const formData = new FormData();
    formData.set("lote_id", "9");

    const result = await estornarRecebimentoLote({ ok: false }, formData);

    expect(result.ok).toBe(false);
    expect(result.errors?.motivo).toBe("Obrigatório");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("nao mascara a negativa de autorizacao ao estornar", async () => {
    rpc.mockResolvedValue({ error: { message: "Acesso negado." } });
    const { estornarRecebimentoLote } = await import("./estoque");
    const formData = new FormData();
    formData.set("lote_id", "9");
    formData.set("motivo", "quantidade digitada incorretamente");

    const result = await estornarRecebimentoLote({ ok: false }, formData);

    expect(result).toEqual({ ok: false, message: "Acesso negado." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  describe("corrigirQuantidadeEmbalagens", () => {
    it("exige motivo e quantidade alvo inteira antes de chamar a RPC", async () => {
      const { corrigirQuantidadeEmbalagens } = await import("./estoque");
      const formData = new FormData();
      formData.set("insumo_id", "5");
      formData.set("quantidade_alvo", "2.5");

      const result = await corrigirQuantidadeEmbalagens({ ok: false }, formData);

      expect(result.ok).toBe(false);
      expect(result.errors?.quantidade_alvo).toBe("Use um número inteiro de embalagens");
      expect(result.errors?.motivo).toBe("Obrigatório");
      expect(rpc).not.toHaveBeenCalled();
    });

    it("envia a correcao pela RPC transacional com operacao_id gerado", async () => {
      rpc.mockResolvedValue({ error: null });
      const { corrigirQuantidadeEmbalagens } = await import("./estoque");
      const formData = new FormData();
      formData.set("insumo_id", "5");
      formData.set("quantidade_alvo", "2");
      formData.set("motivo", "contagem física divergente");

      const result = await corrigirQuantidadeEmbalagens({ ok: false }, formData);

      expect(result).toEqual({ ok: true, message: "Quantidade corrigida." });
      expect(rpc).toHaveBeenCalledOnce();
      const [fn, args] = rpc.mock.calls[0];
      expect(fn).toBe("corrigir_quantidade_embalagens_fechadas");
      expect(args).toMatchObject({
        p_insumo_id: 5,
        p_quantidade_alvo: 2,
        p_motivo: "contagem física divergente",
      });
      expect(typeof args.p_operacao_id).toBe("string");
      expect(revalidatePath).toHaveBeenCalledWith("/estoque");
      expect(revalidatePath).toHaveBeenCalledWith("/cadastros/insumos");
    });

    it("reutiliza o operacao_id enviado (reenvio idempotente sem duplicar)", async () => {
      rpc.mockResolvedValue({ error: null });
      const { corrigirQuantidadeEmbalagens } = await import("./estoque");
      const formData = new FormData();
      formData.set("insumo_id", "5");
      formData.set("quantidade_alvo", "2");
      formData.set("motivo", "contagem física divergente");
      formData.set("operacao_id", "22222222-2222-2222-2222-222222222222");

      await corrigirQuantidadeEmbalagens({ ok: false }, formData);

      expect(rpc).toHaveBeenCalledWith(
        "corrigir_quantidade_embalagens_fechadas",
        expect.objectContaining({ p_operacao_id: "22222222-2222-2222-2222-222222222222" }),
      );
    });

    it("propaga a negativa de autorizacao (papel insuficiente) sem revalidar", async () => {
      rpc.mockResolvedValue({ error: { message: "Sem permissão: requer papel coordenador ou superior." } });
      const { corrigirQuantidadeEmbalagens } = await import("./estoque");
      const formData = new FormData();
      formData.set("insumo_id", "5");
      formData.set("quantidade_alvo", "2");
      formData.set("motivo", "contagem física divergente");

      const result = await corrigirQuantidadeEmbalagens({ ok: false }, formData);

      expect(result).toEqual({
        ok: false,
        message: "Sem permissão: requer papel coordenador ou superior.",
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("dar baixa (roteada pelo modelo do lote)", () => {
    const OPERACAO = "33333333-3333-4333-8333-333333333333";

    function formBaixa(overrides: Record<string, string> = {}) {
      const formData = new FormData();
      const base: Record<string, string> = {
        lote_id: "12",
        quantidade: "2",
        quantidade_esperada: "5",
        motivo_tipo: "Perda/quebra",
        motivo_detalhe: "frasco trincado",
        operacao_id: OPERACAO,
      };
      for (const [key, value] of Object.entries({ ...base, ...overrides })) formData.set(key, value);
      return formData;
    }

    beforeEach(() => {
      loteConsultado = { data: { id: 12, modelo_quantidade: "EMBALAGEM_FECHADA" }, error: null };
      rpc.mockResolvedValue({ data: { lote_id: 12, quantidade_embalagens: 3, repetido: false }, error: null });
    });

    it("exige motivo (e detalhe quando Outro) antes de chamar qualquer RPC", async () => {
      const { darBaixaLote } = await import("./estoque");

      const semMotivo = await darBaixaLote({ ok: false }, formBaixa({ motivo_tipo: "" }));
      expect(semMotivo.ok).toBe(false);
      expect(semMotivo.errors?.motivo_tipo).toBe("Selecione o motivo");

      const outroSemDetalhe = await darBaixaLote({ ok: false }, formBaixa({ motivo_tipo: "Outro", motivo_detalhe: "" }));
      expect(outroSemDetalhe.errors?.motivo_detalhe).toBe("Descreva o motivo");

      const zero = await darBaixaLote({ ok: false }, formBaixa({ quantidade: "0" }));
      expect(zero.errors?.quantidade).toBe("Deve ser maior que zero");

      expect(rpc).not.toHaveBeenCalled();
    });

    it("lote de embalagens fechadas usa baixa_manual_embalagens com operacao_id e quantidade esperada", async () => {
      const { darBaixaLote } = await import("./estoque");

      const result = await darBaixaLote({ ok: false }, formBaixa());

      expect(result).toEqual({ ok: true, message: "Baixa registrada: 2 embalagens." });
      expect(rpc).toHaveBeenCalledOnce();
      expect(rpc).toHaveBeenCalledWith("baixa_manual_embalagens", {
        p_lote_id: 12,
        p_quantidade: 2,
        p_quantidade_esperada: 5,
        p_operacao_id: OPERACAO,
        p_motivo: "Perda/quebra: frasco trincado",
      });
      expect(revalidatePath).toHaveBeenCalledWith("/estoque/lotes/12");
    });

    it("recusa fração de embalagem sem chamar a RPC", async () => {
      const { darBaixaLote } = await import("./estoque");

      const result = await darBaixaLote({ ok: false }, formBaixa({ quantidade: "1.5" }));

      expect(result.ok).toBe(false);
      expect(result.errors?.quantidade).toBe("Use um número inteiro de embalagens");
      expect(rpc).not.toHaveBeenCalled();
    });

    it("lote legado continua na baixa_manual_lote (quantidade fracionada na unidade do insumo)", async () => {
      loteConsultado = { data: { id: 12, modelo_quantidade: "LEGADO" }, error: null };
      rpc.mockResolvedValue({ data: null, error: null });
      const { darBaixaLote } = await import("./estoque");

      const result = await darBaixaLote(
        { ok: false },
        formBaixa({ quantidade: "2,5", motivo_tipo: "Consumo em análise", motivo_detalhe: "" }),
      );

      expect(result).toEqual({ ok: true, message: "Baixa registrada." });
      expect(rpc).toHaveBeenCalledWith("baixa_manual_lote", {
        p_lote_id: 12,
        p_quantidade: 2.5,
        p_motivo: "Consumo em análise",
        p_operacao_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
    });

    it("devolve a mensagem da RPC sem lançar e sem revalidar", async () => {
      rpc.mockResolvedValue({ data: null, error: { message: "Há reserva ativa neste lote: é possível baixar no máximo 1 embalagem(ns)." } });
      const { darBaixaLote } = await import("./estoque");

      const result = await darBaixaLote({ ok: false }, formBaixa());

      expect(result).toEqual({
        ok: false,
        message: "Há reserva ativa neste lote: é possível baixar no máximo 1 embalagem(ns).",
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it("nunca lança para a UI, mesmo com falha inesperada do cliente", async () => {
      rpc.mockRejectedValue(new Error("rede indisponível"));
      const { baixarEmbalagens, darBaixaLote } = await import("./estoque");

      await expect(darBaixaLote({ ok: false }, formBaixa())).resolves.toEqual({
        ok: false,
        message: "rede indisponível",
      });
      await expect(baixarEmbalagens({ ok: false }, formBaixa())).resolves.toEqual({
        ok: false,
        message: "rede indisponível",
      });
    });

    it("lote inexistente devolve mensagem clara", async () => {
      loteConsultado = { data: null, error: { message: "not found" } };
      const { darBaixaLote } = await import("./estoque");

      const result = await darBaixaLote({ ok: false }, formBaixa());

      expect(result).toEqual({ ok: false, message: "Lote não encontrado." });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("baixarEmbalagens gera operacao_id quando o formulário não envia um UUID válido", async () => {
      const { baixarEmbalagens } = await import("./estoque");

      await baixarEmbalagens({ ok: false }, formBaixa({ operacao_id: "nao-e-uuid" }));

      const [, args] = rpc.mock.calls[0];
      expect(args.p_operacao_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(args.p_operacao_id).not.toBe("nao-e-uuid");
    });
  });
});
