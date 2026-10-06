import { afterEach, describe, expect, it, vi } from "vitest";

import { createMockSupabaseClient, resetMockSupabaseStore } from "./mock-supabase";

type ScratchRow = { id: number; recebido_em: string | null };
type ScratchQuantidadeRow = { id: number; quantidade_atual: number };
type CodigoAnaliseK007 = "Illumina_16S_AC" | "qPCR_F";
type FichaDimensional = {
  codigo_analise: CodigoAnaliseK007;
  insumo_id: number;
  quantidade_por_amostra: number;
};
type CustoDimensional = {
  insumo_id: number;
  custo_padrao: number;
  unidade_estoque: string;
  unidade_consumo: string;
  fator_conversao: number;
  fonte_custo: string;
};
type ProvenienciaDimensional = {
  insumo_id: number;
  unidade_estoque: string;
  unidade_consumo: string;
  fator_conversao: number;
  fonte_custo: string;
  referencia_custo: string;
  custo_unitario_estoque: number;
  custo_unitario_consumo: number;
  quantidade_consumo: number;
  quantidade_estoque: number;
};
type TotaisSnapshot = { custo: number; preco: number; amostras: number };
type OrcamentoK007 = {
  custo_snapshot: {
    linhas: Array<{
      codigo_analise: CodigoAnaliseK007;
      proveniencia_dimensional: ProvenienciaDimensional[];
    }>;
    totais: TotaisSnapshot;
  };
  orcamento_itens: Array<{
    codigo_analise: CodigoAnaliseK007;
    n_amostras: number;
    custo_unitario: number;
    preco_unitario: number;
    valor_snapshot: { proveniencia_dimensional: ProvenienciaDimensional[] };
  }>;
};

const referencias: Record<CodigoAnaliseK007, string> = {
  Illumina_16S_AC: "insumos:3",
  qPCR_F: "insumos:9",
};

afterEach(() => {
  vi.unstubAllEnvs();
  resetMockSupabaseStore();
  // Limpa a tabela usada nos testes para nao vazar estado entre casos.
  const globalStore = globalThis as typeof globalThis & {
    __kontrolMockStore?: Record<string, unknown[]>;
  };
  if (globalStore.__kontrolMockStore) {
    globalStore.__kontrolMockStore.scratch_is = [];
    globalStore.__kontrolMockStore.scratch_quantidades = [];
  }
});

describe("mock supabase K007", () => {
  it("deriva a proveniência dos insumos e custos dimensionais da fixture E2E", async () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_SUPABASE", "1");
    resetMockSupabaseStore();
    const supabase = createMockSupabaseClient();
    const [{ data: orcamentoData }, { data: fichasData }, { data: custosData }] = await Promise.all([
      supabase.from("orcamentos").select("*").eq("id", 2).single(),
      supabase.from("insumo_analise").select("*").in("codigo_analise", ["Illumina_16S_AC", "qPCR_F"]),
      supabase.from("v_custo_estoque_vigente").select("*"),
    ]);
    const orcamento = orcamentoData as OrcamentoK007 | null;
    const fichas = (fichasData ?? []) as FichaDimensional[];
    const custos = (custosData ?? []) as CustoDimensional[];

    expect(fichas).toHaveLength(2);
    expect(custos.length).toBeGreaterThanOrEqual(fichas.length);
    expect(orcamento).not.toBeNull();
    if (!orcamento) throw new Error("Fixture K007 sem orçamento mockado");
    const snapshot = orcamento.custo_snapshot;
    const itens = orcamento.orcamento_itens;
    for (const linha of snapshot.linhas) {
      const ficha = fichas.find((item) => item.codigo_analise === linha.codigo_analise);
      const custo = custos.find((item) => item.insumo_id === ficha?.insumo_id);
      const proveniencia = linha.proveniencia_dimensional[0];
      const item = itens.find((valor) => valor.codigo_analise === linha.codigo_analise);

      expect(proveniencia).toMatchObject({
        insumo_id: ficha?.insumo_id,
        unidade_estoque: custo?.unidade_estoque,
        unidade_consumo: custo?.unidade_consumo,
        fator_conversao: custo?.fator_conversao,
        fonte_custo: custo?.fonte_custo,
        referencia_custo: referencias[linha.codigo_analise],
        quantidade_consumo: ficha?.quantidade_por_amostra,
      });
      expect(proveniencia.custo_unitario_consumo).toBe(
        Number(custo?.custo_padrao) / Number(custo?.fator_conversao),
      );
      expect(proveniencia.quantidade_estoque).toBe(
        Number(ficha?.quantidade_por_amostra) / Number(custo?.fator_conversao),
      );
      expect(item?.valor_snapshot).toMatchObject({ proveniencia_dimensional: [proveniencia] });
    }
    const totais = itens.reduce((soma, item) => ({
      custo: soma.custo + Number(item.custo_unitario) * Number(item.n_amostras),
      preco: soma.preco + Number(item.preco_unitario) * Number(item.n_amostras),
      amostras: soma.amostras + Number(item.n_amostras),
    }), { custo: 0, preco: 0, amostras: 0 });
    expect(snapshot.totais).toEqual(totais);
  });
});

describe("mock supabase .is", () => {
  it("filtra linhas onde a coluna e null", async () => {
    const supabase = createMockSupabaseClient();

    await supabase.from("scratch_is").insert([
      { id: 1, recebido_em: null },
      { id: 2, recebido_em: "2026-06-20T10:00:00.000Z" },
      { id: 3, recebido_em: null },
    ]);

    const { data, error } = await supabase
      .from("scratch_is")
      .select("id, recebido_em")
      .is("recebido_em", null);

    expect(error).toBeNull();
    const ids = ((data ?? []) as ScratchRow[]).map((row) => row.id).sort();
    expect(ids).toEqual([1, 3]);
  });
});

describe("mock supabase comparadores", () => {
  it("filtra linhas com gt", async () => {
    const supabase = createMockSupabaseClient();

    await supabase.from("scratch_quantidades").insert([
      { id: 1, quantidade_atual: 0 },
      { id: 2, quantidade_atual: 1 },
      { id: 3, quantidade_atual: 10 },
    ]);

    const { data, error } = await supabase
      .from("scratch_quantidades")
      .select("id, quantidade_atual")
      .gt("quantidade_atual", 0);

    expect(error).toBeNull();
    const ids = ((data ?? []) as ScratchQuantidadeRow[]).map((row) => row.id).sort();
    expect(ids).toEqual([2, 3]);
  });
});

describe("mock supabase lifecycle de insumos", () => {
  it("espelha ativo=true nas fixtures, relações de lote e novos cadastros", async () => {
    const supabase = createMockSupabaseClient();

    const [{ data: insumo }, { data: lote }] = await Promise.all([
      supabase.from("insumos").select("id, ativo").eq("id", 900).single(),
      supabase.from("lotes_estoque").select("id, insumos!inner(ativo)").eq("id", 1).single(),
    ]);
    await supabase.from("insumos").insert({ id: 901, especificacao: "Insumo novo" });
    const { data: inserido } = await supabase.from("insumos").select("id, ativo").eq("id", 901).single();

    expect(insumo).toMatchObject({ id: 900, ativo: true });
    expect(lote).toMatchObject({ id: 1, insumos: { ativo: true } });
    expect(inserido).toMatchObject({ id: 901, ativo: true });
  });
});
