import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const revalidatePath = vi.fn();
const select = vi.fn();
const single = vi.fn();
const update = vi.fn();
const insert = vi.fn();
const eq = vi.fn();
const deleteRow = vi.fn();
const from = vi.fn();
const rpc = vi.fn();
const createClient = vi.fn();
const registrarEvento = vi.fn();
const registrarVersaoParametrosEconomicos = vi.fn();
const exigirPapelOrcamento = vi.fn();
let lista: unknown[] = [];

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect,
  unstable_rethrow: (erro: unknown) => {
    if (erro instanceof Error && erro.message.startsWith("NEXT_REDIRECT")) throw erro;
  },
}));
vi.mock("./eventos", () => ({ registrarEvento }));
vi.mock("@/lib/orcamento/parametros-versionamento", () => ({ registrarVersaoParametrosEconomicos }));
vi.mock("@/lib/orcamento/governanca", () => ({ exigirPapelOrcamento }));
vi.mock("@/lib/supabase/server", () => ({
  createClient,
}));

describe("actions de orcamento de projetos", () => {
  beforeEach(() => {
    redirect.mockClear();
    revalidatePath.mockClear();
    select.mockReset();
    single.mockReset();
    update.mockReset();
    insert.mockReset();
    eq.mockReset();
    deleteRow.mockReset();
    from.mockReset();
    createClient.mockReset();
    rpc.mockReset();
    rpc.mockResolvedValue({ error: null });
    registrarEvento.mockReset();
    registrarVersaoParametrosEconomicos.mockReset();
    exigirPapelOrcamento.mockReset();
    lista = [];
    // Encadeável como o cliente real: .eq().eq() e await direto devolvem { data: lista }.
    const cadeia = {
      eq,
      single,
      then: (resolver: (valor: { data: unknown; error: null }) => unknown) => resolver({ data: lista, error: null }),
    };
    select.mockReturnValue(cadeia);
    single.mockResolvedValue({ data: { status: "rascunho", demanda_id: 5, project_months: 12 }, error: null });
    update.mockReturnValue(cadeia);
    insert.mockResolvedValue({ error: null });
    deleteRow.mockReturnValue(cadeia);
    from.mockReturnValue({ select, update, delete: deleteRow, insert });
    eq.mockReturnValue(cadeia);
    createClient.mockResolvedValue({ from, rpc });
  });

  it("salva justificativa formal para projeto sem custo", async () => {
    const { salvarOrcamentoProjeto } = await import("./orcamento-projetos");
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");
    formData.set("titulo", "Projeto sem custo");
    formData.set("status", "enviado");
    formData.set("validade_dias", "30");
    formData.set("projeto_sem_custo_justificativa", "Execução sem cobrança por contrapartida institucional.");

    await salvarOrcamentoProjeto(formData);

    expect(exigirPapelOrcamento).toHaveBeenCalledWith("preencher_custos");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      titulo: "Projeto sem custo",
      projeto_sem_custo_justificativa: "Execução sem cobrança por contrapartida institucional.",
    }));
    expect(rpc).toHaveBeenCalledWith("transicionar_orcamento_projeto", expect.objectContaining({
      p_orcamento_projeto_id: 77,
      p_status_destino: "enviado",
    }));
    expect(eq).toHaveBeenCalledWith("id", 77);
  });

  it("adiciona custo manual com etapa, atividade, entrega e nomenclatura institucional", async () => {
    const { adicionarCustoProjeto } = await import("./orcamento-projetos");
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");
    formData.set("rubrica", "MC");
    formData.set("categoria", "materiais");
    formData.set("descricao", "Kit de coleta");
    formData.set("quantidade", "2");
    formData.set("custo_unitario", "150");
    formData.set("unidade", "un");
    formData.set("etapa", "Campo");
    formData.set("atividade", "Coleta");
    formData.set("entrega", "Relatório técnico");
    formData.set("categoria_institucional", "Material de consumo");

    await adicionarCustoProjeto(formData);

    expect(exigirPapelOrcamento).toHaveBeenCalledWith("preencher_custos");
    expect(insert).toHaveBeenCalledWith({
      orcamento_projeto_id: 77,
      categoria: "materiais",
      rubrica: "MC",
      descricao: "Kit de coleta",
      quantidade: 2,
      unidade: "un",
      custo_unitario: 150,
      preco_unitario: 150,
      meses_selecionados: [],
      origem: "manual",
      etapa: "Campo",
      atividade: "Coleta",
      entrega: "Relatório técnico",
      categoria_institucional: "Material de consumo",
      nomenclatura_origem: "kontrol",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento/demandas/5");
    expect(revalidatePath).not.toHaveBeenCalledWith(expect.stringContaining("/orcamento/projetos"));
  });

  it("bloqueia salvar parametros economicos com gross-up maior ou igual a 100%", async () => {
    const { salvarParametrosEconomicosProjeto } = await import("./orcamento-projetos");
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");
    formData.set("demanda_id", "5");
    formData.set("impostos_legacy", "50");
    formData.set("incubacao", "20");
    formData.set("reserva", "10");
    formData.set("investimentos", "10");
    formData.set("lucro", "10");

    await expect(salvarParametrosEconomicosProjeto(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/orcamento/demandas/5?etapa=parametros&erro_parametros=",
    );

    expect(exigirPapelOrcamento).toHaveBeenCalledWith("editar_parametros");
    expect(createClient).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("salva parametros economicos validos", async () => {
    const { salvarParametrosEconomicosProjeto } = await import("./orcamento-projetos");
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");
    formData.set("margem_lucro", "0");
    formData.set("impostos", "0");
    formData.set("project_months", "12");
    formData.set("impostos_legacy", "12");
    formData.set("incubacao", "5");
    formData.set("reserva", "3");
    formData.set("investimentos", "4");
    formData.set("lucro", "10");

    await salvarParametrosEconomicosProjeto(formData);

    expect(exigirPapelOrcamento).toHaveBeenCalledWith("editar_parametros");
    expect(update).toHaveBeenCalledWith({
      margem_lucro: 0,
      impostos: 0,
      project_months: 12,
      impostos_legacy: 12,
      incubacao: 5,
      reserva: 3,
      investimentos: 4,
      lucro: 10,
    });
    expect(eq).toHaveBeenCalledWith("id", 77);
    expect(registrarVersaoParametrosEconomicos).toHaveBeenCalledWith(expect.anything(), {
      escopo: "projeto",
      orcamentoProjetoId: 77,
      parametros: {
        margem_lucro: 0,
        impostos: 0,
        project_months: 12,
        impostos_legacy: 12,
        incubacao: 5,
        reserva: 3,
        investimentos: 4,
        lucro: 10,
      },
      origem: "orcamento/projetos",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento/demandas/5");
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento/demandas");
  });

  it("bloqueia exclusao de projeto enviado", async () => {
    const { excluirOrcamentoProjeto } = await import("./orcamento-projetos");
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");
    single.mockResolvedValue({ data: { status: "enviado", demanda_id: 5 }, error: null });

    await expect(excluirOrcamentoProjeto(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/orcamento/demandas/5?etapa=projeto&erro_exclusao=",
    );

    expect(exigirPapelOrcamento).toHaveBeenCalledWith("cancelar_documento");
    expect(deleteRow).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(expect.stringContaining("/orcamento/demandas/5?etapa=projeto&erro_exclusao="));
  });

  it("permite exclusao de projeto em rascunho", async () => {
    const { excluirOrcamentoProjeto } = await import("./orcamento-projetos");
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");
    single.mockResolvedValue({ data: { status: "rascunho", demanda_id: 5 }, error: null });

    await expect(excluirOrcamentoProjeto(formData)).rejects.toThrow("NEXT_REDIRECT:/orcamento/demandas/5?etapa=projeto");

    expect(exigirPapelOrcamento).toHaveBeenCalledWith("cancelar_documento");
    expect(deleteRow).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith("id", 77);
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento/demandas/5");
    expect(redirect).toHaveBeenCalledWith("/orcamento/demandas/5?etapa=projeto");
  });

  it("cancela projeto preservando historico", async () => {
    const { cancelarOrcamentoProjeto } = await import("./orcamento-projetos");
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");
    formData.set("motivo", "Cancelamento solicitado");
    single.mockResolvedValue({ data: { status: "enviado", demanda_id: 5 }, error: null });
    await expect(cancelarOrcamentoProjeto(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/orcamento/demandas/5?etapa=projeto",
    );

    expect(exigirPapelOrcamento).toHaveBeenCalledWith("cancelar_documento");
    expect(rpc).toHaveBeenCalledWith("transicionar_orcamento_projeto", expect.objectContaining({
      p_orcamento_projeto_id: 77,
      p_status_destino: "cancelado",
      p_observacao: "Cancelamento solicitado",
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento/demandas/5");
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento/demandas");
  });

  it("usa a identidade de versão retornada pelo retry idempotente", async () => {
    const { aprovarOrcamentoPublico } = await import("./orcamento-projetos");
    const formData = new FormData();
    formData.set("token", "token-da-versao-emitida");
    formData.set("nome", "Cliente");
    rpc.mockResolvedValueOnce({
      data: {
        aprovado: true,
        repetido: true,
        versao_id: 321,
      },
      error: null,
    });

    await expect(aprovarOrcamentoPublico(formData)).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledWith("aprovar_orcamento_publico", {
      p_token: "token-da-versao-emitida",
      p_nome: "Cliente",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento/final/321");
  });

  it("arquiva template sem apagar o registro", async () => {
    const { excluirTemplate } = await import("./orcamento-projetos");
    const formData = new FormData();
    formData.set("template_id", "12");
    single.mockResolvedValue({ data: { nome: "Monitoramento padrão", descricao: "Base recorrente" }, error: null });

    await excluirTemplate(formData);

    expect(exigirPapelOrcamento).toHaveBeenCalledWith("gerir_modelos");
    expect(deleteRow).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      nome: "[ARQUIVADO] Monitoramento padrão",
    }));
    expect(eq).toHaveBeenCalledWith("id", 12);
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento/modelos");
  });

  it("atualiza custo do projeto restrito à linha do próprio orçamento", async () => {
    const { atualizarCustoProjeto } = await import("./orcamento-projetos");
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");
    formData.set("item_id", "9");
    formData.set("descricao", "Kit revisado");
    formData.set("unidade", "cx");
    formData.set("quantidade", "3");
    formData.set("custo_unitario", "12.5");
    formData.set("etapa", "Campo");

    await atualizarCustoProjeto(formData);

    expect(exigirPapelOrcamento).toHaveBeenCalledWith("preencher_custos");
    expect(update).toHaveBeenCalledWith({
      descricao: "Kit revisado",
      unidade: "cx",
      quantidade: 3,
      custo_unitario: 12.5,
      preco_unitario: 12.5,
      etapa: "Campo",
      atividade: null,
      entrega: null,
    });
    expect(eq).toHaveBeenCalledWith("id", 9);
    expect(eq).toHaveBeenCalledWith("orcamento_projeto_id", 77);
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento/demandas/5");
  });

  it("não atualiza custo com quantidade zero nem com orçamento revisado", async () => {
    const { atualizarCustoProjeto } = await import("./orcamento-projetos");
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");
    formData.set("item_id", "9");
    formData.set("descricao", "Kit");
    formData.set("quantidade", "0");
    formData.set("custo_unitario", "10");
    await expect(atualizarCustoProjeto(formData)).resolves.toMatchObject({ ok: false, message: expect.stringContaining("maior que zero") });

    formData.set("quantidade", "1");
    single.mockResolvedValue({ data: { status: "enviado", demanda_id: 5 }, error: null });
    await expect(atualizarCustoProjeto(formData)).resolves.toMatchObject({ ok: false, message: expect.stringContaining('status "enviado"') });
    expect(update).not.toHaveBeenCalled();
  });

  it("grava meses do pessoal só das linhas enviadas, dentro do prazo do projeto", async () => {
    const { salvarMesesPessoalProjeto } = await import("./orcamento-projetos");
    lista = [
      { id: 1, quantidade: 1, meses_selecionados: [] },
      { id: 2, quantidade: 4, meses_selecionados: [1, 2] },
      { id: 3, quantidade: 2, meses_selecionados: [5] },
    ];
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");
    formData.append("linha_1", "1");
    for (const mes of ["3", "1", "2", "13", "2"]) formData.append("meses_1", mes);
    formData.append("linha_2", "1");
    for (const mes of ["1", "2"]) formData.append("meses_2", mes);

    await salvarMesesPessoalProjeto(formData);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ meses_selecionados: [1, 2, 3], quantidade: 3 });
    expect(eq).toHaveBeenCalledWith("id", 1);
    expect(eq).toHaveBeenCalledWith("rubrica", "PE");
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento/demandas/5");
  });

  it("limpar meses do pessoal mantém a quantidade anterior (coluna exige > 0)", async () => {
    const { salvarMesesPessoalProjeto } = await import("./orcamento-projetos");
    lista = [{ id: 2, quantidade: 4, meses_selecionados: [1, 2, 3, 4] }];
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");
    formData.append("linha_2", "1");

    await salvarMesesPessoalProjeto(formData);

    expect(update).toHaveBeenCalledWith({ meses_selecionados: [], quantidade: 4 });
  });

  it("altera a duração e retira meses do pessoal que ficam fora do prazo", async () => {
    const { salvarDuracaoProjeto } = await import("./orcamento-projetos");
    lista = [
      { id: 1, quantidade: 12, meses_selecionados: [1, 6, 7, 12] },
      { id: 2, quantidade: 2, meses_selecionados: [1, 2] },
    ];
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");
    formData.set("project_months", "6");

    await salvarDuracaoProjeto(formData);

    expect(update).toHaveBeenCalledWith({ project_months: 6 });
    expect(update).toHaveBeenCalledWith({ meses_selecionados: [1, 6], quantidade: 2 });
    expect(update).toHaveBeenCalledTimes(2);

    formData.set("project_months", "61");
    await expect(salvarDuracaoProjeto(formData)).resolves.toMatchObject({ ok: false, message: expect.stringContaining("1 a 60 meses") });
  });

  it("conclui a revisão dos custos de projeto pelo RPC transacional", async () => {
    const { concluirRevisaoCustosProjeto } = await import("./orcamento-projetos");
    single.mockResolvedValue({
      data: { status: "rascunho", demanda_id: 5, orcamento_projeto_custos: [{ id: 1 }], orcamento_projeto_analises: [] },
      error: null,
    });
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");

    await concluirRevisaoCustosProjeto(formData);

    expect(exigirPapelOrcamento).toHaveBeenCalledWith("revisar_modulo");
    expect(rpc).toHaveBeenCalledWith("transicionar_orcamento_projeto", {
      p_orcamento_projeto_id: 77,
      p_status_destino: "enviado",
      p_observacao: "Revisão dos custos de projeto concluída.",
    });
    expect(update).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento/demandas/5");
  });

  it("não conclui revisão sem itens nem fora do rascunho", async () => {
    const { concluirRevisaoCustosProjeto } = await import("./orcamento-projetos");
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");

    single.mockResolvedValue({
      data: { status: "rascunho", demanda_id: 5, orcamento_projeto_custos: [], orcamento_projeto_analises: [] },
      error: null,
    });
    await expect(concluirRevisaoCustosProjeto(formData)).resolves.toMatchObject({ ok: false, message: expect.stringContaining("ao menos um custo") });

    single.mockResolvedValue({
      data: { status: "enviado", demanda_id: 5, orcamento_projeto_custos: [{ id: 1 }], orcamento_projeto_analises: [] },
      error: null,
    });
    await expect(concluirRevisaoCustosProjeto(formData)).resolves.toMatchObject({ ok: false, message: expect.stringContaining("em edição") });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("propaga a recusa de permissão do papel antes de tocar no banco", async () => {
    const { concluirRevisaoCustosProjeto } = await import("./orcamento-projetos");
    exigirPapelOrcamento.mockRejectedValueOnce(new Error("Sem permissão para revisar módulo."));
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");

    await expect(concluirRevisaoCustosProjeto(formData)).resolves.toMatchObject({ ok: false, message: expect.stringContaining("Sem permissão") });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("reabre somente custos recusados", async () => {
    const { reabrirCustosProjeto } = await import("./orcamento-projetos");
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");

    single.mockResolvedValue({ data: { status: "enviado", demanda_id: 5 }, error: null });
    await expect(reabrirCustosProjeto(formData)).resolves.toMatchObject({ ok: false, message: expect.stringContaining("recusados") });
    expect(rpc).not.toHaveBeenCalled();

    single.mockResolvedValue({ data: { status: "recusado", demanda_id: 5 }, error: null });
    await reabrirCustosProjeto(formData);
    expect(rpc).toHaveBeenCalledWith("transicionar_orcamento_projeto", expect.objectContaining({
      p_orcamento_projeto_id: 77,
      p_status_destino: "rascunho",
    }));
  });

  it("salva viagens, recalcula linhas VD e cria as linhas padrão que faltam", async () => {
    const { salvarViagensProjeto } = await import("./orcamento-projetos");
    // Mesma lista serve para as linhas VD atuais e para o catálogo VD (mock simples).
    lista = [
      { id: 4, descricao: "Alimentação", categoria: "deslocamento", catalogo_item_id: null },
    ];
    const formData = new FormData();
    formData.set("orcamento_projeto_id", "77");
    formData.set("pessoas", "2");
    formData.set("dias_campo", "3");
    formData.set("criar_linhas_padrao", "1");

    await salvarViagensProjeto(formData);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      travel_inputs: expect.objectContaining({ pessoas: 2, dias_campo: 3 }),
    }));
    expect(update).toHaveBeenCalledWith({ quantidade: 6 });
    // A alimentação já existe (mesmo tipo de despesa): nada é duplicado.
    expect(insert).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento/demandas/5");
  });
});
