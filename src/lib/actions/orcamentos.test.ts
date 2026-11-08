import { beforeEach, describe, expect, it, vi } from "vitest";
import { calcularAnalise, type Breakdown } from "@/lib/costing/engine";

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
const deleteEq = vi.fn();
const deleteSelect = vi.fn();
const update = vi.fn();
const registrarEvento = vi.fn();
const exigirPapelOrcamento = vi.fn();
const calcularTodas = vi.fn(async (): Promise<{ breakdowns: Breakdown[] }> => ({ breakdowns: [] }));

const provenienciaValida = {
  insumo_id: 9, unidade_estoque: "frasco", unidade_consumo: "reacao",
  fator_conversao: 100, quantidade_consumo: 1, quantidade_estoque: 0.01,
  fonte_custo: "custo_padrao", referencia_custo: "insumos:9",
  custo_unitario_estoque: 500, custo_unitario_consumo: 5,
};
const breakdownValido: Breakdown = {
  codigo: "A1", lote: 10, reagentes: 5, equipamento: 0, pessoal: 0,
  custoAnalitico: 5, overhead: 0, custoTotal: 5, fatores: 0, preco: 5,
  provenienciaDimensional: [provenienciaValida],
};
const semPreco: Breakdown = {
  ...breakdownValido, codigo: "A2",
  provenienciaDimensional: [{ ...provenienciaValida, custo_unitario_estoque: null }],
};

function mockLeiturasCusteio(itens: unknown[] = [], escolhidas: unknown[] = []) {
  const orcamento = { data: { status: "rascunho", fonte_custo_insumos: "custo_padrao", custo_revisao: 3 }, error: null };
  from.mockImplementation((table: string) => {
    if (table === "orcamentos") return { select: () => ({ eq: () => ({
      single: async () => orcamento, maybeSingle: async () => orcamento,
    }) }) };
    if (table === "orcamento_itens" || table === "demanda_analises") return {
      select: () => ({ eq: async () => ({ data: table === "orcamento_itens" ? itens : escolhidas, error: null }) }),
    };
    throw new Error(`Tabela inesperada: ${table}`);
  });
}

function formCusteio(codigo = "A1", acao = "incluir") {
  const form = new FormData();
  form.set("orcamento_id", "42");
  form.set("codigo_analise", codigo);
  form.set("n_amostras", "3");
  form.set("acao", acao);
  form.set("operacao_id", "11111111-1111-4111-8111-111111111111");
  return form;
}

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
    deleteEq.mockReset();
    deleteSelect.mockReset();
    deleteEq.mockReturnValue({ eq: deleteEq, select: deleteSelect });
    deleteSelect.mockResolvedValue({ data: [{ id: 42 }], error: null });
    update.mockReset();
    registrarEvento.mockReset();
    exigirPapelOrcamento.mockReset();
    calcularTodas.mockReset();
    calcularTodas.mockResolvedValue({ breakdowns: [] });
    from.mockReturnValue({ insert, select, delete: deleteRow, update });
    insert.mockReturnValue({ select });
    select.mockReturnValue({ single, eq });
    eq.mockReturnValue({ single });
    deleteRow.mockReturnValue({ eq: deleteEq });
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
    expect(deleteEq).toHaveBeenCalledWith("id", 42);
    expect(deleteEq).toHaveBeenCalledWith("status", "rascunho");
    expect(deleteSelect).toHaveBeenCalledWith("id");
    expect(from.mock.calls.map(([table]) => table)).toEqual(["orcamentos", "orcamentos"]);
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento");
    expect(redirect).toHaveBeenCalledWith("/orcamento");
  });

  it("não anuncia sucesso quando a exclusão falha no banco", async () => {
    const { excluirOrcamento } = await import("./orcamentos");
    const formData = new FormData();
    formData.set("orcamento_id", "42");
    single.mockResolvedValue({ data: { status: "rascunho" }, error: null });
    deleteSelect.mockResolvedValue({ data: null, error: { message: "violação de chave" } });

    await expect(excluirOrcamento(formData)).rejects.toThrow("NEXT_REDIRECT:/orcamento/42?erro_exclusao=");
    expect(revalidatePath).not.toHaveBeenCalledWith("/orcamento");
  });

  it.each(["aprovado", "recusado", "cancelado", "arquivado"])("não tenta excluir estado %s", async (status) => {
    const { excluirOrcamento } = await import("./orcamentos");
    single.mockResolvedValue({ data: { status }, error: null });
    const formData = new FormData();
    formData.set("orcamento_id", "42");
    await expect(excluirOrcamento(formData)).rejects.toThrow("NEXT_REDIRECT:/orcamento/42?erro_exclusao=");
    expect(deleteRow).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("nega sem permissão antes de qualquer acesso ao banco", async () => {
    const { excluirOrcamento } = await import("./orcamentos");
    exigirPapelOrcamento.mockRejectedValueOnce(new Error("Sem permissão"));
    const formData = new FormData();
    formData.set("orcamento_id", "42");
    await expect(excluirOrcamento(formData)).rejects.toThrow("Sem permissão");
    expect(from).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([{ data: [] }, { data: [{ id: 99 }] }])("não anuncia exclusão sem o ID removido exato: %j", async ({ data }) => {
    const { excluirOrcamento } = await import("./orcamentos");
    single.mockResolvedValue({ data: { status: "rascunho" }, error: null });
    deleteSelect.mockResolvedValue({ data, error: null });
    const formData = new FormData();
    formData.set("orcamento_id", "42");
    await expect(excluirOrcamento(formData)).rejects.toThrow("NEXT_REDIRECT:/orcamento/42?erro_exclusao=");
    expect(redirect).not.toHaveBeenCalledWith("/orcamento");
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(from.mock.calls.map(([table]) => table)).toEqual(["orcamentos", "orcamentos"]);
  });

  it.each([
    { data: null, error: null },
    { data: { status: "rascunho" }, error: { message: "leitura negada" } },
  ])("não escreve quando a leitura não confirma rascunho: %j", async (result) => {
    const { excluirOrcamento } = await import("./orcamentos");
    single.mockResolvedValue(result);
    const formData = new FormData();
    formData.set("orcamento_id", "42");
    await expect(excluirOrcamento(formData)).rejects.toThrow("NEXT_REDIRECT:/orcamento/42?erro_exclusao=");
    expect(deleteRow).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
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
        provenienciaDimensional: [provenienciaValida],
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

  it.each([
    ["preço ausente mesmo com fallback positivo", { custo_unitario_estoque: null }],
    ["unidade de estoque vazia", { unidade_estoque: " " }],
    ["unidade de consumo ausente", { unidade_consumo: null }],
    ["fator ausente", { fator_conversao: null }],
    ["fator não positivo", { fator_conversao: 0 }],
    ["custo por consumo incompatível com o fator", { custo_unitario_consumo: 100 }],
    ["quantidade física incompatível com o fator", { quantidade_estoque: 1 }],
  ] as const)("não grava inclusão/quantidade com %s", async (_caso, override) => {
    const { salvarItemOrcamento } = await import("./orcamentos");
    mockLeiturasCusteio();
    calcularTodas.mockResolvedValue({ breakdowns: [{
      ...breakdownValido, provenienciaDimensional: [{ ...provenienciaValida, ...override }],
    }] });
    const estado = await salvarItemOrcamento({ ok: false }, formCusteio());
    expect.soft(estado).toMatchObject({ ok: false, message: expect.stringContaining("A1") });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("não grava análise sem breakdown", async () => {
    const { salvarItemOrcamento } = await import("./orcamentos");
    mockLeiturasCusteio();
    expect(await salvarItemOrcamento({ ok: false }, formCusteio())).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("pré-valida cópia com análise válida antes da incompleta", async () => {
    const { incluirAnalisesDaDemandaNoOrcamento } = await import("./orcamentos");
    mockLeiturasCusteio([], [
      { codigo_analise: "A1", quantidade_amostras: 3 },
      { codigo_analise: "A2", quantidade_amostras: 2 },
    ]);
    calcularTodas.mockResolvedValue({ breakdowns: [breakdownValido, semPreco] });
    const estado = await incluirAnalisesDaDemandaNoOrcamento(42, 7);
    expect.soft(estado).toMatchObject({ ok: false, message: expect.stringContaining("A2") });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("copia o conjunto válido mantendo quantidade agregada e snapshot cumulativo", async () => {
    const { incluirAnalisesDaDemandaNoOrcamento } = await import("./orcamentos");
    mockLeiturasCusteio([], [
      { codigo_analise: "A1", quantidade_amostras: 1 },
      { codigo_analise: "A1", quantidade_amostras: 2 },
      { codigo_analise: "A2", quantidade_amostras: 2 },
    ]);
    calcularTodas.mockResolvedValue({ breakdowns: [breakdownValido, { ...breakdownValido, codigo: "A2" }] });
    expect(await incluirAnalisesDaDemandaNoOrcamento(42, 7)).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, "salvar_item_orcamento", expect.objectContaining({
      p_codigo_analise: "A1", p_n_amostras: 3, p_custo_unitario: 5,
      p_custo_snapshot: expect.objectContaining({ totais: expect.objectContaining({ custo: 15 }) }),
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, "salvar_item_orcamento", expect.objectContaining({
      p_codigo_analise: "A2", p_n_amostras: 2, p_custo_unitario: 5,
      p_custo_snapshot: expect.objectContaining({ totais: expect.objectContaining({ custo: 25 }) }),
    }));
  });

  it("recálculo recusa custo incompleto sem sobrescrever snapshot", async () => {
    const { recalcularOrcamento } = await import("./orcamentos");
    const historico = { id: 7, codigo_analise: "A2", n_amostras: 3, valor_snapshot: { custo: 73 } };
    mockLeiturasCusteio([historico]);
    calcularTodas.mockResolvedValue({ breakdowns: [semPreco] });
    const estado = await recalcularOrcamento(formCusteio("A2"));
    expect.soft(estado).toMatchObject({ ok: false, message: expect.stringContaining("A2") });
    expect(rpc).not.toHaveBeenCalled();
    expect(historico.valor_snapshot).toEqual({ custo: 73 });
  });

  it("mantém remoção disponível mesmo quando a análise está incompleta", async () => {
    const { salvarItemOrcamento } = await import("./orcamentos");
    mockLeiturasCusteio();
    calcularTodas.mockResolvedValue({ breakdowns: [semPreco] });
    expect(await salvarItemOrcamento({ ok: false }, formCusteio("A2", "remover"))).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("salvar_item_orcamento", expect.objectContaining({
      p_codigo_analise: "A2", p_n_amostras: 0,
    }));
  });

  it("preserva zero documentado, conversão selecionada e snapshot de outro item", async () => {
    const { salvarItemOrcamento } = await import("./orcamentos");
    const linha = {
      nome_etapa: "Bancada", nome_atividade: "Teste", quantidade_por_amostra: 1,
      modo_cobranca: "por_amostra",
    };
    const selecionado = { ...linha, ...provenienciaValida, custo_unitario: 5, especificacao_insumo: "Válido", grupo_escolha: "g" };
    const alternativa = { ...selecionado, insumo_id: 10, especificacao_insumo: "Sem conversão", fator_conversao: null, custo_unitario_consumo: null, custo_unitario: 500 };
    const zero = { ...selecionado, insumo_id: 11, especificacao_insumo: "Zero explícito", grupo_escolha: null,
      referencia_custo: "fixture:zero-documentado", custo_unitario_estoque: 0, custo_unitario_consumo: 0, custo_unitario: 0 };
    const calculado = calcularAnalise({
      codigo: "A1", etapas: [], equip: [], insumos: [selecionado, alternativa, zero],
      valorHoraPessoal: 0, custoHoraOverhead: 0,
      params: { dias_uteis_ano: 222, margem_lucro: 0, impostos: 0, taxas: 0, fundo_reserva: 0, fundo_investimento: 0 },
    });
    expect(calculado.provenienciaDimensional?.map((p) => p.insumo_id)).toEqual([11, 9]);
    const antigo = { codigo_analise: "H", n_amostras: 2, custo_unitario: 13, preco_unitario: 15,
      valor_snapshot: { composicao_totais: { reagentes: 26 }, proveniencia_dimensional: [provenienciaValida] } };
    mockLeiturasCusteio([antigo]);
    calcularTodas.mockResolvedValue({ breakdowns: [calculado, semPreco] });
    expect(await salvarItemOrcamento({ ok: false }, formCusteio())).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("salvar_item_orcamento", expect.objectContaining({
      p_custo_unitario: 5, p_preco_unitario: 5,
      p_valor_snapshot: expect.objectContaining({ proveniencia_dimensional: calculado.provenienciaDimensional }),
      p_custo_snapshot: expect.objectContaining({ linhas: expect.arrayContaining([
        expect.objectContaining({ codigo_analise: "H", custo: 26, preco: 30, proveniencia_dimensional: [provenienciaValida] }),
      ]) }),
    }));
  });
});
