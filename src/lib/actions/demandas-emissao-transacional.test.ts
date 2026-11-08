import { beforeEach, describe, expect, it, vi } from "vitest";
import { validarHistoricoFinalEquivalencia, validarTransporteCapturaEquivalencia } from "@/lib/orcamento/snapshot-equivalencia-transporte";
import { entradaDoSnapshot } from "@/lib/orcamento/visao-interna";

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

// ORD165: dados congelados sintéticos, sem leitor de custos/decisões atuais.
function capturaEquivalencia() {
  const decisao = { codigo_analise: "A1", necessidade_id: 11, etapa_id: 21, metodo_revisao_ref: "metodo:r1",
    equipamento_ref: null, insumo_id: 91, apresentacao_ref: "apresentacao:91:r1", decisao_ref: "equivalencia:81",
    evidencia_ref: "laudo:r1", validador_id: "ator-decisao:sintetico", papel_validador: "laboratorio", estado: "validada",
    unidade_estoque: "frasco", unidade_consumo: "reacao", fator_conversao: 30, vigente_desde: 1000, vigente_ate: 2000 };
  const proveniencia = { insumo_id: 91, necessidade_id: 11, etapa_id: 21, unidade_estoque: "frasco", unidade_consumo: "reacao",
    fator_conversao: 30, fonte_custo: "custo_medio_ponderado", referencia_custo: "lotes_estoque_liberados",
    custo_unitario_estoque: 90, custo_unitario_consumo: 3, quantidade_consumo: 2, quantidade_estoque: 2 / 30,
    quantidade_total_consumo: 4, quantidade_total_estoque: 4 / 30, custo_total_insumo: 12,
    modo_cobranca: "por_execucao", lote: 2, decisao };
  const composicao = { reagentes: 4, equipamento: .5, pessoal: 5 / 3, overhead: .5 / 3,
    custoAnalitico: 18.5 / 3, custoTotal: 19 / 3, preco: 21.85 / 3 };
  const total = { reagentes: 12, equipamento: 1.5, pessoal: 5, overhead: .5, custoAnalitico: 18.5, custoTotal: 19, preco: 21.85 };
  const valorSnapshot = { versao: "equivalencia-economica-v1", metodo_revisao_ref: "metodo:r1",
    fonte_custo_insumos: "custo_medio_ponderado", lote_padrao: 2, numero_execucoes: 2, composicao, composicao_totais: total,
    proveniencia_dimensional: [proveniencia], selecao: [{ necessidade_id: 11, etapa_id: 21, insumo_id: 91,
      apresentacao_ref: "apresentacao:91:r1", decisao_ref: "equivalencia:81", evidencia_ref: "laudo:r1",
      quantidade_consumo: 4, quantidade_estoque: 4 / 30, custo_total_insumo: 12 }],
    fontes: { instante: 1500, necessidades: [{ necessidade: { id: 11 }, alternativas: [proveniencia] }],
      etapas: [{ id: 21, amostras_por_execucao: 2 }], parametros: { margem_lucro: 15 }, equipamentos: [],
      equipamento_dia: 1, valor_hora_pessoal: 5, custo_hora_overhead: .5 } };
  const item = { codigo_analise: "A1", n_amostras: 3, custo_unitario: 19 / 3, preco_unitario: 21.85 / 3, valor_snapshot: valorSnapshot };
  return { id: 5, status: "aprovado", status_operacional: "revisado", fonte_custo_insumos: "custo_medio_ponderado",
    orcamento_itens: [{ id: 1, ...structuredClone(item) }], custo_snapshot: {
      versao: "equivalencia-economica-v1", operacao_id: "11111111-1111-4111-8111-111111111111", gerado_em: "2026-11-07T12:00:00Z",
      fonte_custo_insumos: "custo_medio_ponderado", itens: [item], linhas: [{ codigo_analise: "A1", quantidade: 3,
        reagentes: 12, materiais: 12, equipamentos: 1.5, mao_obra: 5, overhead: .5, terceiros: 0, custo: 19, preco: 21.85,
        lote: 2, numero_execucoes: 2, composicao_unitaria: composicao, proveniencia_dimensional: [proveniencia] }],
      totais: { reagentes: 12, materiais: 12, equipamentos: 1.5, mao_obra: 5, overhead: .5, terceiros: 0, custo: 19, preco: 21.85, amostras: 3 } } };
}

describe("ORD172 — correlação monetária canônica (somente mocks)", () => {
  function capturaFracionaria(custo: number, amostras: number) {
    const b = capturaEquivalencia(); const s = b.custo_snapshot; const i = s.itens[0]; const v = i.valor_snapshot;
    const preco = custo * 2; // Referência técnica com margem100%; proposta continua sem parâmetros.
    Object.assign(i, { n_amostras: amostras, custo_unitario: custo / amostras, preco_unitario: preco / amostras });
    Object.assign(v, { lote_padrao: amostras, numero_execucoes: 1 });
    Object.assign(v.composicao, { reagentes: custo / amostras, equipamento: 0, pessoal: 0, overhead: 0,
      custoAnalitico: custo / amostras, custoTotal: custo / amostras, preco: preco / amostras });
    Object.assign(v.composicao_totais, { reagentes: custo, equipamento: 0, pessoal: 0, overhead: 0,
      custoAnalitico: custo, custoTotal: custo, preco });
    const d = v.proveniencia_dimensional[0];
    Object.assign(d, { fator_conversao: 1, custo_unitario_estoque: custo, custo_unitario_consumo: custo,
      quantidade_consumo: 1, quantidade_estoque: 1, quantidade_total_consumo: 1, quantidade_total_estoque: 1,
      custo_total_insumo: custo, modo_cobranca: "por_execucao", lote: amostras });
    d.decisao.fator_conversao = 1;
    Object.assign(v.selecao[0], { quantidade_consumo: 1, quantidade_estoque: 1, custo_total_insumo: custo });
    Object.assign(v.fontes, { equipamento_dia: 0, valor_hora_pessoal: 0, custo_hora_overhead: 0 });
    v.fontes.parametros.margem_lucro = 100;
    v.fontes.etapas[0].amostras_por_execucao = amostras;
    Object.assign(s.linhas[0], { quantidade: amostras, reagentes: custo, materiais: custo, equipamentos: 0,
      mao_obra: 0, overhead: 0, custo, preco, lote: amostras, numero_execucoes: 1 });
    Object.assign(s.totais, { reagentes: custo, materiais: custo, equipamentos: 0, mao_obra: 0, overhead: 0,
      custo, preco, amostras });
    b.orcamento_itens = [{ id: 1, ...structuredClone(i) }];
    return b;
  }
  it.each([[2.345, 17, 2.34, 4.69], [2.095, 67, 2.09, 4.19], [1.1725, 17, 1.17, 2.34]])(
    "aceita captura %s/%s sem arredondar o snapshot e preserva preço de referência", async (custo, amostras, canonico, referencia) => {
      const b = capturaFracionaria(custo, amostras); state.orcamentos = [b];
      const antes = JSON.stringify(b.custo_snapshot);
      expect(validarTransporteCapturaEquivalencia(b).estado).toBe("equivalencia");
      await expect(emitir()).rejects.toThrow(/^NEXT_REDIRECT:\/orcamento\/demandas\/7\?etapa=final$/);
      expect(rpc).toHaveBeenCalledTimes(1);
      const args = rpcCall(0)[1];
      expect(args.p_total_laboratorio_custo).toBe(canonico);
      expect(args.p_total_final).toBe(canonico);
      expect(args.p_total_laboratorio_preco).toBe(referencia);
      const h = validarHistoricoFinalEquivalencia(args.p_snapshot, canonico);
      expect(h.estado).toBe("equivalencia");
      if (h.estado !== "equivalencia") throw new Error("Envelope recusado");
      expect(h.snapshot.orcamentos_analises[0].custo_snapshot).toEqual(b.custo_snapshot);
      expect(JSON.stringify(b.custo_snapshot)).toBe(antes);
      expect(h.snapshot.orcamentos_analises[0].custo_snapshot.totais.custo).toBe(custo);
      for (const campo of ["totalLaboratorioCusto", "totalLaboratorioPreco"] as const) {
        const adulterado = structuredClone(h.snapshot);
        adulterado.consolidado[campo] += .01;
        expect(validarHistoricoFinalEquivalencia(adulterado, canonico).estado).toBe("invalido");
      }
    });
  it.each(["custo", "preco"] as const)("recusa centavo real adulterado em %s antes da RPC", async (campo) => {
    const b = capturaFracionaria(2.345, 17); b.custo_snapshot.totais[campo] += .01; state.orcamentos = [b];
    await expect(emitir()).rejects.toThrow(/erro_emissao=.*equival/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("ORD165 — transporte de equivalência na emissão (somente mocks)", () => {
  it("conserva integralmente orçamento/item/fontes capturados, mesmo com validade técnica hoje expirada", async () => {
    const b = capturaEquivalencia(); state.orcamentos = [b];
    const antes = structuredClone(b);
    await expect(emitir()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpcCall(0)[1].p_snapshot).toMatchObject({ orcamentos_analises: [antes] });
    expect(rpcCall(0)[1].p_snapshot).toHaveProperty("captura_economica_versao", "equivalencia-economica-v1");
    expect(b).toEqual(antes);
    expect(rpcCall(0)[1].p_total_laboratorio_custo).toBe(19);
    // Preço técnico 21,85 é referência; proposta sem parâmetros continua 19.
    expect(rpcCall(0)[1].p_total_final).toBe(19);
    expect(state.updates).toEqual([]); expect(state.inserts).toEqual([]);
  });
  it.each(["item_divergente", "fontes_ausentes", "total_divergente", "marcador_so_no_item"])("recusa %s antes da RPC", async (caso) => {
    const b = capturaEquivalencia();
    if (caso === "item_divergente") b.orcamento_itens[0].custo_unitario = 500;
    if (caso === "fontes_ausentes") {
      Reflect.deleteProperty(b.custo_snapshot.itens[0].valor_snapshot, "fontes");
      Reflect.deleteProperty(b.orcamento_itens[0].valor_snapshot, "fontes");
    }
    if (caso === "total_divergente") b.custo_snapshot.totais.custo = 1000;
    if (caso === "marcador_so_no_item") Reflect.deleteProperty(b.custo_snapshot, "versao");
    state.orcamentos = [b];
    await expect(emitir()).rejects.toThrow(/erro_emissao=.*equival/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rascunho capturado permanece bloqueado por revisão, sem promover status ou chamar RPC", async () => {
    const b = capturaEquivalencia(); b.status = "rascunho"; b.status_operacional = "preenchido"; state.orcamentos = [b];
    await expect(emitir()).rejects.toThrow(/erro_emissao=.*revisar/);
    expect(rpc).not.toHaveBeenCalled(); expect(state.updates).toEqual([]); expect(state.inserts).toEqual([]);
    expect(b.status).toBe("rascunho"); expect(b.status_operacional).toBe("preenchido");
  });
  it("história usa somente snapshot emitido, sem recálculo após mudança das fontes sintéticas", async () => {
    const b = capturaEquivalencia(); state.orcamentos = [b];
    await expect(emitir()).rejects.toThrow(/NEXT_REDIRECT/);
    const congelado = structuredClone(rpcCall(0)[1].p_snapshot);
    b.orcamento_itens[0].custo_unitario = 999;
    b.custo_snapshot.itens[0].valor_snapshot.proveniencia_dimensional[0].custo_unitario_estoque = 99999;
    state.parametros = [{ chave: "margem_lucro", valor: 80 }];
    const chamadas = from.mock.calls.length;
    const h = validarHistoricoFinalEquivalencia(congelado, 19);
    expect(h.estado).toBe("equivalencia");
    if (h.estado !== "equivalencia") throw new Error("Histórico não validado");
    expect(h.snapshot).toEqual(congelado);
    const entrada = entradaDoSnapshot(h.snapshot, h.total);
    expect(entrada.nomesAnalises).toEqual({ A1: "Análise um" });
    expect(entrada.itensLaboratorio[0].custo_unitario).toBe(19 / 3);
    expect(entrada.total).toBe(19);
    expect(from).toHaveBeenCalledTimes(chamadas); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["modulo_ausente", "consolidado_ausente", "nome_ausente", "empresa_ausente", "empresa_vazia", "total_ausente"])(
    "histórico novo %s falha explícito, não desce ao caminho legado", async (caso) => {
      state.orcamentos = [capturaEquivalencia()];
      await expect(emitir()).rejects.toThrow(/NEXT_REDIRECT/);
      const s = structuredClone(rpcCall(0)[1].p_snapshot) as Record<string, unknown>;
      if (caso === "modulo_ausente") Reflect.deleteProperty(s, "orcamentos_analises");
      if (caso === "consolidado_ausente") Reflect.deleteProperty(s, "consolidado");
      if (caso === "nome_ausente") s.nomes_analises = {};
      if (caso === "empresa_ausente") Reflect.deleteProperty(s, "empresa_emissora");
      if (caso === "empresa_vazia") s.empresa_emissora = {};
      expect(validarHistoricoFinalEquivalencia(s, caso === "total_ausente" ? null : 19)).toMatchObject({ estado: "invalido" });
    });
  it.each(["dimensao_total", "decisao", "rastro", "linha", "quantidade", "versao_desconhecida"])("rejeita incoerência congelada %s sem consultar fontes", (caso) => {
    const b = capturaEquivalencia();
    if (caso === "dimensao_total") b.custo_snapshot.itens[0].valor_snapshot.proveniencia_dimensional[0].quantidade_total_estoque = 99;
    if (caso === "decisao") b.custo_snapshot.itens[0].valor_snapshot.proveniencia_dimensional[0].decisao.metodo_revisao_ref = "outro";
    if (caso === "rastro") b.custo_snapshot.itens[0].valor_snapshot.selecao[0].decisao_ref = "equivalencia:99";
    if (caso === "linha") b.custo_snapshot.linhas[0].preco = 0;
    if (caso === "quantidade") b.orcamento_itens[0].n_amostras = 4;
    if (caso === "versao_desconhecida") b.custo_snapshot.versao = "equivalencia-economica-v2";
    expect(validarTransporteCapturaEquivalencia(b)).toMatchObject({ estado: "invalido" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("legado mantém exatamente o contrato anterior, sem novo marcador ou guarda restritiva", async () => {
    expect(validarTransporteCapturaEquivalencia(orcamentoRevisado)).toEqual({ estado: "legado" });
    expect(validarHistoricoFinalEquivalencia({}, null)).toEqual({ estado: "legado" });
    await expect(emitir()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(rpcCall(0)[1].p_snapshot).not.toHaveProperty("captura_economica_versao");
    expect(rpcCall(0)[1].p_total_final).toBe(100);
  });
  it("validação histórica não normaliza textos congelados", async () => {
    state.orcamentos = [capturaEquivalencia()];
    await expect(emitir()).rejects.toThrow(/NEXT_REDIRECT/);
    const s = structuredClone(rpcCall(0)[1].p_snapshot) as Record<string, unknown>;
    s.nomes_analises = { A1: "  Análise na emissão  " };
    const h = validarHistoricoFinalEquivalencia(s, 19);
    expect(h.estado).toBe("equivalencia");
    if (h.estado !== "equivalencia") throw new Error("Histórico não validado");
    expect(h.snapshot).toEqual(s);
  });
});

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

  it.each(["item", "snapshot"] as const)("barra só pela base persistida inválida no %s", async (alvo) => {
    const invalida = { ...provenienciaDimensional, custo_unitario_consumo: 100 };
    const orcamento = structuredClone(orcamentoRevisado);
    if (alvo === "item") orcamento.orcamento_itens[0].valor_snapshot.proveniencia_dimensional = [invalida];
    else orcamento.custo_snapshot.linhas[0].proveniencia_dimensional = [invalida];
    state.orcamentos = [orcamento];
    await expect(emitir()).rejects.toThrow(/erro_emissao=.*reconstru/);
    expect(rpc).not.toHaveBeenCalled();
    expect(state.inserts).toEqual([]);
    expect(state.updates).toEqual([]);
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
    const orcamento = structuredClone(orcamentoRevisado);
    const zero = { ...provenienciaDimensional, custo_unitario_estoque: 0, custo_unitario_consumo: 0 };
    orcamento.custo_snapshot.linhas[0].proveniencia_dimensional = [zero];
    Object.assign(orcamento.orcamento_itens[0], {
      custo_unitario: 0, preco_unitario: 0, valor_snapshot: { proveniencia_dimensional: [zero] },
    });
    state.orcamentos = [orcamento];
    await expect(emitir()).rejects.toThrow(/erro_emissao=Itens%20com%20custo/);
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
