import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMockSupabaseClient,
  getMockSupabaseStore,
  resetMockSupabaseStore,
} from "@/lib/testing/mock-supabase";

vi.mock("server-only", () => ({}));

import { computarDemandaPlano } from "./demanda";

describe("demanda liquida do planejamento", () => {
  beforeEach(() => resetMockSupabaseStore());

  it("contabiliza parcial com lote e ignora shortfall parcial sem lote", async () => {
    const store = getMockSupabaseStore();
    store.planejamento_itens = [{
      planejamento_id: 7,
      codigo_analise: "E2-DEMANDA",
      n_amostras: 10,
      n_controles: 0,
      repeticoes: 1,
      perda_percentual: 0,
    }];
    store.etapas = [];
    store.insumo_analise = [{
      codigo_analise: "E2-DEMANDA",
      nome_etapa: "Preparo",
      nome_atividade: "Consumo",
      especificacao_insumo: "Insumo E2",
      grupo_escolha: null,
      quantidade_por_amostra: 1,
      modo_cobranca: "por_amostra",
      insumo_id: 42,
      insumos: { custo_unitario: 1 },
    }];
    store.v_estoque_saldo = [{
      insumo_id: 42,
      unidade: "mL",
      disponivel: 6,
    }];
    store.insumos = [{
      id: 42,
      fator_conversao: 1,
      custo_unitario: 1,
      quantidade_minima_compra: null,
      quantidade_embalagem: null,
    }];
    store.reservas_estoque = [
      {
        planejamento_id: 7,
        insumo_id: 42,
        lote_id: 101,
        quantidade: 3,
        quantidade_consumida: 1,
        status: "parcial",
      },
      {
        planejamento_id: 7,
        insumo_id: 42,
        lote_id: null,
        quantidade: 3,
        quantidade_consumida: 0,
        status: "parcial",
      },
    ];
    store.lotes_estoque = [{ id: 101, modelo_quantidade: "UNIDADE", conteudo_embalagem_snapshot: null }];

    const [demanda] = await computarDemandaPlano(createMockSupabaseClient() as never, 7);

    expect(demanda).toMatchObject({ demanda: 10, disponivel: 6, falta: 2 });
  });

  it("compara na unidade física quando o lote conta embalagens fechadas", async () => {
    const store = getMockSupabaseStore();
    store.planejamento_itens = [{
      planejamento_id: 8,
      codigo_analise: "E2-FRASCO",
      n_amostras: 250,
      n_controles: 0,
      repeticoes: 1,
      perda_percentual: 0,
    }];
    store.etapas = [];
    store.insumo_analise = [{
      codigo_analise: "E2-FRASCO",
      nome_etapa: "Preparo",
      nome_atividade: "Consumo",
      especificacao_insumo: "Tampão 100 mL",
      grupo_escolha: null,
      quantidade_por_amostra: 1000, // µL por amostra
      modo_cobranca: "por_amostra",
      insumo_id: 43,
      insumos: { custo_unitario: 5 },
    }];
    // 3 frascos de 100 mL: a view crua mostra "3"; a unidade física, 300 mL.
    store.v_estoque_saldo = [{ insumo_id: 43, unidade: "mL", disponivel: 3 }];
    store.v_estoque_disponivel_unidade = [{ insumo_id: 43, disponivel_unidade: 200 }];
    store.insumos = [{
      id: 43,
      fator_conversao: 1000,
      custo_unitario: 5,
      quantidade_minima_compra: null,
      quantidade_embalagem: 100,
    }];
    store.lotes_estoque = [{ id: 501, modelo_quantidade: "EMBALAGEM_FECHADA", conteudo_embalagem_snapshot: 100 }];
    store.reservas_estoque = [{
      planejamento_id: 8,
      insumo_id: 43,
      lote_id: 501,
      quantidade: 1, // 1 frasco reservado para este plano
      quantidade_consumida: 0,
      status: "reservado",
    }];

    const [demanda] = await computarDemandaPlano(createMockSupabaseClient() as never, 8);

    // 250 mL necessários; 100 mL já reservados (1 frasco) + 200 mL livres → sem falta
    expect(demanda).toMatchObject({ demanda: 250, disponivel: 200, falta: 0 });
  });
});

/** Cliente falso: toda consulta à tabela `falha` devolve erro; as outras, lista vazia. */
function clienteComFalha(falha: string) {
  const resposta = (tabela: string) =>
    tabela === falha ? { data: null, error: { message: `sem acesso a ${tabela}` } } : { data: [], error: null };
  const consulta = (tabela: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order"]) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve(resposta(tabela)).then(ok);
    return q;
  };
  return { from: consulta } as unknown as Parameters<typeof computarDemandaPlano>[0];
}

describe("demanda do planejamento com fonte indisponível", () => {
  it("não trata erro de leitura das análises do plano como plano vazio", async () => {
    await expect(computarDemandaPlano(clienteComFalha("planejamento_itens"), 7)).rejects.toThrow(
      /análises do plano/,
    );
  });
});

describe("demanda do planejamento com linha ausente (leitura sem erro)", () => {
  beforeEach(() => {
    resetMockSupabaseStore();
    const store = getMockSupabaseStore();
    store.planejamento_itens = [{
      planejamento_id: 9, codigo_analise: "E2-FONTE", n_amostras: 10, n_controles: 0, repeticoes: 1, perda_percentual: 0,
    }];
    store.etapas = [];
    store.insumo_analise = [{
      codigo_analise: "E2-FONTE", nome_etapa: "Preparo", nome_atividade: "Consumo", especificacao_insumo: "Insumo fonte",
      grupo_escolha: null, quantidade_por_amostra: 1000, modo_cobranca: "por_amostra", insumo_id: 44, insumos: { custo_unitario: 1 },
    }];
    store.v_estoque_saldo = [{ insumo_id: 44, unidade: "mL", disponivel: 5 }];
    store.insumos = [{ id: 44, fator_conversao: 1000, custo_unitario: 1, quantidade_minima_compra: null, quantidade_embalagem: null }];
    store.reservas_estoque = [{ planejamento_id: 9, insumo_id: 44, lote_id: 601, quantidade: 1, quantidade_consumida: 0, status: "reservado" }];
    store.lotes_estoque = [{ id: 601, modelo_quantidade: "EMBALAGEM_FECHADA", conteudo_embalagem_snapshot: 2 }];
  });

  it("calcula quando cadastro e lote existem", async () => {
    const [demanda] = await computarDemandaPlano(createMockSupabaseClient() as never, 9);
    // 10 amostras × 1000 µL / fator 1000 = 10 mL; 1 frasco de 2 mL reservado + 5 livres → falta 3
    expect(demanda).toMatchObject({ demanda: 10, disponivel: 5, falta: 3 });
  });

  it("insumo sem cadastro lido não presume fator 1", async () => {
    getMockSupabaseStore().insumos = [];
    await expect(computarDemandaPlano(createMockSupabaseClient() as never, 9)).rejects.toThrow(
      /conversão de unidade não pode ser presumida/,
    );
  });

  it("lote reservado não lido não presume conteúdo 1", async () => {
    getMockSupabaseStore().lotes_estoque = [];
    await expect(computarDemandaPlano(createMockSupabaseClient() as never, 9)).rejects.toThrow(
      /reserva não pode ser convertida/,
    );
  });
});
