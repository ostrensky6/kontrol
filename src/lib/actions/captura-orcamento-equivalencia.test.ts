import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capturarNovoOrcamentoEquivalencia } from "./captura-orcamento-equivalencia";
import { calcularOrcamentoEquivalencia, type EntradaEquivalencia } from "../costing/equivalencia-orcamento";

const { rpc, createClientUntyped, temPermissao } = vi.hoisted(() => ({ rpc: vi.fn(), createClientUntyped: vi.fn(), temPermissao: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped }));
vi.mock("@/lib/auth/permissao-efetiva", () => ({ temPermissao }));
const flag = "KONTROL_EQUIVALENCIA_CAPTURA";
const input = { versao: "equivalencia-economica-v1", orcamento_id: 7, revisao_esperada: 2,
  operacao_id: "11111111-1111-4111-8111-111111111111", metodos: { A1: "metodo:r1" } };
const recibo = { versao: input.versao, orcamento_id: 7, operacao_id: input.operacao_id,
  revisao_anterior: 2, revisao_aplicada: 3, quantidade_itens: 1, custo_total: 12, preco_total: 12,
  snapshot_hash: "a".repeat(32), replay: false };
beforeEach(() => {
  vi.stubEnv(flag, "1"); rpc.mockReset().mockResolvedValue({ data: recibo, error: null });
  createClientUntyped.mockReset().mockResolvedValue({ rpc }); temPermissao.mockReset().mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe("captura econômica: contrato da action (RPC mockada, não prova SQL)", () => {
  it.each([undefined, "", "0", "true"])("desabilitada por padrão: %s", async (flagValue) => {
    vi.stubEnv(flag, flagValue);
    expect(await capturarNovoOrcamentoEquivalencia(input)).toMatchObject({ ok: false, motivo: "desabilitada" });
    expect(createClientUntyped).not.toHaveBeenCalled();
  });
  it.each([
    { ...input, custo_total: 0 }, { ...input, snapshot: {} }, { ...input, ator_id: "outro" },
    { ...input, orcamento_id: 0 }, { ...input, operacao_id: "" }, { ...input, revisao_esperada: -1 },
    { ...input, metodos: {} }, { ...input, metodos: { A1: "" } }, { ...input, n_amostras: 1 },
  ])("recusa intenção inválida/preços/ator/quantidades externos", async (value) => {
    expect(await capturarNovoOrcamentoEquivalencia(value)).toMatchObject({ ok: false, motivo: "entrada_invalida" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["orcamentos.criar_editar", "custeio.ver", "tecnicos.salario.ver", "analises.ver", "insumos.ver"])("reautoriza %s", async (negada) => {
    temPermissao.mockImplementation(async (p: string) => p !== negada);
    expect(await capturarNovoOrcamentoEquivalencia(input)).toMatchObject({ ok: false, motivo: "negada" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("uma RPC; só seletores; mesmo UUID e conteúdo no retry", async () => {
    expect(await capturarNovoOrcamentoEquivalencia(input)).toMatchObject({ ok: true, recibo });
    expect(rpc.mock.calls[0]).toEqual(["capturar_orcamento_equivalencia_v1", {
      p_orcamento_id: 7, p_revisao_esperada: 2, p_metodos: input.metodos, p_operacao_id: input.operacao_id,
    }]);
    rpc.mockResolvedValue({ data: { ...recibo, replay: true }, error: null });
    expect(await capturarNovoOrcamentoEquivalencia(input)).toMatchObject({ ok: true, recibo: { replay: true } });
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
  });
  it.each([
    ["42501", "negada", "negada"], ["40001", "CAPTURA_REVISAO_OBSOLETA", "revisao_obsoleta"],
    ["22023", "IDEMPOTENCY_CONFLICT", "identidade_reutilizada"], ["55P03", "lock", "concorrencia"],
    ["22023", "CAPTURA_PRECO_INCOMPLETO", "fonte_pendente"], ["XX000", "falha", "resultado_indeterminado"],
  ])("erro %s/%s não é sucesso", async (code, message, motivo) => {
    rpc.mockResolvedValue({ data: null, error: { code, message } });
    expect(await capturarNovoOrcamentoEquivalencia(input)).toMatchObject({ ok: false, motivo });
  });
  it.each([null, { ...recibo, orcamento_id: 8 }, { ...recibo, revisao_aplicada: 4 },
    { ...recibo, custo_total: Infinity }, { ...recibo, quantidade_itens: 2 }, { ...recibo, operacao_id: "22222222-2222-4222-8222-222222222222" }])("não confirma recibo inconsistente", async (value) => {
    rpc.mockResolvedValue({ data: value, error: null });
    expect(await capturarNovoOrcamentoEquivalencia(input)).toMatchObject({ ok: false, motivo: "resultado_indeterminado" });
  });
  it("falha de transporte mantém resultado indeterminado", async () => {
    rpc.mockRejectedValue(new Error("transporte"));
    expect(await capturarNovoOrcamentoEquivalencia(input)).toMatchObject({ ok: false, motivo: "resultado_indeterminado" });
  });
});

describe("0163: inspeção estática, não execução PostgreSQL", () => {
  const sql = readFileSync("supabase/migrations/0163_captura_economica_equivalencia.sql", "utf8");
  it("recebe seletores; resolve custo e contexto por fontes reais", () => {
    expect(sql).toContain("public.v_custo_estoque_vigente");
    expect(sql).toContain("public.ler_equivalencia_contextual_v1(p_codigo,p_metodo)");
    expect(sql).toContain("bruto/i.fator_conversao::double precision");
    expect(sql).toContain("total>(melhor->>'custo_total_insumo')::double precision");
    expect(sql).not.toMatch(/p_(custo|preco|snapshot|itens)\s+(?:jsonb|numeric)/);
  });
  it("reautoriza antes do replay; grava efeito antes do recibo na mesma função", () => {
    expect(sql.indexOf("exigir_permissao('orcamentos.criar_editar')")).toBeLessThan(sql.indexOf("select * into anterior"));
    expect(sql.indexOf("perform public.salvar_item_orcamento")).toBeLessThan(sql.indexOf("insert into kontrol_private.orcamento_capturas_equivalencia values"));
    expect(sql).toContain("anterior.ator_id<>ator or anterior.entrada is distinct from entrada");
    expect(sql).toContain("before update or delete or truncate");
  });
  it("inclui locks de conjunto e recusa fonte incompleta; não invoca ORD26", () => {
    expect(sql).toContain("public.overhead,public.lotes_estoque,kontrol_private.equivalencia_insumos_decisoes in share mode nowait");
    expect(sql).toContain("CAPTURA_FONTE_INCOMPLETA");
    expect(sql).not.toMatch(/(?:perform|select)\s+public\.(?:aprovar|emitir|gerar_planejamento|transicionar)/i);
    expect(sql).not.toMatch(/create or replace|disable trigger|drop table|truncate table/i);
  });
  it("fixture futura tem oráculo numérico independente consistente com o motor aprovado", () => {
    const alternativas = [{ insumo_id: 91, custo_unitario_estoque: 150, fator_conversao: 100 },
      { insumo_id: 92, custo_unitario_estoque: 90, fator_conversao: 30 }].map((i) => ({ ...i,
      apresentacao_ref: `apresentacao:${i.insumo_id}:r1`, unidade_estoque: "frasco", unidade_consumo: "reação",
      fonte_custo: "custo_padrao_fallback", referencia_custo: `insumos:${i.insumo_id}`,
    }));
    const args: EntradaEquivalencia = {
      versao: "equivalencia-contextual-v1", codigo: "TS-ORD163-A", numeroAmostras: 3, metodo_revisao_ref: "metodo:163:r1", instante: 1000,
      etapas: [{ id: 21, nome_etapa: "Preparo", nome_atividade: "Mistura", execucoes_por_dia: 1,
        amostras_por_execucao: 2, tempo_bancada_h: 0.25, tempo_maquina_h: 0 }],
      equip: [{ peso: 1, custoDia: 1 }], valorHoraPessoal: 10, custoHoraOverhead: 1,
      params: { dias_uteis_ano: 222, margem_lucro: 10, impostos: 5, taxas: 0, fundo_reserva: 0, fundo_investimento: 0 },
      necessidades: [{ id: 11, etapa_id: 21, equipamento_ref: null, quantidade_por_base: 2,
        modo_cobranca: "por_execucao", unidade_consumo: "reação", alternativas }],
      decisoes: alternativas.map((a) => ({ ...a, codigo_analise: "TS-ORD163-A", necessidade_id: 11, etapa_id: 21,
        equipamento_ref: null, metodo_revisao_ref: "metodo:163:r1", decisao_ref: `equivalencia:${a.insumo_id}`,
        evidencia_ref: "laudo:163:r1", validador_id: "ator:163", papel_validador: "laboratorio", estado: "validada",
        vigente_desde: 1, vigente_ate: null })),
    };
    const r = calcularOrcamentoEquivalencia(args);
    expect(r.estado).toBe("calculado");
    if (r.estado !== "calculado") throw new Error("Oráculo do motor pendente");
    expect(r.calculo.totais).toMatchObject({ reagentes: 12, equipamento: 1.5, pessoal: 5, overhead: 0.5, custoTotal: 19 });
    expect(r.calculo.totais.preco).toBeCloseTo(21.85, 9);
    expect(r.selecao[0]).toMatchObject({ insumo_id: 92, quantidade_consumo: 4, quantidade_estoque: 4 / 30 });
    expect(r.calculo.provenienciaDimensional?.[0].quantidade_consumo).toBe(2);
    const fixture = readFileSync("supabase/tests/captura_economica_equivalencia_0163.sql", "utf8");
    expect(fixture).toContain("(r->>'custo_total')::numeric-19");
    expect(fixture).toContain("(r->>'preco_total')::numeric-21.85");
    expect(fixture).toContain("raise exception '0163: efeito parcial'");
    expect(fixture).toContain("rollback;");
  });
});

describe("ORD160: origem privada da guarda (somente inspeção estática)", () => {
  const sql = readFileSync("supabase/migrations/0163_captura_economica_equivalencia.sql", "utf8");
  const guarda = sql.slice(sql.indexOf("create function kontrol_private.proteger_modo_captura_equivalencia()"));
  const fixture = readFileSync("supabase/tests/captura_economica_equivalencia_0163.sql", "utf8");
  it("protege OLD e NEW em snapshots de orçamento e item, inclusive primeira entrada", () => {
    expect(guarda).toContain("to_jsonb(new)->'custo_snapshot'->>'versao'");
    expect(guarda).toContain("to_jsonb(old)->'custo_snapshot'->>'versao'");
    expect(guarda).toContain("to_jsonb(new)->'valor_snapshot'->>'versao'");
    expect(guarda).toContain("to_jsonb(old)->'valor_snapshot'->>'versao'");
    expect(guarda).toContain("before insert or delete or update of custo_snapshot,fonte_custo_insumos");
  });
  it("não autoriza por owner/GUC; exige origem privada ligada à transação/ator/alvo", () => {
    expect(guarda).not.toMatch(/fn_marcador_transacional_autorizado|current_user|current_setting/);
    expect(guarda).toContain("security definer");
    expect(guarda).toContain("kontrol_private.orcamento_captura_em_curso");
    expect(guarda).toContain("backend_pid=pg_backend_pid()");
    expect(guarda).toContain("transacao_id=txid_current()");
    expect(guarda).toContain("ator_id=auth.uid()");
    expect(sql).toContain("revoke all on kontrol_private.orcamento_captura_em_curso from public,anon,authenticated,service_role");
    expect(sql).toContain("alter table kontrol_private.orcamento_captura_em_curso enable row level security");
  });
  it("abre origem após calcular, fecha antes de retornar; guarda compara saída esperada", () => {
    const captura = sql.slice(sql.indexOf("create function public.capturar_orcamento_equivalencia_v1("), sql.indexOf("create function kontrol_private.proteger_modo_captura_equivalencia()"));
    expect(captura).not.toContain("app.orcamento_equivalencia_operacao");
    const abertura = captura.indexOf("insert into kontrol_private.orcamento_captura_em_curso");
    const escrita = captura.indexOf("perform public.salvar_item_orcamento");
    const recibo = captura.indexOf("insert into kontrol_private.orcamento_capturas_equivalencia values");
    const fechamento = captura.indexOf("delete from kontrol_private.orcamento_captura_em_curso");
    expect(abertura).toBeGreaterThan(captura.indexOf("snap:=jsonb_build_object"));
    expect(escrita).toBeGreaterThan(abertura);
    expect(fechamento).toBeGreaterThan(recibo);
    expect(captura.indexOf("return recibo;")).toBeGreaterThan(fechamento);
    expect(guarda).toContain("origem.snapshot");
    expect(guarda).toContain("jsonb_array_elements(origem.snapshot->'itens')");
    expect(guarda).toContain("novo->'valor_snapshot'");
  });
  it("fixture negativa preserva item/orçamento/ledger e exercita owner comum/GUC forjada", () => {
    for (const caso of ["entrada_snapshot", "entrada_item", "regravacao", "saida", "guc_forjada", "legado_preservado"]) {
      expect(fixture).toContain(`ORD160:${caso}`);
    }
    expect(fixture).toContain("create function pg_temp.estado160()");
    expect(fixture).toContain("to_jsonb(o)");
    expect(fixture).toContain("to_jsonb(i)");
    expect(fixture).toContain("to_jsonb(c)");
    expect(fixture).toContain("origem privada residual");
    expect(fixture).toContain("proowner");
  });
});
