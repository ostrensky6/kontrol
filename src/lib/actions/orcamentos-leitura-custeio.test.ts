import { beforeEach, describe, expect, it, vi } from "vitest";
import { custeioLaboratorialCompleto } from "@/lib/costing/completude-laboratorial";
import { calcularTodas, carregarSimuladorCusteio } from "@/lib/costing/loader";
import {
  incluirAnalisesDaDemandaNoOrcamento,
  recalcularOrcamento,
  salvarItemOrcamento,
} from "./orcamentos";

const { from, rpc, revalidatePath } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from, rpc }),
}));
vi.mock("@/lib/orcamento/governanca", () => ({ exigirPapelOrcamento: async () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const sucesso = (data: unknown) => ({ data, error: null });
const falhaReceita = { data: null, error: { message: "insumo_analise indisponível" } };
const lerReceita = vi.fn<() => { data: unknown; error: { message: string } | null }>();
const itemGravado = {
  id: 7,
  codigo_analise: "A1",
  n_amostras: 3,
  custo_unitario: 5,
  preco_unitario: 6,
  valor_snapshot: { composicao_totais: { reagentes: 15, equipamento: 0, pessoal: 0, overhead: 0 } },
};

function form(acao = "incluir", codigo = "A1") {
  const dados = new FormData();
  dados.set("orcamento_id", "42");
  dados.set("codigo_analise", codigo);
  dados.set("n_amostras", "3");
  dados.set("acao", acao);
  dados.set("operacao_id", "11111111-1111-4111-8111-111111111111");
  return dados;
}

describe("orçamento com loader real e leitura da receita em memória", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lerReceita.mockReset().mockReturnValue(sucesso([]));
    rpc.mockImplementation(async (nome: string) => {
      if (nome === "valor_hora_pessoal_total") return sucesso(0);
      if (nome === "salvar_item_orcamento" || nome === "recalcular_orcamento_transacional") return sucesso(null);
      throw new Error(`RPC inesperada: ${nome}`);
    });
    from.mockImplementation((tabela: string) => {
      const orcamento = sucesso({ status: "rascunho", fonte_custo_insumos: "custo_padrao", custo_revisao: 3 });
      const analises = {
        eq: () => analises,
        order: async () => sucesso([{ codigo: "A1" }]),
      };
      switch (tabela) {
        case "orcamentos": return { select: () => ({ eq: () => ({
          single: async () => orcamento, maybeSingle: async () => orcamento,
        }) }) };
        case "orcamento_itens": return { select: () => ({ eq: async () => sucesso([itemGravado]) }) };
        case "demanda_analises": return { select: () => ({ eq: async () => sucesso([
          { codigo_analise: "A1", quantidade_amostras: 3 },
        ]) }) };
        case "analises": return { select: () => analises };
        case "insumo_analise": return { select: async () => lerReceita() };
        case "etapas":
        case "equipamentos":
        case "equipamento_analise":
        case "overhead":
        case "parametros":
        case "v_custo_estoque_vigente": return { select: async () => sucesso([]) };
        default: throw new Error(`Tabela inesperada: ${tabela}`);
      }
    });
  });

  it.each([
    ["inclusão", () => salvarItemOrcamento({ ok: false }, form())],
    ["cópia", () => incluirAnalisesDaDemandaNoOrcamento(42, 8)],
    ["recálculo", () => recalcularOrcamento(form())],
  ] as const)("falha de leitura deixa %s pendente sem RPC de escrita", async (_nome, agir) => {
    lerReceita.mockReturnValue(falhaReceita);
    const estado = await agir();
    expect.soft(rpc.mock.calls.map(([nome]) => nome)).toEqual(["valor_hora_pessoal_total"]);
    expect.soft(estado).toMatchObject({ ok: false, message: expect.stringContaining("Custo pendente para: A1") });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([falhaReceita, sucesso(null), { ...falhaReceita, data: [] }])(
    "não publica breakdown nem disponibilidade sem leitura confirmada (%j)", async (resposta) => {
      lerReceita.mockReturnValue(resposta);
      const { breakdowns } = await calcularTodas();
      expect(custeioLaboratorialCompleto(breakdowns.find((b) => b.codigo === "A1"))).toBe(false);
      expect(breakdowns).toEqual([]);
    },
  );

  it("não simula zero se a primeira leitura falhar e a segunda for bem-sucedida", async () => {
    lerReceita.mockReturnValueOnce(falhaReceita);
    expect((await carregarSimuladorCusteio()).analises).toEqual([]);
  });

  it("aceita receita comprovadamente vazia e grava zero legítimo", async () => {
    const { breakdowns } = await calcularTodas();
    expect(custeioLaboratorialCompleto(breakdowns[0])).toBe(true);
    expect((await carregarSimuladorCusteio()).analises).toMatchObject([{ codigo: "A1", insumos: [] }]);
    await expect(salvarItemOrcamento({ ok: false }, form())).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("salvar_item_orcamento", expect.objectContaining({
      p_custo_unitario: 0,
      p_valor_snapshot: expect.objectContaining({ proveniencia_dimensional: [] }),
    }));
  });

  it("permite remoção e conserva os valores gravados do item remanescente", async () => {
    lerReceita.mockReturnValue(falhaReceita);
    await expect(salvarItemOrcamento({ ok: false }, form("remover", "A2"))).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("salvar_item_orcamento", expect.objectContaining({
      p_codigo_analise: "A2", p_n_amostras: 0,
      p_custo_snapshot: expect.objectContaining({
        linhas: [expect.objectContaining({ codigo_analise: "A1", reagentes: 15, custo: 15, preco: 18 })],
      }),
    }));
  });
});
