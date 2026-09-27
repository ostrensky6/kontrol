import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
const single = vi.fn();
const select = vi.fn(() => ({ single }));
const insert = vi.fn();
const eq = vi.fn();
const selectAtualizados = vi.fn();
const update = vi.fn();
const from = vi.fn(() => ({ insert, update }));
const rpc = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createClientUntyped: vi.fn(async () => ({ from, rpc })),
}));

function formInsumo(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const base: Record<string, string> = {
    _slug: "insumos",
    especificacao: "Master mix qPCR",
    custo_total_embalagem: "500",
    quantidade_embalagem: "100",
    unidade: "frasco",
    unidade_consumo: "reacao",
    fator_conversao: "100",
  };

  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    formData.set(key, value);
  }

  return formData;
}

function formInsumoExistente(id: number) {
  const formData = formInsumo();
  formData.set("_id", String(id));
  return formData;
}

describe("cadastro de insumos", () => {
  beforeEach(() => {
    revalidatePath.mockReset();
    from.mockClear();
    insert.mockReset();
    update.mockReset();
    select.mockClear();
    single.mockReset();
    eq.mockReset();
    rpc.mockReset();
    insert.mockReturnValue({ select });
    update.mockReturnValue({ eq });
    single.mockResolvedValue({ data: { id: 321 }, error: null });
    selectAtualizados.mockReset();
    selectAtualizados.mockResolvedValue({ data: [{ id: 321 }], error: null });
    eq.mockReturnValue({ select: selectAtualizados });
    rpc.mockResolvedValue({ data: { insumo_id: 321, repetido: false }, error: null });
  });

  it("bloqueia fator de conversao zero ou negativo", async () => {
    const { salvarRegistro } = await import("./cadastros");
    const result = await salvarRegistro({ ok: false }, formInsumo({ fator_conversao: "0" }));

    expect(result.ok).toBe(false);
    expect(result.errors?.fator_conversao).toBe("Mínimo 0.000001");
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("bloqueia quantidade de embalagem zerada", async () => {
    const { salvarRegistro } = await import("./cadastros");
    const result = await salvarRegistro({ ok: false }, formInsumo({ quantidade_embalagem: "0" }));

    expect(result.ok).toBe(false);
    expect(result.errors?.quantidade_embalagem).toBe("Informe quanto vem em 1 embalagem (maior que 0)");
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("bloqueia quantidade em estoque negativa ou fracionada", async () => {
    const { salvarRegistro } = await import("./cadastros");

    const negativa = await salvarRegistro({ ok: false }, formInsumo({ quantidade: "-1" }));
    expect(negativa.ok).toBe(false);
    expect(negativa.errors?.quantidade).toBe("Mínimo 0");

    const fracionada = await salvarRegistro({ ok: false }, formInsumo({ quantidade: "1.5" }));
    expect(fracionada.ok).toBe(false);
    expect(fracionada.errors?.quantidade).toBe("Use um número inteiro de embalagens");

    expect(rpc).not.toHaveBeenCalled();
  });

  it("cria o insumo com quantidade pela RPC atomica, sem tocar insert direto", async () => {
    const { salvarRegistro } = await import("./cadastros");
    const result = await salvarRegistro({ ok: false }, formInsumo({ quantidade: "3" }));

    expect(result).toEqual({ ok: true, message: "Criado.", createdId: 321 });
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledOnce();
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("criar_insumo_com_quantidade");
    expect(args).toMatchObject({
      p_quantidade_embalagens: 3,
      p_dados_insumo: expect.objectContaining({
        especificacao: "Master mix qPCR",
        quantidade_embalagem: 100,
        unidade: "frasco",
        unidade_consumo: "reacao",
        fator_conversao: 100,
      }),
    });
    expect(typeof args.p_operacao_id).toBe("string");
    expect(args.p_operacao_id.length).toBeGreaterThan(0);
    // "quantidade" nao e uma coluna de insumos: nao pode vazar no payload.
    expect(args.p_dados_insumo).not.toHaveProperty("quantidade");
    // A RPC calcula o custo unitario e recusa a chave ("Campo não reconhecido").
    expect(args.p_dados_insumo).not.toHaveProperty("custo_unitario");
  });

  it("envia somente chaves aceitas pela RPC do banco (bug: Campo não reconhecido)", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "supabase", "migrations");
    // a definição mais recente da função é a que vale no banco
    const sql = readdirSync(dir)
      .filter((nome) => nome.endsWith(".sql"))
      .sort()
      .map((nome) => readFileSync(join(dir, nome), "utf8"))
      .filter((texto) => texto.includes("function public.criar_insumo_com_quantidade("))
      .at(-1);
    expect(sql).toBeTruthy();
    const lista = sql!.match(/where k not in \(([\s\S]*?)\)\s*\)/)?.[1] ?? "";
    const aceitas = new Set([...lista.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    expect(aceitas.size).toBeGreaterThan(10);

    const { salvarRegistro } = await import("./cadastros");
    await salvarRegistro(
      { ok: false },
      formInsumo({
        quantidade: "2",
        codigo_lote: "L-2026-01",
        data_aquisicao: "2026-09-01",
        validade_dias: "30",
        categoria_compra: "critico",
        ponto_reposicao: "1",
      }),
    );
    const [, args] = rpc.mock.calls[0];
    const enviadas = Object.keys(args.p_dados_insumo);
    expect(enviadas.filter((chave) => !aceitas.has(chave))).toEqual([]);
    expect(args.p_dados_insumo.codigo_lote).toBe("L-2026-01");
  });

  it("assume quantidade zero quando o campo nao e enviado", async () => {
    const { salvarRegistro } = await import("./cadastros");
    await salvarRegistro({ ok: false }, formInsumo());

    expect(rpc).toHaveBeenCalledWith(
      "criar_insumo_com_quantidade",
      expect.objectContaining({ p_quantidade_embalagens: 0 }),
    );
  });

  it("reutiliza o operacao_id enviado pelo formulario (reenvio idempotente)", async () => {
    const { salvarRegistro } = await import("./cadastros");
    await salvarRegistro(
      { ok: false },
      formInsumo({ quantidade: "3", _operacao_id: "11111111-1111-1111-1111-111111111111" }),
    );

    expect(rpc).toHaveBeenCalledWith(
      "criar_insumo_com_quantidade",
      expect.objectContaining({ p_operacao_id: "11111111-1111-1111-1111-111111111111" }),
    );
  });

  it("não retorna ID quando a criação falha", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Falha ao criar." } });
    const { salvarRegistro } = await import("./cadastros");

    const result = await salvarRegistro({ ok: false }, formInsumo());

    expect(result).toEqual({ ok: false, message: "Falha ao criar." });
    expect(result).not.toHaveProperty("createdId");
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("não inventa criação ao atualizar", async () => {
    const { salvarRegistro } = await import("./cadastros");

    const result = await salvarRegistro({ ok: false }, formInsumoExistente(321));

    expect(result).toEqual({ ok: true, message: "Atualizado." });
    expect(result).not.toHaveProperty("createdId");
    expect(update).toHaveBeenCalledOnce();
    expect(eq).toHaveBeenCalledWith("id", 321);
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("não diz Atualizado quando o banco não alterou nenhuma linha (RLS)", async () => {
    selectAtualizados.mockResolvedValue({ data: [], error: null });
    const { salvarRegistro } = await import("./cadastros");

    const result = await salvarRegistro({ ok: false }, formInsumoExistente(321));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Nada foi alterado/);
  });

  it.each([
    ["ausente", null],
    ["malformado", { insumo_id: "321" }],
  ])("falha fechada quando o ID criado é %s", async (_caso, data) => {
    rpc.mockResolvedValue({ data, error: null });
    const { salvarRegistro } = await import("./cadastros");

    const result = await salvarRegistro({ ok: false }, formInsumo());

    expect(result).toEqual({
      ok: false,
      message: "Não foi possível confirmar o identificador do registro criado.",
    });
    expect(result).not.toHaveProperty("createdId");
    expect(rpc).toHaveBeenCalledOnce();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("cadastros: auditoria de 26/09 (onda 2)", () => {
  beforeEach(() => {
    revalidatePath.mockReset();
    from.mockClear();
    insert.mockReset();
    update.mockReset();
    select.mockClear();
    single.mockReset();
    eq.mockReset();
    rpc.mockReset();
    insert.mockReturnValue({ select });
    update.mockReturnValue({ eq });
    single.mockResolvedValue({ data: { id: 7 }, error: null });
    selectAtualizados.mockReset();
    selectAtualizados.mockResolvedValue({ data: [{ id: 7 }], error: null });
    eq.mockReturnValue({ select: selectAtualizados });
    rpc.mockResolvedValue({ data: { insumo_id: 7, repetido: false }, error: null });
  });

  function form(campos: Record<string, string>) {
    const formData = new FormData();
    for (const [chave, valor] of Object.entries(campos)) formData.set(chave, valor);
    return formData;
  }

  it("CAD2-1: unidade da embalagem é obrigatória no insumo", async () => {
    const { salvarRegistro } = await import("./cadastros");
    const result = await salvarRegistro({ ok: false }, formInsumo({ unidade: " " }));
    expect(result.ok).toBe(false);
    expect(result.errors?.unidade).toBe("Obrigatório");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("CAD-6: editar sem enviar um campo não o apaga (grava só o que o formulário enviou)", async () => {
    const { salvarRegistro } = await import("./cadastros");
    const result = await salvarRegistro(
      { ok: false },
      form({ _slug: "locais", _id: "7", nome: "Freezer 2", tipo: "freezer" }),
    );
    expect(result.ok).toBe(true);
    const payload = update.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toEqual({ nome: "Freezer 2", tipo: "freezer" });
    expect(payload).not.toHaveProperty("parent_id");
  });

  it("edição de insumo não apaga campos fora do formulário nem dados do lote", async () => {
    const { salvarRegistro } = await import("./cadastros");
    await salvarRegistro({ ok: false }, formInsumoExistente(7));
    const payload = update.mock.calls[0][0] as Record<string, unknown>;
    for (const campo of ["codigo_interno", "sds_url", "fornecedor_alt_id", "condicao_armazenamento", "data_validade", "data_fabricacao", "data_aquisicao"]) {
      expect(payload, campo).not.toHaveProperty(campo);
    }
    expect(payload.custo_unitario).toBe(5);
  });

  it("local não pode ficar dentro de si mesmo", async () => {
    const { salvarRegistro } = await import("./cadastros");
    const result = await salvarRegistro(
      { ok: false },
      form({ _slug: "locais", _id: "7", nome: "Gaveta", parent_id: "7" }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors?.parent_id).toMatch(/dentro de si mesmo/);
    expect(update).not.toHaveBeenCalled();
  });

  it("projeto com término antes do início é recusado", async () => {
    const { salvarRegistro } = await import("./cadastros");
    const result = await salvarRegistro(
      { ok: false },
      form({ _slug: "projetos", nome: "P1", data_inicio: "2026-10-10", data_fim: "2026-10-01" }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors?.data_fim).toBe("A data de término não pode ser anterior à de início");
    expect(insert).not.toHaveBeenCalled();
  });

  it("CAD2-11: embalagem de R$ 0 salva com aviso de sem custo", async () => {
    const { salvarRegistro } = await import("./cadastros");
    const result = await salvarRegistro({ ok: false }, formInsumo({ custo_total_embalagem: "0" }));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/sem custo/);
  });

  it("exclusão recusada pelo gatilho mantém a orientação em português", async () => {
    const { excluirRegistro } = await import("./cadastros");
    const deleteSelect = vi.fn(async () => ({
      data: null,
      error: { code: "23503", message: "Não é possível excluir: o fornecedor tem pedidos ou insumos. Desative-o." },
    }));
    from.mockReturnValueOnce({ delete: () => ({ eq: () => ({ select: deleteSelect }) }) } as never);
    const result = await excluirRegistro({ ok: false }, form({ _slug: "fornecedores", _id: "7" }));
    expect(result).toEqual({ ok: false, message: "Não é possível excluir: o fornecedor tem pedidos ou insumos. Desative-o." });
  });

  it("recusa técnica do banco não chega crua à tela", async () => {
    const { excluirRegistro } = await import("./cadastros");
    const deleteSelect = vi.fn(async () => ({
      data: null,
      error: { code: "23503", message: 'update or delete on table "x" violates foreign key constraint' },
    }));
    from.mockReturnValueOnce({ delete: () => ({ eq: () => ({ select: deleteSelect }) }) } as never);
    const result = await excluirRegistro({ ok: false }, form({ _slug: "clientes", _id: "7" }));
    expect(result.message).toMatch(/^Não é possível excluir: o registro está em uso/);
    expect(result.message).not.toMatch(/violates/);
  });
});
