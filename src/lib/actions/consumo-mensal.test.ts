import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped: m.client }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
import { lerConsumoMensal, operarConsumoMensal } from "./consumo-mensal";
const op = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const base = { configuracao: null, estado: "sem_leitura_comparavel", qualidade: "sem_leitura_comparavel",
  n: 0, media_embalagens_mes: null, meses: [], transicao: null };
const config = { id: 1, insumo_id: 7, inicio: "2026-01-01", fuso: "America/Sao_Paulo", janela: 3,
  minimo_n: 1, comparabilidade: "mes_civil_integral_sem_ruptura_mesma_apresentacao",
  conteudo: 100, unidade: "mL", unidade_consumo: "mL", fator: 1, registrado_em: "2026-01-01T00:00:00Z" };
const executar = { insumo_id: 7, operacao_id: op, acao: "executar", dados: {} };
const capacidades = { configurar: false, certificar: true, executar: false, governanca: true };
const identidade = { operacao_id: op, insumo_id: 7, acao: "executar", ator_id: op, repetida: false, estado_historico: false };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("KONTROL_CONSUMO_MENSAL_ESCRITA_HABILITADA", "1");
  m.client.mockResolvedValue({ auth: { getUser: m.user }, rpc: m.rpc });
  m.user.mockResolvedValue({ data: { user: { id: op } }, error: null });
  m.rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => ({ error: null,
    data: fn === "ler_consumo_mensal_insumo" ? { ...base, manual_vigente: null, capacidades }
      : { ...base, ...identidade, acao: args.p_acao } }));
});
afterEach(() => vi.unstubAllEnvs());
describe("ORD135 consumo mensal", () => {
  it("preserva ausências e não inventa capacidade ou prova documental", async () => {
    expect(await lerConsumoMensal(7)).toMatchObject({ ok: true, configuracao_estado: "AUSENTE",
      natureza_prova: "DECLARACAO_HUMANA_NAO_VERIFICADA_AUTOMATICAMENTE",
      atual: { media_embalagens_mes: null, manual_vigente: null, capacidades } });
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("ler_consumo_mensal_insumo", { p_insumo_id: 7 });
  });
  it.each([undefined, "0", "true", ""])("flag literal bloqueia escrita: %s", async (flag) => {
    vi.stubEnv("KONTROL_CONSUMO_MENSAL_ESCRITA_HABILITADA", flag);
    expect(await operarConsumoMensal(executar)).toMatchObject({ ok: false, codigo: "ESCRITA_DESABILITADA" });
    expect(m.client).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...executar, insumo_id: "7" }, { ...executar, operacao_id: "inválido" },
    { ...executar, dados: { quantidade: 0 } }, { ...executar, service_role: true },
    { ...executar, acao: "certificar", dados: { mes: "2026-02-30" } },
    { ...executar, acao: "governanca", dados: { papel: "admin", acao: "executar", permitido: true, motivo: "x" } },
  ])("nega entrada estrita %j", async (input) => {
    expect(await operarConsumoMensal(input)).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("não acessa RPC sem sessão", async () => {
    m.user.mockResolvedValue({ data: { user: null }, error: null });
    expect(await lerConsumoMensal(7)).toMatchObject({ codigo: "SESSAO_INVALIDA" });
    expect(await operarConsumoMensal(executar)).toMatchObject({ codigo: "SESSAO_INVALIDA" });
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it.each([{ ...base, media_embalagens_mes: 0 }, { ...base, estado: "calculado" },
    { ...base, configuracao: { ...config, insumo_id: 8 } }, { ...base, n: 1 }, null,
  ])("nega leitura incoerente sem defaults %j", async (v) => {
    m.rpc.mockResolvedValue({ data: v === null ? null : { ...v, manual_vigente: null, capacidades }, error: null });
    expect(await lerConsumoMensal(7)).toMatchObject({ codigo: "RESPOSTA_INVALIDA" });
  });
  it("replay é histórico e não encobre reavaliação atual", async () => {
    const transicao = { insumo_id: 7, registrado_em: "2026-02-01T00:00:00Z" };
    const passado = { ...base, configuracao: config, qualidade: "alta", estado: "calculado", n: 1,
      media_embalagens_mes: 0, meses: [{ mes: "2026-01-01", revisao: 1, comparavel: true, quantidade: 0, motivo: "fechado_com_prova" }],
      transicao, ...identidade, repetida: true, estado_historico: true };
    m.rpc.mockResolvedValueOnce({ data: passado, error: null }).mockResolvedValueOnce({ error: null,
      data: { ...base, configuracao: config, transicao, estado: "reavaliacao", manual_vigente: null, capacidades } });
    expect(await operarConsumoMensal(executar)).toMatchObject({ ok: true, estado: "RECIBO_CONFIRMADO",
      recibo: { estado: "calculado", repetida: true }, atual: { ok: true, atual: { estado: "reavaliacao" } } });
    expect(m.rpc.mock.calls.map(([fn]) => fn)).toEqual(["operar_consumo_mensal_insumo", "ler_consumo_mensal_insumo"]);
    expect(m.rpc.mock.calls[0][1]).toEqual({ p_insumo_id: 7, p_operacao_id: op, p_acao: "executar", p_dados: {} });
  });
  it("certifica declaração sem transformar SHA/ref em documento verificado", async () => {
    const dados = { mes: "2026-01-01", cobertura_integral: false, sem_ruptura: false,
      prova_sha256: "a".repeat(64), prova_referencia: "documento sintético" };
    const result = await operarConsumoMensal({ ...executar, acao: "certificar", dados });
    expect(result).toMatchObject({ ok: true, estado: "RECIBO_CONFIRMADO", recibo: { estado_historico: false }, atual: { ok: true } });
    expect(m.rpc.mock.calls[0][1].p_dados).toEqual(dados);
  });
  it("configuração repassa só parâmetros exatos sem calcular taxa", async () => {
    const { id: _id, insumo_id: _insumo, registrado_em: _em, ...dados } = config;
    void _id; void _insumo; void _em;
    await operarConsumoMensal({ ...executar, acao: "configurar", dados });
    expect(m.rpc.mock.calls[0][1].p_dados).toEqual(dados);
  });
  it("governança é global e não fabrica identidade ou capacidades", async () => {
    m.rpc.mockResolvedValueOnce({ data: { ...identidade, estado: "politica_registrada", acao: "governanca", insumo_id: null }, error: null });
    expect(await operarConsumoMensal({ operacao_id: op, insumo_id: null, insumo_leitura_id: 7, acao: "governanca",
      dados: { papel: "gestor", acao: "executar", permitido: false, motivo: "revogação" } }))
      .toMatchObject({ ok: true, recibo: { insumo_id: null, acao: "governanca" }, atual: { ok: true } });
    expect(m.rpc).toHaveBeenCalledTimes(2);
    expect(m.rpc.mock.calls[0][1].p_insumo_id).toBeNull();
    expect(m.rpc.mock.calls[0][1]).not.toHaveProperty("insumo_leitura_id");
  });
  it("falha da releitura não substitui atual pelo histórico", async () => {
    m.rpc.mockResolvedValueOnce({ data: { ...base, ...identidade, repetida: true, estado_historico: true }, error: null }).mockRejectedValueOnce(new Error("timeout"));
    expect(await operarConsumoMensal(executar)).toMatchObject({ ok: true, estado: "RECIBO_CONFIRMADO", atual: { ok: false, codigo: "NAO_CONFIRMADO" } });
  });
  it.each(["42501", "23505", "PGRST202"])("erro %s não vira sucesso nem retry", async (code) => {
    m.rpc.mockResolvedValue({ data: null, error: { code, message: "detalhe privado" } });
    const result = await operarConsumoMensal(executar);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("detalhe privado");
    expect(m.rpc).toHaveBeenCalledTimes(1);
  });
  it("timeout de escrita não presume rollback", async () => {
    m.rpc.mockRejectedValue(new Error("timeout"));
    expect(await operarConsumoMensal(executar)).toMatchObject({ ok: false, codigo: "NAO_CONFIRMADO" });
    expect(m.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, null, {}, { ...capacidades, configurar: "true" }])("capacidade ausente/malformada não vira falsa: %j", async (valor) => {
    m.rpc.mockResolvedValueOnce({ data: { ...base, manual_vigente: null, capacidades: valor }, error: null });
    expect(await lerConsumoMensal(7)).toMatchObject({ ok: false, codigo: "RESPOSTA_INVALIDA" });
  });
  it.each([{ operacao_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }, { ator_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
    { insumo_id: 8 }, { insumo_id: null }, { acao: "certificar" }, { estado_historico: true },
    { operacao_id: undefined }, { repetida: "false" },
  ])("recibo divergente recusado e leitura separada: %j", async (delta) => {
    m.rpc.mockResolvedValueOnce({ data: { ...base, ...identidade, ...delta }, error: null });
    expect(await operarConsumoMensal(executar)).toMatchObject({ ok: false, codigo: "RESPOSTA_INVALIDA", atual: { ok: true } });
    expect(m.rpc.mock.calls.map(([fn]) => fn)).toEqual(["operar_consumo_mensal_insumo", "ler_consumo_mensal_insumo"]);
  });
  it("primeira operação também relê e não ganha poder pela capacidade fotografada", async () => {
    expect(await operarConsumoMensal(executar)).toMatchObject({ ok: true,
      recibo: { repetida: false, estado_historico: false }, atual: { atual: { capacidades: { executar: false } } } });
    expect(m.rpc).toHaveBeenCalledTimes(2);
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect(await operarConsumoMensal(executar)).toMatchObject({ ok: false, codigo: "SEM_ACESSO" });
  });
  it("negação de leitura não é conjunto de capacidades false", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect(await lerConsumoMensal(7)).toMatchObject({ ok: false, codigo: "SEM_ACESSO" });
  });
});
