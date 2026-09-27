import { beforeEach, describe, expect, it, vi } from "vitest";

// Testa a idempotência e o ciclo de vida das actions de geração de módulos.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const exigirPapelOrcamento = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/orcamento/governanca", () => ({ exigirPapelOrcamento }));
// A cópia das análises escolhidas para o módulo tem teste e RPC próprios (0126).
const incluirAnalisesDaDemandaNoOrcamento = vi.fn(async () => ({ ok: true, message: "ok" }));
vi.mock("./orcamentos", () => ({ incluirAnalisesDaDemandaNoOrcamento }));

const state = {
  demanda: {} as Record<string, unknown>,
  labRows: [] as Array<{ id: number; status: string; status_operacional: string }>,
  projRows: [] as Array<{ id: number; status: string }>,
  inserts: [] as Array<{ table: string; payload: unknown }>,
  updates: [] as Array<{ table: string; patch: Record<string, unknown> }>,
};

const from = vi.fn((table: string) => {
  if (table === "demandas_propostas") {
    return {
      select: () => ({ eq: () => ({ single: async () => ({ data: state.demanda, error: null }) }) }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          state.updates.push({ table, patch });
          return { error: null };
        },
      }),
    };
  }
  if (table === "orcamentos") {
    return {
      select: () => ({ eq: async () => ({ data: state.labRows, error: null }) }),
      insert: (payload: unknown) => ({
        select: () => ({
          single: async () => {
            state.inserts.push({ table, payload });
            return { data: { id: 999 }, error: null };
          },
        }),
      }),
    };
  }
  if (table === "orcamento_projetos") {
    return {
      select: () => ({ eq: async () => ({ data: state.projRows, error: null }) }),
      insert: async (payload: unknown) => {
        state.inserts.push({ table, payload });
        return { error: null };
      },
    };
  }
  return {};
});

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from })) }));

const demandasActions = await import("./demandas");

const demandaLab = {
  id: 7,
  titulo: "Demanda",
  cliente_nome: "Cliente",
  modalidade: "analises",
  status: "nova",
  escopo_preliminar: "Escopo",
  matriz_amostra: "Água",
  quantidade_amostras_estimada: 3,
};

beforeEach(() => {
  redirect.mockClear();
  exigirPapelOrcamento.mockClear();
  state.demanda = { ...demandaLab };
  state.labRows = [];
  state.projRows = [];
  state.inserts = [];
  state.updates = [];
});

describe("idempotência de gerarOrcamentoAnalisesDaDemanda", () => {
  it("já existe 1 módulo ativo → abre (não duplica)", async () => {
    state.labRows = [{ id: 5, status: "rascunho", status_operacional: "pendente" }];
    const fd = new FormData();
    fd.set("demanda_id", "7");
    await expect(demandasActions.gerarOrcamentoAnalisesDaDemanda(fd)).rejects.toThrow("NEXT_REDIRECT:/orcamento/5");
    expect(exigirPapelOrcamento).toHaveBeenCalledWith("preencher_custos");
    expect(state.inserts).toHaveLength(0);
  });

  it("múltiplos módulos ativos → bloqueia com erro de integridade (não cria)", async () => {
    state.labRows = [
      { id: 5, status: "rascunho", status_operacional: "pendente" },
      { id: 6, status: "rascunho", status_operacional: "pendente" },
    ];
    const fd = new FormData();
    fd.set("demanda_id", "7");
    await expect(demandasActions.gerarOrcamentoAnalisesDaDemanda(fd)).rejects.toThrow(/erro_integridade=/);
    expect(exigirPapelOrcamento).toHaveBeenCalledWith("preencher_custos");
    expect(state.inserts).toHaveLength(0);
  });

  it("zero módulos → cria e marca demanda como em_analise (NUNCA orcada)", async () => {
    const fd = new FormData();
    fd.set("demanda_id", "7");
    await expect(demandasActions.gerarOrcamentoAnalisesDaDemanda(fd)).rejects.toThrow("NEXT_REDIRECT:/orcamento/999");
    expect(exigirPapelOrcamento).toHaveBeenCalledWith("preencher_custos");
    expect(state.inserts.some((i) => i.table === "orcamentos")).toBe(true);
    // INT-10: o módulo nasce com as análises escolhidas no orçamento
    expect(incluirAnalisesDaDemandaNoOrcamento).toHaveBeenCalledWith(999, 7);
    const statusUpdate = state.updates.find((u) => u.table === "demandas_propostas");
    expect(statusUpdate?.patch.status).toBe("em_analise");
    expect(state.updates.some((u) => u.patch.status === "orcada")).toBe(false);
  });
});
