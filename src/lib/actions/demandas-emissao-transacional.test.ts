import { beforeEach, describe, expect, it, vi } from "vitest";

// Contrato da emissão transacional: o TS calcula/valida com a engine autoritativa
// e a persistência é feita por UMA chamada RPC. (Validação integrada da atomicidade
// real exige banco de homologação — ver diagnóstico.)
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/orcamento/governanca", () => ({ exigirPapelOrcamento: vi.fn(async () => {}) }));

type RpcResult = { data: unknown; error: { message: string } | null };
const rpc = vi.fn(
  async (): Promise<RpcResult> => ({ data: { id: 9, numero: "OF-2026-0007-v1", versao: 1 }, error: null }),
);
const rpcCall = (i: number) => rpc.mock.calls[i] as unknown as [string, Record<string, unknown>];
const getUser = vi.fn(async () => ({ data: { user: { id: "u1", email: "a@b.com" } } }));

const state = {
  demanda: {} as Record<string, unknown>,
  orcamentos: [] as unknown[],
  projetos: [] as unknown[],
  inserts: [] as string[],
  updates: [] as string[],
  parametros: [] as { chave: string; valor: number }[],
};

const from = vi.fn((table: string) => {
  if (table === "demandas_propostas") {
    return {
      select: () => ({ eq: () => ({ single: async () => ({ data: state.demanda, error: null }) }) }),
      update: () => ({ eq: async () => { state.updates.push(table); return { error: null }; } }),
    };
  }
  if (table === "orcamentos") {
    return {
      select: () => ({ eq: () => ({ order: async () => ({ data: state.orcamentos, error: null }) }) }),
      insert: () => { state.inserts.push(table); return { select: () => ({ single: async () => ({ data: { id: 1 } }) }) }; },
    };
  }
  if (table === "orcamento_projetos") {
    return { select: () => ({ eq: () => ({ order: async () => ({ data: state.projetos, error: null }) }) }) };
  }
  if (table === "orcamento_final_versoes") {
    return {
      update: () => ({ eq: () => ({ eq: async () => { state.updates.push(table); return { error: null }; } }) }),
      insert: () => { state.inserts.push(table); return { select: () => ({ single: async () => ({ data: { id: 1 } }) }) }; },
    };
  }
  if (table === "parametros") {
    // padrões globais usados quando a proposta não tem projeto nem percentuais próprios (0118)
    return { select: async () => ({ data: state.parametros, error: null }) };
  }
  if (table === "orcamento_parametros_aplicados") {
    return { insert: async () => { state.inserts.push(table); return { error: null }; } };
  }
  // Documento do cliente (0135): catálogo, empresa emissora e seções padrão.
  if (table === "analises") {
    return { select: () => ({ in: async () => ({ data: [{ codigo: "A1", nome: "Análise um" }], error: null }) }) };
  }
  if (table === "empresas_emissoras") {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { codigo: "ATGC", nome_legal: "ATGC Genética Ambiental Ltda.", cnpj: "12.345.678/0001-90" }, error: null }),
        }),
      }),
    };
  }
  if (table === "proposta_secoes_padrao") {
    return {
      select: () => ({
        eq: () => ({
          order: async () => ({
            data: [{ chave: "prazos", titulo: "Prazos e entregas", texto: "Relatório em 30 dias.", ordem: 10, ativo: true }],
            error: null,
          }),
        }),
      }),
    };
  }
  return {};
});

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from, rpc, auth: { getUser } })) }));

const demandasActions = await import("./demandas");

const demandaCompleta = {
  id: 7,
  titulo: "Demanda",
  cliente_nome: "Cliente",
  modalidade: "analises",
  status: "em_analise",
  escopo_preliminar: "Escopo",
  matriz_amostra: "Água",
  quantidade_amostras_estimada: 3,
};
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
const orcamentoRevisado = {
  id: 5,
  status: "aprovado",
  status_operacional: "revisado",
  fonte_custo_insumos: "custo_medio_ponderado",
  custo_snapshot: {
    fonte_custo_insumos: "custo_medio_ponderado",
    linhas: [{
      codigo_analise: "A1",
      proveniencia_dimensional: [provenienciaDimensional],
    }],
  },
  orcamento_itens: [{
    id: 1,
    n_amostras: 2,
    custo_unitario: 50,
    preco_unitario: 80,
    valor_snapshot: {
      proveniencia_dimensional: [provenienciaDimensional],
    },
  }],
};

beforeEach(() => {
  redirect.mockClear();
  rpc.mockClear();
  rpc.mockResolvedValue({ data: { id: 9, numero: "OF-2026-0007-v1", versao: 1 }, error: null });
  state.demanda = { ...demandaCompleta };
  state.orcamentos = [{ ...orcamentoRevisado }];
  state.projetos = [];
  state.inserts = [];
  state.updates = [];
  // fixture "sem parâmetros": zera também a taxa de incubação (padrão 2%)
  state.parametros = [{ chave: "taxa_incubacao", valor: 0 }];
});

async function emitir(
  operacaoId = "22222222-2222-4222-8222-222222222222",
  confirmarSemParametros = true,
) {
  const fd = new FormData();
  fd.set("demanda_id", "7");
  fd.set("validade_dias", "30");
  fd.set("operacao_id", operacaoId);
  // Fixture "apenas análises" não tem parâmetros (Σ% = 0): exige confirmação.
  if (confirmarSemParametros) fd.set("confirmar_sem_parametros", "sim");
  return demandasActions.emitirOrcamentoFinalDaDemanda(fd);
}

describe("emissão transacional", () => {
  it("aceita proveniência completa e persiste via UMA chamada RPC", async () => {
    await expect(emitir()).rejects.toThrow("NEXT_REDIRECT:/orcamento/demandas/7?etapa=final");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpcCall(0)[0]).toBe("emitir_orcamento_final_transacional");
    // nada gravado fora da RPC:
    expect(state.inserts).not.toContain("orcamento_final_versoes");
    expect(state.inserts).not.toContain("orcamento_parametros_aplicados");
    expect(state.updates).not.toContain("orcamento_final_versoes"); // sem "substituir" fora da RPC
    expect(state.updates).not.toContain("demandas_propostas"); // "orcada" só pela RPC
  });

  it("congela no snapshot o documento do cliente: nomes, empresa e textos (0135)", async () => {
    state.demanda = { ...demandaCompleta, instituicao: "ATGC" };
    state.orcamentos = [{ ...orcamentoRevisado, orcamento_itens: [{ ...orcamentoRevisado.orcamento_itens[0], codigo_analise: "A1" }] }];
    await expect(emitir()).rejects.toThrow(/NEXT_REDIRECT/);
    const snapshot = rpcCall(0)[1].p_snapshot as {
      nomes_analises: Record<string, string>;
      empresa_emissora: { codigo: string; cnpj: string };
      textos_proposta: { descricao: unknown; secoes: Array<{ chave: string }> };
    };
    expect(snapshot.nomes_analises).toEqual({ A1: "Análise um" });
    expect(snapshot.empresa_emissora).toMatchObject({ codigo: "ATGC", cnpj: "12.345.678/0001-90" });
    expect(snapshot.textos_proposta.secoes.map((s) => s.chave)).toEqual(["prazos"]);
    // sem texto salvo, a descrição nasce do escopo preliminar
    expect(JSON.stringify(snapshot.textos_proposta.descricao)).toContain("Escopo");
  });

  it("envia snapshot com engine/fórmula/totais e payload de parâmetros", async () => {
    await expect(emitir()).rejects.toThrow(/NEXT_REDIRECT/);
    const args = rpcCall(0)[1] as Record<string, unknown>;
    const snapshot = args.p_snapshot as { consolidado: { economia: { politica: string } } };
    expect(snapshot.consolidado.economia.politica).toBe("A_GROSS_UP_TOTAL");
    expect(typeof args.p_total_final).toBe("number");
    const params = args.p_parametros as { formula_snapshot: { formula: string } };
    expect(params.formula_snapshot.formula).toMatch(/custo_laboratorial_tecnico/);
  });

  it("conserva a proveniencia dimensional do item e do custo operacional na emissao", async () => {
    await expect(emitir()).rejects.toThrow(/NEXT_REDIRECT/);
    const args = rpcCall(0)[1] as Record<string, unknown>;
    const snapshot = args.p_snapshot as {
      orcamentos_analises: Array<{
        custo_snapshot: { linhas: Array<{ proveniencia_dimensional: unknown[] }> };
        orcamento_itens: Array<{ valor_snapshot: { proveniencia_dimensional: unknown[] } }>;
      }>;
    };

    expect(snapshot.orcamentos_analises[0].custo_snapshot.linhas[0]
      .proveniencia_dimensional).toEqual([provenienciaDimensional]);
    expect(snapshot.orcamentos_analises[0].orcamento_itens[0].valor_snapshot
      .proveniencia_dimensional).toEqual([provenienciaDimensional]);
  });

  it("recusa linha economica sem snapshot reconstruivel antes da RPC", async () => {
    state.orcamentos = [{
      ...orcamentoRevisado,
      custo_snapshot: null,
      orcamento_itens: [{
        ...orcamentoRevisado.orcamento_itens[0],
        valor_snapshot: null,
      }],
    }];

    let falha: unknown;
    try {
      await emitir();
    } catch (error) {
      falha = error;
    }

    expect.soft(String(falha)).toMatch(/erro_emissao=/);
    expect.soft(rpc).not.toHaveBeenCalled();
  });

  it("recusa linha com insumo e proveniência vazia antes da RPC", async () => {
    state.orcamentos = [{
      ...orcamentoRevisado,
      custo_snapshot: {
        ...orcamentoRevisado.custo_snapshot,
        linhas: [{ codigo_analise: "A1", reagentes: 10, proveniencia_dimensional: [] }],
      },
      orcamento_itens: [{
        ...orcamentoRevisado.orcamento_itens[0],
        valor_snapshot: { composicao: { reagentes: 10 }, proveniencia_dimensional: [] },
      }],
    }];

    await expect(emitir()).rejects.toThrow(/erro_emissao=/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("recusa proveniência dimensional incompleta antes da RPC", async () => {
    const incompleta = { ...provenienciaDimensional, referencia_custo: "" };
    state.orcamentos = [{
      ...orcamentoRevisado,
      custo_snapshot: {
        ...orcamentoRevisado.custo_snapshot,
        linhas: [{ codigo_analise: "A1", proveniencia_dimensional: [incompleta] }],
      },
      orcamento_itens: [{
        ...orcamentoRevisado.orcamento_itens[0],
        valor_snapshot: { proveniencia_dimensional: [incompleta] },
      }],
    }];

    await expect(emitir()).rejects.toThrow(/erro_emissao=/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("repassa a identidade de operacao fornecida antes da action", async () => {
    const operacaoId = "33333333-3333-4333-8333-333333333333";
    await expect(emitir(operacaoId)).rejects.toThrow(/NEXT_REDIRECT/);

    expect(rpcCall(0)[1]).toEqual(expect.objectContaining({
      p_operacao_id: operacaoId,
    }));
  });

  it("cálculo vem da engine autoritativa (total 100 = lab técnico 2×50, sem parâmetros)", async () => {
    await expect(emitir()).rejects.toThrow(/NEXT_REDIRECT/);
    const args = rpcCall(0)[1] as Record<string, unknown>;
    expect(args.p_total_final).toBe(100);
    expect(args.p_total_laboratorio_custo).toBe(100);
  });

  it("apenas análises usa os percentuais gravados na proposta (0118)", async () => {
    state.demanda = { ...demandaCompleta, param_impostos: 0, param_incubacao: 0, param_reserva: 0, param_investimentos: 0, param_lucro: 20 };
    await expect(emitir(undefined, false)).rejects.toThrow(/NEXT_REDIRECT/);
    const args = rpcCall(0)[1] as Record<string, unknown>;
    // 100 / (1 − 20%) = 125
    expect(args.p_total_final).toBe(125);
  });

  it("apenas análises sem percentuais gravados usa os padrões de Parâmetros de custeio", async () => {
    state.parametros = [
      { chave: "impostos", valor: 10 },
      { chave: "margem_lucro", valor: 8 },
    ];
    await expect(emitir(undefined, false)).rejects.toThrow(/NEXT_REDIRECT/);
    const args = rpcCall(0)[1] as Record<string, unknown>;
    // taxa de incubação não cadastrada = 2%, sobre os serviços sem impostos:
    // 10 + 8 + 2 × 0,9 = 19,8% → 100 / 0,802 = 124,69
    expect(args.p_total_final).toBe(124.69);
  });

  it("falha da RPC retorna erro claro e não confirma emissão", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "lock timeout" } });
    await expect(emitir()).rejects.toThrow(/erro_emissao=/);
  });

  it("custo técnico zero bloqueia ANTES da RPC", async () => {
    state.orcamentos = [{ ...orcamentoRevisado, orcamento_itens: [{ id: 1, n_amostras: 2, custo_unitario: 0, preco_unitario: 0 }] }];
    await expect(emitir()).rejects.toThrow(/erro_emissao=/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("duplicidade ativa bloqueia emissão ANTES da RPC", async () => {
    state.orcamentos = [{ ...orcamentoRevisado, id: 5 }, { ...orcamentoRevisado, id: 6 }];
    await expect(emitir()).rejects.toThrow(/erro_emissao=/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sem parâmetros econômicos, só emite com confirmação explícita", async () => {
    await expect(emitir(undefined, false)).rejects.toThrow(/erro_emissao=.*custo%20t%C3%A9cnico/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ignora módulos cancelados nos totais e no snapshot", async () => {
    state.orcamentos = [
      { ...orcamentoRevisado },
      { ...orcamentoRevisado, id: 6, status: "cancelado", status_operacional: "cancelado" },
    ];
    await expect(emitir()).rejects.toThrow("NEXT_REDIRECT:/orcamento/demandas/7?etapa=final");
    const args = rpcCall(0)[1] as { p_total_laboratorio_custo: number; p_snapshot: { orcamentos_analises: unknown[] } };
    expect(args.p_total_laboratorio_custo).toBe(100);
    expect(args.p_snapshot.orcamentos_analises).toHaveLength(1);
  });
});
