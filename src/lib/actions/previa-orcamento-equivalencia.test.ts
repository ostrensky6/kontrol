import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previaNovoOrcamentoEquivalencia } from "./previa-orcamento-equivalencia";

const mocks = vi.hoisted(() => ({ createClientUntyped: vi.fn(), legado: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped: mocks.createClientUntyped }));
vi.mock("@/lib/costing/loader", () => ({ calcularTodas: mocks.legado, calcularItemAnaliseOrcamento: mocks.legado }));

const input = { codigo_analise: "A1", numero_amostras: 3, metodo_revisao_ref: "metodo:M1:r2" };
const flag = "KONTROL_EQUIVALENCIA_PREVIA";
const alternativa = (id: number, custo: number, fator: number) => ({
  insumo_id: id, custo_padrao: custo, custo_medio_ponderado: null,
  unidade_estoque: "frasco", unidade_consumo: "reação", fator_conversao: fator,
  custo_origem: custo > 0 ? custo : null, fonte_custo: custo > 0 ? "custo_padrao_fallback" : "indisponivel",
  referencia_custo: custo > 0 ? `insumos:${id}` : null,
});
const decisao = (insumo_id: number, fator_conversao: number) => ({
  codigo_analise: "A1", necessidade_id: 11, etapa_id: 21, metodo_revisao_ref: input.metodo_revisao_ref,
  equipamento_ref: null as string | null, insumo_id, apresentacao_ref: `apresentacao:${insumo_id}:r1`,
  decisao_ref: `equivalencia:${insumo_id}`, evidencia_ref: "laudo:r1",
  validador_id: `ator-decisao:${"a".repeat(32)}`, papel_validador: "laboratorio",
  estado: "validada", unidade_estoque: "frasco", unidade_consumo: "reação", fator_conversao,
  vigente_desde: 100, vigente_ate: null as number | null,
});
type Row = Record<string, unknown>;
let tabelas: Record<string, Row[]>;
let fonte: { versao: string; estado: string; instante: number; decisoes: ReturnType<typeof decisao>[] };
let negar: string;
let falhar: string;
let truncar: string;
let pessoal: unknown;
let mudarNaRevalidacao: boolean;
const rpc = vi.fn();
const consultas = vi.fn();

beforeEach(() => {
  vi.stubEnv(flag, "1");
  negar = ""; falhar = ""; truncar = ""; pessoal = 0; mudarNaRevalidacao = false;
  fonte = { versao: "equivalencia-contextual-v1", estado: "disponivel", instante: 1000,
    decisoes: [decisao(91, 100), decisao(92, 30)] };
  tabelas = {
    analises: [{ codigo: "A1", ativo: true, ofertavel: true }],
    insumo_analise: [{ id: 11, codigo_analise: "A1", etapa_id: 21, unidade: "reação",
      quantidade_por_amostra: 2, modo_cobranca: "por_execucao", base_calculo: null, grupo_escolha: null }],
    etapas: [{ id: 21, codigo_analise: "A1", nome_etapa: "Preparo", nome_atividade: "Mistura",
      escopo_operacional: "laboratorio", execucoes_por_dia: 1, amostras_por_execucao: 2, tempo_maquina_h: 0, tempo_bancada_h: 0 }],
    parametros: Object.entries({ dias_uteis_ano: 222, margem_lucro: 0, impostos: 0, taxas: 0,
      fundo_reserva: 0, fundo_investimento: 0 }).map(([chave, valor]) => ({ chave, valor })),
    overhead: [], equipamento_analise: [], equipamentos: [],
    insumos: [{ id: 91, ativo: true, unidade: "frasco", unidade_consumo: "reação", fator_conversao: 100 },
      { id: 92, ativo: true, unidade: "frasco", unidade_consumo: "reação", fator_conversao: 30 }],
    v_custo_estoque_vigente: [alternativa(91, 150, 100), alternativa(92, 90, 30)],
  };
  let leiturasFonte = 0;
  rpc.mockReset().mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === falhar) return { data: null, error: { code: "42501", message: "privado" } };
    if (name === "tem_permissao") return { data: args.p_chave !== negar, error: null };
    if (name === "valor_hora_pessoal_total") return { data: pessoal, error: null };
    if (name === "ler_equivalencia_contextual_v1") {
      const data = structuredClone(fonte);
      if (++leiturasFonte > 1 && mudarNaRevalidacao) data.decisoes[1].estado = "revogada";
      return { data, error: null };
    }
    throw new Error(`RPC não autorizada pelo teste: ${name}`);
  });
  consultas.mockReset();
  mocks.legado.mockReset();
  mocks.createClientUntyped.mockReset().mockImplementation(async () => ({
    rpc,
    from(table: string) {
      if (!(table in tabelas)) throw new Error(`Tabela não prevista: ${table}`);
      const filtros: ((row: Row) => boolean)[] = [];
      const query = {
        select(campos: string, opts: { count: string }) {
          consultas(table, campos, opts);
          expect(opts).toEqual({ count: "exact" });
          return query;
        },
        eq(campo: string, valor: unknown) { filtros.push((r) => r[campo] === valor); return query; },
        in(campo: string, valores: unknown[]) { filtros.push((r) => valores.includes(r[campo])); return query; },
        then(resolve: (result: { data: Row[]; error: unknown; count: number }) => unknown) {
          const data = structuredClone(tabelas[table].filter((r) => filtros.every((f) => f(r))));
          return Promise.resolve(resolve({ data, count: data.length + (table === truncar ? 1 : 0),
            error: table === falhar ? { message: "privado" } : null }));
        },
      };
      return query;
    },
  }));
});
afterEach(() => {
  expect(mocks.legado).not.toHaveBeenCalled();
  expect(rpc.mock.calls.every(([name]) => ["tem_permissao", "ler_equivalencia_contextual_v1", "valor_hora_pessoal_total"].includes(name))).toBe(true);
  vi.unstubAllEnvs();
});

describe("prévia servidor -> fonte 0154 -> motor contextual real", () => {
  it.each([undefined, "", "0", "true"])("não lê a sessão sem opt-in literal: %s", async (flagValue) => {
    vi.stubEnv(flag, flagValue);
    expect(await previaNovoOrcamentoEquivalencia(input)).toMatchObject({ estado: "pendente", pendencias: [{ motivo: "desabilitada" }] });
    expect(mocks.createClientUntyped).not.toHaveBeenCalled();
  });

  it.each([
    { ...input, numero_amostras: 0 }, { ...input, metodo_revisao_ref: "" },
    { ...input, decisoes: [decisao(91, 100)] }, { ...input, preco: 0 },
    { ...input, loteAmostras: 200 }, { ...input, ator_id: "admin" }, { ...input, equipamento_id: 31 },
  ])("recusa entrada cliente além de ID/quantidade/revisão (%j)", async (value) => {
    expect(await previaNovoOrcamentoEquivalencia(value)).toMatchObject({ estado: "pendente", pendencias: [{ motivo: "entrada_invalida" }] });
    expect(mocks.createClientUntyped).not.toHaveBeenCalled();
  });

  it.each(["orcamentos.criar_editar", "custeio.ver", "tecnicos.salario.ver"])("respeita permissão efetiva %s", async (chave) => {
    negar = chave;
    expect(await previaNovoOrcamentoEquivalencia(input)).toMatchObject({ estado: "pendente", pendencias: [{ motivo: "sem_permissao" }] });
    expect(consultas).not.toHaveBeenCalled();
  });

  it("usa preço convertido maior, IDs e lote persistidos; não grava nem chama loader legado", async () => {
    const antes = JSON.stringify(tabelas);
    expect(await previaNovoOrcamentoEquivalencia(input)).toMatchObject({
      versao: "equivalencia-contextual-v1", finalidade: "previa_novo_orcamento", persistivel: false, estado: "calculado",
      calculo: { totais: { reagentes: 12, custoTotal: 12, preco: 12 } },
      selecao: [{ necessidade_id: 11, etapa_id: 21, insumo_id: 92, decisao_ref: "equivalencia:92",
        quantidade_consumo: 4, quantidade_estoque: 4 / 30, custo_total_insumo: 12 }],
    });
    expect(rpc).toHaveBeenCalledWith("ler_equivalencia_contextual_v1", { p_codigo: "A1", p_metodo_revisao_ref: "metodo:M1:r2" });
    expect(JSON.stringify(tabelas)).toBe(antes);
  });

  it("mantém zero comprovado e usa média de lotes da view sem fallback silencioso", async () => {
    fonte.decisoes = [decisao(91, 100)];
    tabelas.v_custo_estoque_vigente = [alternativa(91, 0, 100)];
    expect(await previaNovoOrcamentoEquivalencia(input)).toMatchObject({ estado: "calculado", calculo: { totais: { custoTotal: 0 } } });
    Object.assign(tabelas.v_custo_estoque_vigente[0], { custo_medio_ponderado: 300, custo_origem: 300,
      fonte_custo: "custo_medio_ponderado", referencia_custo: "lotes_estoque_liberados" });
    expect(await previaNovoOrcamentoEquivalencia(input)).toMatchObject({ estado: "calculado", calculo: {
      totais: { custoTotal: 12 }, provenienciaDimensional: [{ custo_unitario_estoque: 300, custo_unitario_consumo: 3, fonte_custo: "custo_medio_ponderado" }],
    } });
  });

  it("compõe equipamento vinculado, pessoal, overhead e parâmetros lidos no servidor", async () => {
    fonte.decisoes.forEach((d) => { d.equipamento_ref = "equipamento:31"; });
    tabelas.equipamento_analise = [{ codigo_analise: "A1", equipamento_id: 31, peso_alocacao: 1 }];
    tabelas.equipamentos = [{ id: 31, quantidade: 1, custo_unitario: 444, vida_util_anos: 1,
      percentual_manutencao_anual: 0, manutencao_anual_fixa: 0 }];
    tabelas.etapas[0].tempo_bancada_h = 1;
    pessoal = 10;
    tabelas.overhead = [{ custo_mensal: 100, horas_bancada_mes: 10, percentual_compensada: 50 }];
    tabelas.parametros.find((p) => p.chave === "margem_lucro")!.valor = 10;
    expect(await previaNovoOrcamentoEquivalencia(input)).toMatchObject({ estado: "calculado", calculo: {
      totais: { reagentes: 12, equipamento: 3, pessoal: 20, overhead: 10, custoTotal: 45, preco: 49.50000000000001 },
    } });
  });

  it.each(["revogada", "vencida", "futura", "outro_metodo", "dimensao"])("não calcula equivalência inválida: %s", async (modo) => {
    fonte.decisoes = [decisao(91, 100)];
    if (modo === "revogada") fonte.decisoes[0].estado = "revogada";
    if (modo === "vencida") fonte.decisoes[0].vigente_ate = 1000;
    if (modo === "futura") fonte.decisoes[0].vigente_desde = 1001;
    if (modo === "outro_metodo") fonte.decisoes[0].metodo_revisao_ref = "metodo:outro";
    if (modo === "dimensao") fonte.decisoes[0].fator_conversao = 10;
    const result = await previaNovoOrcamentoEquivalencia(input);
    expect(result.estado).toBe("pendente");
    expect(result).not.toHaveProperty("calculo");
  });

  it.each(["ler_equivalencia_contextual_v1", "valor_hora_pessoal_total", "parametros", "insumo_analise", "v_custo_estoque_vigente"])("nega erro de fonte %s", async (name) => {
    falhar = name;
    expect(await previaNovoOrcamentoEquivalencia(input)).toMatchObject({ estado: "pendente" });
  });

  it.each(["parametros", "insumo_analise", "etapas", "insumos", "v_custo_estoque_vigente"])("não aceita conjunto truncado: %s", async (table) => {
    truncar = table;
    expect(await previaNovoOrcamentoEquivalencia(input)).toMatchObject({ estado: "pendente" });
  });

  it.each(["sem_preco", "sem_sku", "sem_receita", "sem_parametro", "lote_nulo", "grupo", "base", "pessoal_nulo", "sem_oferta", "equipamento", "contextos"])("bloqueia lacuna sem inventar zero: %s", async (caso) => {
    if (caso === "sem_preco") tabelas.v_custo_estoque_vigente[1].custo_padrao = null;
    if (caso === "sem_sku") tabelas.insumos.pop();
    if (caso === "sem_receita") tabelas.insumo_analise = [];
    if (caso === "sem_parametro") tabelas.parametros.pop();
    if (caso === "lote_nulo") tabelas.etapas[0].amostras_por_execucao = null;
    if (caso === "grupo") tabelas.insumo_analise[0].grupo_escolha = "mesmo_nome";
    if (caso === "base") tabelas.insumo_analise[0].base_calculo = "por_placa";
    if (caso === "pessoal_nulo") pessoal = null;
    if (caso === "sem_oferta") tabelas.analises[0].ofertavel = false;
    if (caso === "equipamento") fonte.decisoes.forEach((d) => { d.equipamento_ref = "equipamento:31"; });
    if (caso === "contextos") fonte.decisoes[1].equipamento_ref = "equipamento:31";
    const result = await previaNovoOrcamentoEquivalencia(input);
    expect(result.estado).toBe("pendente");
    expect(result).not.toHaveProperty("calculo");
  });

  it("recusa contexto divergente", async () => {
    fonte.estado = "contexto_divergente";
    expect(await previaNovoOrcamentoEquivalencia(input)).toMatchObject({ estado: "pendente", pendencias: [{ motivo: "contexto_divergente" }] });
  });

  it("recusa revogação observada ao terminar a prévia", async () => {
    mudarNaRevalidacao = true;
    expect(await previaNovoOrcamentoEquivalencia(input)).toMatchObject({ estado: "pendente", pendencias: [{ motivo: "contexto_alterado_durante_previa" }] });
  });
});
