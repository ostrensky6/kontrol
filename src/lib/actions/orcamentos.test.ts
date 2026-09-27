import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Breakdown } from "@/lib/costing/engine";

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const revalidatePath = vi.fn();
const from = vi.fn();
const rpc = vi.fn();
const insert = vi.fn();
const select = vi.fn();
const single = vi.fn();
const eq = vi.fn();
const deleteRow = vi.fn();
const update = vi.fn();
const registrarEvento = vi.fn();
const exigirPapelOrcamento = vi.fn();
const calcularTodas = vi.fn(async (): Promise<{ breakdowns: Breakdown[] }> => ({ breakdowns: [] }));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/costing/loader", () => ({
  calcularTodas,
}));
vi.mock("./eventos", () => ({ registrarEvento }));
vi.mock("@/lib/orcamento/governanca", () => ({ exigirPapelOrcamento }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from,
    rpc,
  })),
}));

describe("actions de orcamentos", () => {
  beforeEach(() => {
    redirect.mockClear();
    revalidatePath.mockClear();
    from.mockReset();
    rpc.mockReset();
    rpc.mockResolvedValue({ error: null });
    insert.mockClear();
    select.mockClear();
    single.mockClear();
    eq.mockReset();
    deleteRow.mockReset();
    update.mockReset();
    registrarEvento.mockReset();
    exigirPapelOrcamento.mockReset();
    calcularTodas.mockReset();
    calcularTodas.mockResolvedValue({ breakdowns: [] });
    from.mockReturnValue({ insert, select, delete: deleteRow, update });
    insert.mockReturnValue({ select });
    select.mockReturnValue({ single, eq });
    eq.mockReturnValue({ single });
    deleteRow.mockReturnValue({ eq });
    update.mockReturnValue({ eq });
    single.mockResolvedValue({ data: { id: 42 }, error: null });
  });

  it("bloqueia exclusao de orcamento enviado", async () => {
    const { excluirOrcamento } = await import("./orcamentos");
    const formData = new FormData();
    formData.set("orcamento_id", "42");
    single.mockResolvedValue({ data: { status: "enviado" }, error: null });

    await expect(excluirOrcamento(formData)).rejects.toThrow("NEXT_REDIRECT:/orcamento/42?erro_exclusao=");

    expect(exigirPapelOrcamento).toHaveBeenCalledWith("cancelar_documento");
    expect(deleteRow).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(expect.stringContaining("/orcamento/42?erro_exclusao="));
  });

  it("permite exclusao de orcamento em rascunho", async () => {
    const { excluirOrcamento } = await import("./orcamentos");
    const formData = new FormData();
    formData.set("orcamento_id", "42");
    single.mockResolvedValue({ data: { status: "rascunho" }, error: null });

    await expect(excluirOrcamento(formData)).rejects.toThrow("NEXT_REDIRECT:/orcamento");

    expect(exigirPapelOrcamento).toHaveBeenCalledWith("cancelar_documento");
    expect(deleteRow).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith("id", 42);
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento");
    expect(redirect).toHaveBeenCalledWith("/orcamento");
  });

  it("não anuncia sucesso quando a exclusão falha no banco", async () => {
    const { excluirOrcamento } = await import("./orcamentos");
    const formData = new FormData();
    formData.set("orcamento_id", "42");
    single.mockResolvedValue({ data: { status: "rascunho" }, error: null });
    deleteRow.mockReturnValue({ eq: vi.fn(async () => ({ error: { message: "violação de chave" } })) });

    await expect(excluirOrcamento(formData)).rejects.toThrow("NEXT_REDIRECT:/orcamento/42?erro_exclusao=");
    expect(revalidatePath).not.toHaveBeenCalledWith("/orcamento");
  });

  it("remove análise pela RPC e devolve a recusa do banco sem lançar", async () => {
    from.mockImplementation((table: string) => {
      if (table === "orcamentos") {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { status: "rascunho", status_operacional: "preenchido", fonte_custo_insumos: "custo_padrao" }, error: null }) }) }) };
      }
      if (table === "orcamento_itens") {
        return { select: () => ({ eq: async () => ({ data: [{ codigo_analise: "A1", n_amostras: 2, custo_unitario: 1, preco_unitario: 1, valor_snapshot: {} }], error: null }) }) };
      }
      throw new Error(`Tabela inesperada no teste: ${table}`);
    });
    rpc.mockResolvedValueOnce({ error: { code: "42501", message: "Sem permissão para esta ação (orcamentos.criar_editar). Peça ao administrador para liberar em Usuários." } });
    const { salvarItemOrcamento } = await import("./orcamentos");
    const formData = new FormData();
    formData.set("orcamento_id", "42");
    formData.set("codigo_analise", "A1");
    formData.set("acao", "remover");

    const estado = await salvarItemOrcamento({ ok: false }, formData);

    expect(estado.ok).toBe(false);
    expect(estado.message).toMatch(/Sem permissão/);
    expect(rpc).toHaveBeenCalledWith("salvar_item_orcamento", expect.objectContaining({
      p_orcamento_id: 42,
      p_codigo_analise: "A1",
      p_n_amostras: 0,
    }));
  });

  it("não chama o banco para módulo revisado", async () => {
    from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { status: "enviado", status_operacional: "revisado" }, error: null }) }) }),
    }));
    const { salvarItemOrcamento } = await import("./orcamentos");
    const formData = new FormData();
    formData.set("orcamento_id", "42");
    formData.set("codigo_analise", "A1");
    formData.set("n_amostras", "3");

    const estado = await salvarItemOrcamento({ ok: false }, formData);
    expect(estado.ok).toBe(false);
    expect(estado.message).toMatch(/travadas/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("cancela orcamento com o motivo digitado, preservando historico", async () => {
    const { cancelarOrcamento } = await import("./orcamentos");
    const formData = new FormData();
    formData.set("orcamento_id", "42");
    formData.set("motivo", "Cliente pediu cancelamento");
    single.mockResolvedValue({ data: { status: "aprovado" }, error: null });
    const estado = await cancelarOrcamento({ ok: false }, formData);

    expect(estado.ok).toBe(true);
    expect(exigirPapelOrcamento).toHaveBeenCalledWith("cancelar_documento");
    expect(rpc).toHaveBeenCalledWith("transicionar_orcamento", expect.objectContaining({
      p_orcamento_id: 42,
      p_status_destino: "cancelado",
      p_observacao: "Cliente pediu cancelamento",
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento/42");
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento");
  });

  it("não cancela sem motivo", async () => {
    const { cancelarOrcamento } = await import("./orcamentos");
    const formData = new FormData();
    formData.set("orcamento_id", "42");
    const estado = await cancelarOrcamento({ ok: false }, formData);
    expect(estado).toEqual({ ok: false, message: "Informe o motivo do cancelamento." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("inclui análise gravando item e custo congelado na mesma RPC (ORC2-1)", async () => {
    const provenienciaDimensional = {
      insumo_id: 9,
      unidade_estoque: "frasco",
      unidade_consumo: "reacao",
      fator_conversao: 100,
      quantidade_consumo: 20,
      quantidade_estoque: 0.2,
      fonte_custo: "custo_medio_ponderado",
      custo_unitario_estoque: 500,
      custo_unitario_consumo: 5,
      referencia_custo: "lotes_estoque_liberados",
    };
    calcularTodas.mockResolvedValue({
      breakdowns: [{
        codigo: "A1",
        lote: 10,
        reagentes: 5,
        equipamento: 0,
        pessoal: 0,
        custoAnalitico: 5,
        overhead: 0,
        custoTotal: 5,
        fatores: 0,
        preco: 5,
        provenienciaDimensional: [provenienciaDimensional],
      }],
    });
    from.mockImplementation((table: string) => {
      if (table === "orcamentos") {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { status: "rascunho", status_operacional: "pendente", fonte_custo_insumos: "custo_medio_ponderado" }, error: null }) }) }) };
      }
      if (table === "orcamento_itens") {
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      }
      throw new Error(`Tabela inesperada no teste: ${table}`);
    });

    const { salvarItemOrcamento } = await import("./orcamentos");
    const formData = new FormData();
    formData.set("orcamento_id", "42");
    formData.set("codigo_analise", "A1");
    formData.set("n_amostras", "10");
    formData.set("acao", "incluir");

    const estado = await salvarItemOrcamento({ ok: false }, formData);

    expect(estado.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("salvar_item_orcamento", expect.objectContaining({
      p_orcamento_id: 42,
      p_codigo_analise: "A1",
      p_n_amostras: 10,
      p_valor_snapshot: expect.objectContaining({
        proveniencia_dimensional: [provenienciaDimensional],
      }),
      p_custo_snapshot: expect.objectContaining({
        linhas: expect.arrayContaining([
          expect.objectContaining({ proveniencia_dimensional: [provenienciaDimensional] }),
        ]),
      }),
    }));
  });

  it("recalcula com operacao fornecida e nao atualiza status depois da RPC", async () => {
    const operacaoId = "11111111-1111-4111-8111-111111111111";
    calcularTodas.mockResolvedValue({
      breakdowns: [{
        codigo: "A1",
        lote: 10,
        reagentes: 5,
        equipamento: 0,
        pessoal: 0,
        custoAnalitico: 5,
        overhead: 0,
        custoTotal: 5,
        fatores: 0,
        preco: 5,
        provenienciaDimensional: [],
      }],
    });
    const updateOrcamento = vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    }));
    let leituraOrcamento = 0;
    let leituraItens = 0;
    from.mockImplementation((table: string) => {
      if (table === "orcamentos") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: leituraOrcamento++ === 0
                  ? {
                      status: "rascunho",
                      fonte_custo_insumos: "custo_padrao",
                      custo_revisao: 3,
                    }
                  : { status: "rascunho" },
                error: null,
              }),
            }),
          }),
          update: updateOrcamento,
        };
      }
      if (table === "orcamento_itens") {
        return {
          select: () => ({
            eq: async () => ({
              data: leituraItens++ === 0
                ? [{
                    id: 7,
                    codigo_analise: "A1",
                    n_amostras: 10,
                    custo_unitario: 4,
                    preco_unitario: 4,
                    valor_snapshot: null,
                  }]
                : [{ id: 7 }],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`Tabela inesperada no teste: ${table}`);
    });

    const { recalcularOrcamento } = await import("./orcamentos");
    const formData = new FormData();
    formData.set("orcamento_id", "42");
    formData.set("motivo", "Atualização controlada");
    formData.set("fonte_custo_insumos", "custo_padrao");
    formData.set("operacao_id", operacaoId);

    const resultado = await recalcularOrcamento(formData);

    expect.soft(rpc).toHaveBeenCalledWith(
      "recalcular_orcamento_transacional",
      expect.objectContaining({ p_operacao_id: operacaoId }),
    );
    expect.soft(updateOrcamento).not.toHaveBeenCalled();
    expect.soft(resultado).toEqual({
      ok: true,
      message: "Orçamento recalculado com sucesso.",
    });
  });

  it("retorna falha explicita quando o id do orcamento e invalido", async () => {
    const { recalcularOrcamento } = await import("./orcamentos");

    const resultado = await recalcularOrcamento(new FormData());

    expect(resultado).toEqual({
      ok: false,
      message: "Informe um orçamento válido para recalcular.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("retorna falha explicita quando o orcamento nao existe", async () => {
    from.mockImplementation((table: string) => {
      if (table === "orcamentos") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: null, error: null }),
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      throw new Error(`Tabela inesperada no teste: ${table}`);
    });
    const { recalcularOrcamento } = await import("./orcamentos");
    const formData = new FormData();
    formData.set("orcamento_id", "42");
    formData.set("operacao_id", "55555555-5555-4555-8555-555555555555");

    const resultado = await recalcularOrcamento(formData);

    expect(resultado).toEqual({
      ok: false,
      message: "Orçamento não encontrado para recálculo.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
