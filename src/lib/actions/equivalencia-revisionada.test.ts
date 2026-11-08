import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepararEquivalenciaRevisionada, registrarEquivalenciaRevisionada, revogarEquivalenciaRevisionada } from "./equivalencia-revisionada";

const { rpc, createClientUntyped } = vi.hoisted(() => ({ rpc: vi.fn(), createClientUntyped: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped }));
const inicial = { ok: false };
const flag = "KONTROL_EQUIVALENCIA_ESCRITA_REVISIONADA";
const uuid = "11111111-1111-4111-8111-111111111111";
const revisao = `equivalencia-cas-v1:${"a".repeat(32)}`;
const identidade = { versao: "equivalencia-escrita-v1", codigo_analise: "A1", metodo_revisao_ref: "metodo:M1:r2", necessidade_id: 11 };
const preparo = (acao = "registrar") => ({ ...identidade, acao, decisao_ref: acao === "registrar" ? null : "equivalencia:81", revisao_esperada: revisao, cas_escrita: true });
const recibo = (acao = "registrar") => ({ ...identidade, acao, operacao_id: uuid, ator_ref: `ator-operacao:${"b".repeat(32)}`,
  decisao_ref: "equivalencia:81", estado: acao === "registrar" ? "validada" : "revogada", revisao_aplicada: revisao, replay: false });
function form(acao = "registrar") {
  const f = new FormData();
  for (const [k, v] of Object.entries({ ...identidade, necessidade_id: "11", acao, etapa_id: "", insumo_id: "91", equipamento_id: "",
    apresentacao_ref: "apresentacao:91:r1", unidade_estoque: "frasco", unidade_consumo: "reação", fator_conversao: "100",
    evidencia_ref: "laudo:r1", confirmada: "sim", vigente_ate: "", decisao_ref: "equivalencia:81", motivo: "Revisão do método",
    operacao_id: uuid, revisao_esperada: revisao })) f.set(k, v);
  return f;
}
beforeEach(() => {
  vi.stubEnv(flag, "1");
  rpc.mockReset().mockResolvedValue({ data: recibo(), error: null });
  createClientUntyped.mockReset().mockResolvedValue({ rpc });
});
afterEach(() => vi.unstubAllEnvs());

describe("actions novas de equivalência revisionada", () => {
  it.each([undefined, "", "0", "true"])("mantém feature desabilitada sem 1 literal (%s)", async (value) => {
    vi.stubEnv(flag, value);
    for (const [fn, f] of [[prepararEquivalenciaRevisionada, form()], [registrarEquivalenciaRevisionada, form()], [revogarEquivalenciaRevisionada, form("revogar")]] as const) {
      expect(await fn(inicial, f)).toMatchObject({ ok: false, motivo: "desabilitada" });
    }
    expect(createClientUntyped).not.toHaveBeenCalled();
  });
  it("prepara intenção completa pela RPC sem gerar operação nem gravar decisão", async () => {
    rpc.mockResolvedValue({ data: preparo(), error: null });
    const f = form(); f.set("ator_id", "forjado"); f.set("custo_unitario", "0");
    expect(await prepararEquivalenciaRevisionada(inicial, f)).toMatchObject({ ok: true, preparacao: preparo() });
    expect(rpc.mock.calls).toEqual([["preparar_equivalencia_revisionada_v1", { p_acao: "registrar", p_codigo: "A1", p_metodo_revisao_ref: "metodo:M1:r2", p_dados: {
      necessidade_id: 11, etapa_id: null, insumo_id: 91, equipamento_id: null, apresentacao_ref: "apresentacao:91:r1",
      unidade_estoque: "frasco", unidade_consumo: "reação", fator_conversao: 100, evidencia_ref: "laudo:r1", confirmada: true, vigente_ate: null,
    } }]]);
  });
  it("encaminha a mesma revisão/UUID e confirma recibo correlacionado", async () => {
    const f = form();
    expect(await registrarEquivalenciaRevisionada(inicial, f)).toMatchObject({ ok: true, recibo: recibo() });
    expect(rpc).toHaveBeenCalledWith("registrar_equivalencia_revisionada_v1", expect.objectContaining({ p_operacao_id: uuid, p_revisao_esperada: revisao }));
    rpc.mockResolvedValue({ data: { ...recibo(), replay: true }, error: null });
    expect(await registrarEquivalenciaRevisionada(inicial, f)).toMatchObject({ ok: true, recibo: { replay: true, decisao_ref: "equivalencia:81" } });
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
  });
  it("não invalida replay pelo relógio local após fim de vigência", async () => {
    const f = form(); f.set("vigente_ate", "2020-01-01T00:00:00Z");
    rpc.mockResolvedValue({ data: { ...recibo(), replay: true }, error: null });
    expect(await registrarEquivalenciaRevisionada(inicial, f)).toMatchObject({ ok: true, recibo: { replay: true } });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("prepara e revoga o mesmo alvo de histórico dentro do escopo informado", async () => {
    rpc.mockResolvedValueOnce({ data: preparo("revogar"), error: null });
    expect(await prepararEquivalenciaRevisionada(inicial, form("revogar"))).toMatchObject({ ok: true, preparacao: { decisao_ref: "equivalencia:81" } });
    rpc.mockResolvedValueOnce({ data: recibo("revogar"), error: null });
    expect(await revogarEquivalenciaRevisionada(inicial, form("revogar"))).toMatchObject({ ok: true, recibo: { estado: "revogada" } });
    expect(rpc).toHaveBeenLastCalledWith("revogar_equivalencia_revisionada_v1", { p_codigo: "A1", p_metodo_revisao_ref: "metodo:M1:r2",
      p_decisao_id: 81, p_motivo: "Revisão do método", p_operacao_id: uuid, p_revisao_esperada: revisao });
  });
  it.each([['operacao_id', ''], ['operacao_id', 'x'], ['revisao_esperada', 'contexto:abc'], ['revisao_esperada', ''],
    ['necessidade_id', '0'], ['fator_conversao', '0'], ['etapa_id', '-1'], ['confirmada', 'false'], ['versao', 'equivalencia-contextual-v1']])(
    "rejeita entrada inválida %s sem cliente (%s)", async (campo, value) => {
      const f = form(); f.set(campo, value);
      expect(await registrarEquivalenciaRevisionada(inicial, f)).toMatchObject({ ok: false, motivo: "entrada_invalida" });
      expect(createClientUntyped).not.toHaveBeenCalled();
    },
  );
  it("rejeita identidade duplicada no formulário", async () => {
    const f = form(); f.append("operacao_id", uuid);
    expect(await registrarEquivalenciaRevisionada(inicial, f)).toMatchObject({ ok: false, motivo: "entrada_invalida" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    ['42501', 'privado', 'negada'], ['40001', 'EQUIVALENCIA_CONTEXT_STALE', 'contexto_obsoleto'],
    ['22023', 'IDEMPOTENCY_CONFLICT', 'identidade_reutilizada'], ['55P03', 'privado', 'concorrencia'],
    ['40P01', 'privado', 'concorrencia'], ['22023', 'privado', 'entrada_invalida'], ['XX000', 'privado', 'resultado_indeterminado'],
  ])("trata %s sem sucesso falso/retry automático", async (code, message, motivo) => {
    rpc.mockResolvedValue({ data: recibo(), error: { code, message } });
    const r = await registrarEquivalenciaRevisionada(inicial, form());
    expect(r).toMatchObject({ ok: false, motivo }); expect(r).not.toHaveProperty("recibo");
    expect(r.message).not.toContain("privado"); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    { operacao_id: "22222222-2222-4222-8222-222222222222" }, { acao: "revogar" }, { estado: "revogada" },
    { codigo_analise: "A2" }, { metodo_revisao_ref: "outra" }, { necessidade_id: 12 }, { revisao_aplicada: `equivalencia-cas-v1:${"c".repeat(32)}` },
    { ator_ref: "uuid-bruto" }, { ator_id: "vazamento" },
  ])("não confirma recibo incoerente (%j)", async (delta) => {
    rpc.mockResolvedValue({ data: { ...recibo(), ...delta }, error: null });
    expect(await registrarEquivalenciaRevisionada(inicial, form())).toMatchObject({ ok: false, motivo: "resultado_indeterminado" });
  });
  it("não confirma outro alvo na revogação nem CAS fictício na preparação", async () => {
    rpc.mockResolvedValueOnce({ data: { ...recibo("revogar"), decisao_ref: "equivalencia:82" }, error: null });
    expect(await revogarEquivalenciaRevisionada(inicial, form("revogar"))).toMatchObject({ ok: false, motivo: "resultado_indeterminado" });
    rpc.mockResolvedValueOnce({ data: { ...preparo(), cas_escrita: false }, error: null });
    expect(await prepararEquivalenciaRevisionada(inicial, form())).toMatchObject({ ok: false, motivo: "resultado_indeterminado" });
  });
  it("não gera nova identidade nem repete automaticamente depois de falha de transporte", async () => {
    rpc.mockRejectedValueOnce(new Error("transporte"));
    const f = form();
    expect(await registrarEquivalenciaRevisionada(inicial, f)).toMatchObject({ ok: false, motivo: "resultado_indeterminado" });
    expect(f.get("operacao_id")).toBe(uuid);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("0161 estática: ordem e fronteiras, não prova PostgreSQL", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/0161_equivalencia_escrita_revisionada.sql", import.meta.url), "utf8");
  it("reautoriza e bloqueia a operação antes de ler recibo; replay precede novo efeito", () => {
    expect(sql.indexOf("kontrol_private.tem_permissao_efetiva('analises.ver')")).toBeLessThan(sql.indexOf("select * into v_operacao"));
    expect(sql.indexOf("'equivalencia-op:'")).toBeLessThan(sql.indexOf("select * into v_operacao"));
    expect(sql).toContain("v_operacao.ator_id<>v_ator or v_operacao.entrada is distinct from v_entrada");
    expect(sql.indexOf("return v_operacao.recibo")).toBeLessThan(sql.indexOf("v_resultado := kontrol_private.operar_equivalencia_v1"));
    expect(sql).toContain("v_papel not in ('laboratorio','coordenador','supervisor')");
  });
  it("compartilha serialização0154 e trava catálogo antes do CAS/efeito/recibo", () => {
    const lock = sql.indexOf("'equivalencia-v1:'||v_identidade.necessidade_id");
    const compare = sql.indexOf("if v_revisao is distinct from p_revisao_esperada");
    const efeito = sql.indexOf("v_resultado := kontrol_private.operar_equivalencia_v1");
    expect(lock).toBeLessThan(compare);
    expect(sql.indexOf("from public.insumos i where i.id=v_identidade.insumo_id for share nowait")).toBeLessThan(compare);
    expect(compare).toBeLessThan(efeito);
    expect(efeito).toBeLessThan(sql.indexOf("insert into kontrol_private.equivalencia_escrita_operacoes"));
    expect(sql).toContain("where d.necessidade_id=v_identidade.necessidade_id");
    expect(sql).toContain("'ator',v_ator,'acao',p_acao");
    expect(sql).toContain("transaction_isolation");
  });
  it("não substitui legado nem oferece DML/grants amplos e não gera UUID nas actions", () => {
    expect(sql).not.toMatch(/create or replace|drop\s|truncate\s/i);
    expect(sql).toContain("equivalencia_escrita_operacoes enable row level security");
    expect(sql).toContain("from public,anon,authenticated,service_role");
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete|usage|all)\b/i);
    const action = readFileSync(new URL("./equivalencia-revisionada.ts", import.meta.url), "utf8");
    expect(action).not.toContain("randomUUID");
    expect(action).toContain('process.env.KONTROL_EQUIVALENCIA_ESCRITA_REVISIONADA !== "1"');
  });
  it("entrega fixture sintética de falha intermediária e duas sessões, sem executar SQL", () => {
    const fixture = readFileSync(new URL("../../../supabase/tests/equivalencia_escrita_revisionada_0161.sql", import.meta.url), "utf8");
    expect(fixture).toContain("ORD141 exige clone sintético vazio");
    expect(fixture).toContain("ord141_corrida_b");
    expect(fixture).toContain("create trigger teste_falha_recibo141 before insert");
    expect(fixture).toContain("ORD141: efeito parcial persistiu sem recibo");
    expect(fixture).toContain("end $recibos141$;");
    expect(fixture).toContain("end $autorizacao141$;");
    expect(fixture).toContain("rollback;");
  });
});
