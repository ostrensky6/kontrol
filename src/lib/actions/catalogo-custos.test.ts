import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
const rpc = vi.fn();
const createClient = vi.fn();
const exigirPapelOrcamento = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({
  unstable_rethrow: (erro: unknown) => {
    if (erro instanceof Error && erro.message.startsWith("NEXT_")) throw erro;
  },
}));
vi.mock("@/lib/orcamento/governanca", () => ({ exigirPapelOrcamento }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

function form(campos: Record<string, string>) {
  const formData = new FormData();
  for (const [chave, valor] of Object.entries(campos)) formData.set(chave, valor);
  return formData;
}

describe("ações do catálogo de custos de projeto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: "MC-107", error: null });
    createClient.mockResolvedValue({ rpc });
    exigirPapelOrcamento.mockResolvedValue(undefined);
  });

  it("cria item novo pela RPC e avisa o código", async () => {
    const { salvarItemCatalogo } = await import("./catalogo-custos");
    const resultado = await salvarItemCatalogo(
      form({ rubrica: "MC", descricao: "Álcool 70%", unidade: "litro", categoria: "", preco: "12,5" }),
    );
    expect(exigirPapelOrcamento).toHaveBeenCalledWith("gerir_modelos");
    expect(rpc).toHaveBeenCalledWith("catalogo_projeto_salvar_item", {
      p_id: null,
      p_rubrica: "MC",
      p_descricao: "Álcool 70%",
      p_unidade: "litro",
      p_categoria: null,
      p_preco: 12.5,
    });
    expect(resultado).toEqual({ ok: true, message: "Item MC-107 criado no catálogo." });
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento/modelos");
  });

  it("na edição, valor vazio mantém o valor (p_preco nulo)", async () => {
    const { salvarItemCatalogo } = await import("./catalogo-custos");
    rpc.mockResolvedValue({ data: "PE-1", error: null });
    const resultado = await salvarItemCatalogo(form({ id: "PE-1", rubrica: "PE", descricao: "Pesquisador", unidade: "mês", preco: "" }));
    expect(rpc).toHaveBeenCalledWith("catalogo_projeto_salvar_item", expect.objectContaining({ p_id: "PE-1", p_preco: null }));
    expect(resultado).toEqual({ ok: true, message: "PE-1 atualizado." });
  });

  it("recusa formulário inválido sem chamar o banco e repassa a recusa do banco", async () => {
    const { salvarItemCatalogo } = await import("./catalogo-custos");
    expect(await salvarItemCatalogo(form({ rubrica: "MC", descricao: "", preco: "1" }))).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "Já existe no catálogo: MC-6 — Papel toalha (fardo). Edite esse item ou mude a descrição ou a unidade." },
    });
    expect(await salvarItemCatalogo(form({ rubrica: "MC", descricao: "papel toalha", unidade: "fardo", preco: "1" }))).toEqual({
      ok: false,
      message: expect.stringContaining("MC-6"),
    });
  });

  it("sem permissão devolve a recusa antes de tocar no banco", async () => {
    const { salvarItemCatalogo } = await import("./catalogo-custos");
    exigirPapelOrcamento.mockRejectedValueOnce(new Error("Sem permissão para gerir modelos."));
    expect(await salvarItemCatalogo(form({ rubrica: "MC", descricao: "A", preco: "1" }))).toMatchObject({
      ok: false,
      message: expect.stringContaining("Sem permissão"),
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("arquivar e reativar chamam a RPC com o estado", async () => {
    const { definirAtivoItemCatalogo } = await import("./catalogo-custos");
    rpc.mockResolvedValue({ data: null, error: null });
    await definirAtivoItemCatalogo(form({ catalogo_item_id: "MC-6", ativo: "0" }));
    expect(exigirPapelOrcamento).toHaveBeenCalledWith("gerir_modelos");
    expect(rpc).toHaveBeenCalledWith("catalogo_projeto_definir_ativo", { p_id: "MC-6", p_ativo: false });
    await definirAtivoItemCatalogo(form({ catalogo_item_id: "MC-6", ativo: "1" }));
    expect(rpc).toHaveBeenLastCalledWith("catalogo_projeto_definir_ativo", { p_id: "MC-6", p_ativo: true });
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento/modelos");
  });

  it("arquivar lança a recusa do banco em português", async () => {
    const { definirAtivoItemCatalogo } = await import("./catalogo-custos");
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "Este item foi unificado em MC-14; use esse item." } });
    await expect(definirAtivoItemCatalogo(form({ catalogo_item_id: "MC-30", ativo: "1" }))).rejects.toThrow("unificado em MC-14");
  });

  it("unifica dois itens", async () => {
    const { unificarItensCatalogo } = await import("./catalogo-custos");
    rpc.mockResolvedValue({ data: null, error: null });
    const resultado = await unificarItensCatalogo(form({ manter: "MC-14", remover: "MC-30" }));
    expect(rpc).toHaveBeenCalledWith("catalogo_projeto_unificar", { p_manter: "MC-14", p_remover: "MC-30" });
    expect(resultado).toEqual({ ok: true, message: "MC-30 unificado em MC-14." });
    expect(await unificarItensCatalogo(form({ manter: "", remover: "MC-30" }))).toMatchObject({ ok: false });
  });
});
