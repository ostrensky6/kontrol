import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lerContextoCapturaEquivalencia, lerHistoricoCapturaEquivalencia, prepararIntencaoCapturaEquivalencia } from "./captura-equivalencia-leitura";

const { rpc, createClientUntyped, temPermissao } = vi.hoisted(() => ({ rpc: vi.fn(), createClientUntyped: vi.fn(), temPermissao: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped }));
vi.mock("@/lib/auth/permissao-efetiva", () => ({ temPermissao }));
const versao = "captura-economica-leitura-v1";
const op = "11111111-1111-4111-8111-111111111111";
const ctxRef = `captura-contexto:${"a".repeat(32)}`;
const flag = "KONTROL_EQUIVALENCIA_CAPTURA";
const input = { contexto_ref: ctxRef, intencao: { versao: "equivalencia-economica-v1", orcamento_id: 7,
  revisao_esperada: 2, operacao_id: op, metodos: { A1: "metodo:r1" } } };
function recibo() {
  return { versao: "equivalencia-economica-v1", operacao_id: op, orcamento_id: 7, revisao_anterior: 2,
    revisao_aplicada: 3, quantidade_itens: 1, custo_total: 19, preco_total: 21.85, snapshot_hash: "a".repeat(32), replay: false };
}
function contexto() {
  return { versao, estado: "contexto", orcamento_id: 7, demanda: { id: 5, titulo: "Sintético", modalidade: "analises" },
    modulo: "laboratorio", revisao: 2 as number | null, status: "rascunho", status_operacional: "preenchido",
    modo: "sem_captura", edicao_legada_bloqueada: false, contexto_ref: ctxRef,
    itens: [{ id: 9, codigo_analise: "A1", n_amostras: 3 as number | null, custo_unitario: null, preco_unitario: null,
      valor_snapshot: null, metodos_documentados: [{ metodo_revisao_ref: "metodo:r1", estado_validacoes: "disponivel",
        contexto_ref: "b".repeat(32), tem_validacao_vigente: true,
        referencias: [{ decisao_ref: "equivalencia:81", evidencia_ref: "laudo:r1", necessidade_id: 11,
          estado: "validada", vigente_desde: 1000, vigente_ate: null }] }] }],
    capacidades: { consultar: true, preparar_intencao: true }, referencias_documentais: "atestacao_explicita_sem_catalogo_de_revisoes",
    fontes_economicas: "nao_verificadas", cas_escrita: "custo_revisao", historico: [] as Array<{ operacao_id: string; criado_em: string; recibo: ReturnType<typeof recibo> }>,
    historico_total: 0, historico_truncado: false };
}
function historico() {
  const proveniencia = { insumo_id: 91, necessidade_id: 11, etapa_id: null, unidade_estoque: "frasco", unidade_consumo: "reação",
    fator_conversao: 30, fonte_custo: "custo_medio_ponderado", referencia_custo: "lotes_estoque_liberados",
    custo_unitario_estoque: 90, custo_unitario_consumo: 3, quantidade_consumo: 2, quantidade_estoque: 2 / 30,
    quantidade_total_consumo: 4, quantidade_total_estoque: 4 / 30, custo_total_insumo: 12,
    modo_cobranca: "por_execucao", lote: 2, decisao: { decisao_ref: "equivalencia:81", evidencia_ref: "laudo:r1", metodo_revisao_ref: "metodo:r1" } };
  const totais = { reagentes: 12, equipamento: 1.5, pessoal: 5, overhead: .5, custoAnalitico: 18.5, custoTotal: 19, preco: 21.85 };
  return { versao, estado: "historico", orcamento_id: 7, demanda_id: 5, operacao_id: op, criado_em: "2026-11-07T12:00:00Z", hash_confere: true,
    recibo: recibo(), snapshot: { versao: "equivalencia-economica-v1", operacao_id: op, gerado_em: "2026-11-07T12:00:00Z",
      fonte_custo_insumos: "custo_medio_ponderado", itens: [{ codigo_analise: "A1", n_amostras: 3, custo_unitario: 19 / 3, preco_unitario: 21.85 / 3,
        valor_snapshot: { versao: "equivalencia-economica-v1", metodo_revisao_ref: "metodo:r1", fonte_custo_insumos: "custo_medio_ponderado",
          lote_padrao: 2, numero_execucoes: 2, composicao: { reagentes: 4, equipamento: .5, pessoal: 5 / 3, overhead: .5 / 3,
            custoAnalitico: 18.5 / 3, custoTotal: 19 / 3, preco: 21.85 / 3 }, composicao_totais: totais,
          proveniencia_dimensional: [proveniencia], selecao: [{ insumo_id: 91, custo_total_insumo: 12 }], fontes: { etapas: [], parametros: { margem: 15 } } } }],
      linhas: [{ codigo_analise: "A1", quantidade: 3, custo: 19, preco: 21.85, proveniencia_dimensional: [proveniencia] }],
      totais: { custo: 19, preco: 21.85, amostras: 3, reagentes: 12, equipamentos: 1.5, mao_obra: 5, overhead: .5 } } };
}
beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: contexto(), error: null });
  createClientUntyped.mockReset().mockResolvedValue({ rpc }); temPermissao.mockReset().mockResolvedValue(true);
  vi.stubEnv(flag, "0");
});
afterEach(() => {
  expect(rpc.mock.calls.every(([name]) => name === "ler_captura_orcamento_equivalencia_v1")).toBe(true);
  vi.unstubAllEnvs();
});

describe("ORD162 — leitura e preparação sem escrita (RPC mockada)", () => {
  it("retorna composição/quantidade persistidas, referência documental e flag off, sem transformar null em zero", async () => {
    expect(await lerContextoCapturaEquivalencia(7)).toEqual({ ...contexto(), captura_habilitada: false });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("ler_captura_orcamento_equivalencia_v1", { p_orcamento_id: 7, p_operacao_id: null });
  });
  it.each([0, -1, 1.5, NaN, Infinity])("recusa identificador não confirmado %s sem RPC", async (id) => {
    expect(await lerContextoCapturaEquivalencia(id)).toMatchObject({ estado: "indisponivel", motivo: "entrada_invalida" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["orcamentos.visualizar", "custeio.ver", "tecnicos.salario.ver"])("nega falta de %s antes do cliente", async (negada) => {
    temPermissao.mockImplementation(async (p: string) => p !== negada);
    expect(await lerContextoCapturaEquivalencia(7)).toMatchObject({ estado: "negado", motivo: "sem_permissao" });
    expect(createClientUntyped).not.toHaveBeenCalled();
  });
  it.each([["42501", "negado", "sem_permissao"], ["P0002", "indisponivel", "nao_localizado"], ["08006", "indisponivel", "falha_de_leitura"]])(
    "preserva falha real %s sem dados elegíveis", async (code, estado, motivo) => {
      rpc.mockResolvedValue({ data: null, error: { code, message: "não vazar detalhe" } });
      expect(await lerContextoCapturaEquivalencia(7)).toEqual({ versao, estado, motivo });
    });
  it("distingue vazio confirmado de limite e erro de transporte", async () => {
    const c = contexto(); c.itens = []; c.capacidades.preparar_intencao = false;
    rpc.mockResolvedValueOnce({ data: c, error: null });
    expect(await lerContextoCapturaEquivalencia(7)).toMatchObject({ estado: "contexto", itens: [], capacidades: { preparar_intencao: false } });
    rpc.mockResolvedValueOnce({ data: { versao, estado: "indisponivel", motivo: "limite_contexto" }, error: null });
    expect(await lerContextoCapturaEquivalencia(7)).toMatchObject({ motivo: "limite_contexto" });
    rpc.mockRejectedValueOnce(new Error("segredo"));
    expect(await lerContextoCapturaEquivalencia(7)).toEqual({ versao, estado: "indisponivel", motivo: "falha_de_leitura" });
  });
  it.each(["outro_id", "sem_revisao", "sem_quantidade", "itens_duplicados", "modo_inconsistente", "sem_referencia", "evidencia_vazia", "historico_truncado"])(
    "recusa contexto incoerente: %s", async (caso) => {
      const c = contexto();
      if (caso === "outro_id") c.orcamento_id = 8;
      if (caso === "sem_revisao") c.revisao = null;
      if (caso === "sem_quantidade") c.itens[0].n_amostras = null;
      if (caso === "itens_duplicados") c.itens.push(c.itens[0]);
      if (caso === "modo_inconsistente") c.modo = "equivalencia";
      if (caso === "sem_referencia") c.itens[0].metodos_documentados = [];
      if (caso === "evidencia_vazia") c.itens[0].metodos_documentados[0].referencias = [];
      if (caso === "historico_truncado") c.historico_total = 21;
      rpc.mockResolvedValue({ data: c, error: null });
      expect(await lerContextoCapturaEquivalencia(7)).toMatchObject({ motivo: "contrato_invalido" });
    });
  it("separa modo atual, recibo histórico e bloqueio de edição legada", async () => {
    const c = contexto(); c.modo = "equivalencia"; c.edicao_legada_bloqueada = true; c.revisao = 3;
    c.historico = [{ operacao_id: op, criado_em: "2026-11-07T12:00:00Z", recibo: recibo() }]; c.historico_total = 1;
    rpc.mockResolvedValue({ data: c, error: null });
    expect(await lerContextoCapturaEquivalencia(7)).toMatchObject({ modo: "equivalencia", revisao: 3, edicao_legada_bloqueada: true,
      historico: [{ recibo: { revisao_anterior: 2, revisao_aplicada: 3, replay: false } }] });
  });
  it("histórico devolve integralmente snapshot/recibo sem ler custo ou catálogo vivo", async () => {
    const h = historico(); rpc.mockResolvedValue({ data: h, error: null });
    temPermissao.mockImplementation(async (p: string) => !["analises.ver", "insumos.ver", "orcamentos.criar_editar"].includes(p));
    expect(await lerHistoricoCapturaEquivalencia(7, op)).toEqual(h);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("ler_captura_orcamento_equivalencia_v1", { p_orcamento_id: 7, p_operacao_id: op });
  });
  it("ausência de operação é explícita e UUID inválido não consulta", async () => {
    rpc.mockResolvedValue({ data: { versao, estado: "nao_localizada", orcamento_id: 7, operacao_id: op }, error: null });
    expect(await lerHistoricoCapturaEquivalencia(7, op)).toMatchObject({ estado: "nao_localizada" });
    expect(await lerHistoricoCapturaEquivalencia(7, "inválida")).toMatchObject({ motivo: "entrada_invalida" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["orcamento", "operacao", "hash", "total", "revisao", "proveniencia", "quantidade"])("recusa histórico incoerente: %s", async (caso) => {
    const h = historico();
    if (caso === "orcamento") h.recibo.orcamento_id = 8;
    if (caso === "operacao") h.snapshot.operacao_id = "22222222-2222-4222-8222-222222222222";
    if (caso === "hash") h.hash_confere = false;
    if (caso === "total") h.recibo.custo_total = 0;
    if (caso === "revisao") h.recibo.revisao_aplicada = 4;
    if (caso === "proveniencia") h.snapshot.itens[0].valor_snapshot.proveniencia_dimensional = [];
    if (caso === "quantidade") h.snapshot.linhas[0].quantidade = 4;
    rpc.mockResolvedValue({ data: h, error: null });
    expect(await lerHistoricoCapturaEquivalencia(7, op)).toMatchObject({ motivo: "contrato_invalido" });
  });
  it("não prepara com flag off", async () => {
    expect(await prepararIntencaoCapturaEquivalencia(input)).toEqual({ estado: "recusada", motivo: "desabilitada" });
  });
  it("preparação releitura conserva UUID, intenção e CAS; não invoca captura", async () => {
    vi.stubEnv(flag, "1");
    expect(await prepararIntencaoCapturaEquivalencia(input)).toEqual({ estado: "preparada", ...input });
    expect(await prepararIntencaoCapturaEquivalencia(input)).toEqual({ estado: "preparada", ...input });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it.each(["contexto", "revisao", "metodo", "quantidade_externa", "capacidade", "erro"])("invalida preparação %s", async (caso) => {
    vi.stubEnv(flag, "1"); const c = contexto(); const p = structuredClone(input);
    if (caso === "contexto") c.contexto_ref = `captura-contexto:${"b".repeat(32)}`;
    if (caso === "revisao") c.revisao = 3;
    if (caso === "metodo") p.intencao.metodos.A1 = "inventado";
    if (caso === "quantidade_externa") Object.assign(p.intencao, { n_amostras: 4 });
    if (caso === "capacidade") c.capacidades.preparar_intencao = false;
    rpc.mockResolvedValue({ data: c, error: caso === "erro" ? { code: "08006" } : null });
    expect(await prepararIntencaoCapturaEquivalencia(p)).toMatchObject({ estado: "recusada" });
  });
});

describe("0164 — prova estática, SQL NÃO executado", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/0164_leitura_captura_economica.sql", import.meta.url), "utf8");
  it("é apenas reader autenticado, sem DML/cálculo/grant de tabela", () => {
    expect(sql).toContain("stable security definer set search_path = ''");
    expect(sql).toContain("from public,anon,authenticated,service_role");
    expect(sql).toContain("to authenticated");
    expect(sql).not.toMatch(/\b(insert into|update public\.|delete from|grant select|create table|calcular_captura_equivalencia_v1|v_custo_estoque_vigente)\b/i);
  });
  it("revalida sessão/perfil/permissões/RLS antes do orçamento e escopa captura por orçamento+UUID", () => {
    for (const guard of ["auth.sessions", "not suspenso and not senha_provisoria", "orcamentos.visualizar", "custeio.ver",
      "tecnicos.salario.ver", "has_table_privilege", "pg_get_expr", "not p.polpermissive"]) {
      expect(sql.indexOf(guard)).toBeLessThan(sql.indexOf("select * into b from public.orcamentos"));
    }
    expect(sql).toContain("where orcamento_id=b.id and operacao_id=p_operacao_id");
    expect(sql).toContain("md5(captura.snapshot::text)=captura.recibo->>'snapshot_hash'");
  });
  it("retorna histórico antes de consultar referências vivas; não confunde fontes pendentes com elegibilidade", () => {
    expect(sql.indexOf("'snapshot',captura.snapshot")).toBeLessThan(sql.indexOf("fonte := public.ler_equivalencia_contextual_v1"));
    expect(sql).toContain("'fontes_economicas','nao_verificadas'");
    expect(sql).toContain("'cas_escrita','custo_revisao'");
    expect(sql).toContain("'historico_truncado',qtd_historico>20");
    expect(sql).not.toContain("calcularOrcamento");
  });
});
