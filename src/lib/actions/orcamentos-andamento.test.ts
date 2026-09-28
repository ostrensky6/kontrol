import { beforeEach, describe, expect, it, vi } from "vitest";

// Revisão e cancelamento do módulo laboratorial não podem dizer "concluído"
// quando uma das gravações falhou (auditoria de 27/09).

const revalidatePath = vi.fn();
const rpc = vi.fn();
const from = vi.fn();
const updateOrcamento = vi.fn();
let leituraOrcamento: { data: { status: string } | null; error: { message: string } | null };
let leituraItens: { data: { id: number }[] | null; error: { message: string } | null };
let gravacoes: { error: { message: string } | null }[];

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/costing/loader", () => ({ calcularTodas: vi.fn() }));
vi.mock("./eventos", () => ({ registrarEvento: vi.fn() }));
vi.mock("@/lib/orcamento/governanca", () => ({ exigirPapelOrcamento: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from, rpc })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ error: null });
  leituraOrcamento = { data: { status: "rascunho" }, error: null };
  leituraItens = { data: [{ id: 1 }, { id: 2 }], error: null };
  gravacoes = [];
  updateOrcamento.mockImplementation(() => ({
    eq: async () => gravacoes.shift() ?? { error: null },
  }));
  from.mockImplementation((tabela: string) => {
    if (tabela === "orcamentos") {
      return {
        select: () => ({ eq: () => ({ single: async () => leituraOrcamento }) }),
        update: updateOrcamento,
      };
    }
    if (tabela === "orcamento_itens") {
      return { select: () => ({ eq: async () => leituraItens }) };
    }
    throw new Error(`Tabela inesperada no teste: ${tabela}`);
  });
});

function revisao() {
  const formData = new FormData();
  formData.set("orcamento_id", "42");
  formData.set("responsavel", "Dra. Responsável");
  return formData;
}

function cancelamento() {
  const formData = new FormData();
  formData.set("orcamento_id", "42");
  formData.set("motivo", "Cliente desistiu");
  return formData;
}

describe("revisarOrcamentoLaboratorio", () => {
  it("grava responsável e andamento numa única atualização", async () => {
    const { revisarOrcamentoLaboratorio } = await import("./orcamentos");

    const estado = await revisarOrcamentoLaboratorio({ ok: false }, revisao());

    expect(estado.ok).toBe(true);
    expect(updateOrcamento).toHaveBeenCalledOnce();
    expect(updateOrcamento).toHaveBeenCalledWith(
      expect.objectContaining({ responsavel: "Dra. Responsável", status_operacional: "revisado" }),
    );
  });

  it("não segue quando não consegue ler o orçamento", async () => {
    leituraOrcamento = { data: null, error: { message: "timeout" } };
    const { revisarOrcamentoLaboratorio } = await import("./orcamentos");

    const estado = await revisarOrcamentoLaboratorio({ ok: false }, revisao());

    expect(estado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(updateOrcamento).not.toHaveBeenCalled();
  });

  it("não confunde falha de leitura dos itens com orçamento vazio", async () => {
    leituraItens = { data: null, error: { message: "timeout" } };
    const { revisarOrcamentoLaboratorio } = await import("./orcamentos");

    const estado = await revisarOrcamentoLaboratorio({ ok: false }, revisao());

    expect(estado.ok).toBe(false);
    expect(estado.message).not.toContain("Adicione ao menos uma análise");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("cancelarOrcamento", () => {
  it("avisa quando o cancelamento entrou mas o andamento não foi atualizado", async () => {
    leituraOrcamento = { data: { status: "enviado" }, error: null };
    gravacoes = [{ error: { message: "permission denied" } }];
    const { cancelarOrcamento } = await import("./orcamentos");

    const estado = await cancelarOrcamento({ ok: false }, cancelamento());

    expect(estado.ok).toBe(false);
    expect(estado.message).toContain("foi cancelado");
    expect(estado.message).toContain("Concluir cancelamento");
  });

  it("repetir o cancelamento corrige o andamento", async () => {
    leituraOrcamento = { data: { status: "cancelado" }, error: null };
    const { cancelarOrcamento } = await import("./orcamentos");

    const estado = await cancelarOrcamento({ ok: false }, cancelamento());

    expect(estado.ok).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    expect(updateOrcamento).toHaveBeenCalledWith(expect.objectContaining({ status_operacional: "cancelado" }));
  });
});
