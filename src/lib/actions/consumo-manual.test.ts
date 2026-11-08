import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lerConsumoManual, registrarConsumoManual } from "./consumo-manual";

const io = vi.hoisted(() => ({
  client: vi.fn(), rpc: vi.fn(), getUser: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), insumo: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped: io.client }));

const FLAG = "KONTROL_CONSUMO_MANUAL_ESCRITA_HABILITADA";
const READ = "ler_consumo_manual_insumo";
const WRITE = "registrar_consumo_manual_insumo";
const ator = "00000000-0000-4000-8000-000000000001";
const operacao = "00000000-0000-4000-8000-000000000002";
const inicial = { ok: false } as const;
const ok = (data: unknown) => ({ data, error: null });
const registro = {
  insumo_id: 12, revisao: 1, quantidade_embalagens_mes: 0, conteudo_embalagem: 250, unidade_conteudo: "mL",
  fonte: "Caderno do laboratório", motivo: "Estimativa inicial", data_referencia: "2026-11-07",
  ator_id: ator, registrado_em: "2026-11-07T12:00:00+00:00",
};
const nenhuma = { estado: "nenhuma", vigente: null, historico: [], proxima_antes_da_revisao: null };

function form(delta: Record<string, string> = {}) {
  const d = new FormData();
  for (const [k, v] of Object.entries({
    insumo_id: "12", operacao_id: operacao, revisao_esperada: "0", quantidade_embalagens_mes: "0",
    conteudo_embalagem_esperado: "250", unidade_conteudo_esperada: "mL", apresentacao_confirmada: "1",
    fonte: "Caderno do laboratório", motivo: "Estimativa inicial", data_referencia: "2026-11-07", ...delta,
  })) d.set(k, v);
  return d;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv(FLAG, "1");
  io.client.mockResolvedValue({ auth: { getUser: io.getUser }, rpc: io.rpc, from: io.from });
  io.getUser.mockResolvedValue(ok({ user: { id: ator } }));
  io.from.mockReturnValue({ select: io.select });
  io.select.mockReturnValue({ eq: io.eq });
  io.eq.mockReturnValue({ maybeSingle: io.insumo });
  io.insumo.mockResolvedValue(ok({ id: 12, quantidade_embalagem: 250, unidade: "mL" }));
  io.rpc.mockImplementation(async (nome: string) => {
    if (nome === "current_papel") return ok("laboratorio");
    if (nome === READ) return ok(nenhuma);
    if (nome === WRITE) return ok({ repetida: false, registro });
    throw new Error("RPC inesperada");
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("registro manual — sessão e 0152", () => {
  it("flag ausente deixa o registro ligado", async () => {
    vi.stubEnv(FLAG, undefined);
    expect(await registrarConsumoManual(inicial, form())).toMatchObject({ ok: true });
  });

  it("flag 0 bloqueia antes de qualquer cliente ou RPC", async () => {
    vi.stubEnv(FLAG, "0");
    expect(await registrarConsumoManual(inicial, form())).toMatchObject({ ok: false, codigo: "ESCRITA_DESABILITADA" });
    expect(io.client).not.toHaveBeenCalled();
    expect(io.rpc).not.toHaveBeenCalled();
  });

  it("sem sessão verificada não consulta papel nem escreve", async () => {
    io.getUser.mockResolvedValue(ok({ user: null }));
    expect(await registrarConsumoManual(inicial, form())).toMatchObject({ ok: false, codigo: "SESSAO_INVALIDA" });
    expect(io.rpc).not.toHaveBeenCalled();
  });

  it.each(["compra", "cadastro", "tecnico", null, "ADMIN"])("nega papel não autorizado: %s", async (papel) => {
    io.rpc.mockResolvedValueOnce(ok(papel));
    expect(await registrarConsumoManual(inicial, form())).toMatchObject({ ok: false, codigo: "SEM_ACESSO" });
    expect(io.rpc.mock.calls).toEqual([["current_papel"]]);
  });

  it.each(["laboratorio", "gestor", "coordenador", "supervisor", "admin"])(
    "papel literal %s envia zero explícito e a pré-imagem para a mesma sessão", async (papel) => {
      io.rpc.mockResolvedValueOnce(ok(papel));
      expect(await registrarConsumoManual(inicial, form())).toEqual({ ok: true, estado: "registrada", registro });
      expect(io.client).toHaveBeenCalledOnce();
      expect(io.rpc.mock.calls).toEqual([
        ["current_papel"], [WRITE, {
          p_insumo_id: 12, p_operacao_id: operacao, p_revisao_esperada: 0, p_quantidade_embalagens_mes: 0,
          p_conteudo_embalagem_esperado: 250, p_unidade_conteudo_esperada: "mL", p_apresentacao_confirmada: true,
          p_fonte: registro.fonte, p_motivo: registro.motivo, p_data_referencia: "2026-11-07",
        }],
      ]);
      expect(io.from).not.toHaveBeenCalled();
    },
  );

  it.each([
    { operacao_id: "invalida" }, { revisao_esperada: "" }, { insumo_id: "0" },
    { quantidade_embalagens_mes: "" }, { quantidade_embalagens_mes: "-1" },
    { quantidade_embalagens_mes: "Infinity" }, { quantidade_embalagens_mes: "1e2" },
    { quantidade_embalagens_mes: "0.10000000000000001" }, { quantidade_embalagens_mes: "1.234,56" },
    { conteudo_embalagem_esperado: "0" }, { unidade_conteudo_esperada: "—" },
    { apresentacao_confirmada: "on" }, { fonte: "   " }, { motivo: "" },
    { data_referencia: "2026-02-30" },
  ] as Array<Record<string, string>>)("entrada inválida não chega à sessão nem à RPC: %j", async (delta) => {
    expect(await registrarConsumoManual(inicial, form(delta))).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    expect(io.client).not.toHaveBeenCalled();
    expect(io.rpc).not.toHaveBeenCalled();
  });

  it("recusa chamada sem FormData e campos repetidos sem iniciar sessão", async () => {
    const repetido = form();
    repetido.append("quantidade_embalagens_mes", "2");
    for (const dados of [repetido, {} as FormData]) {
      expect(await registrarConsumoManual(inicial, dados)).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    }
    expect(io.client).not.toHaveBeenCalled();
  });

  it("repete a mesma operação sem renumerar e não chama leitura de catálogo", async () => {
    io.rpc.mockResolvedValueOnce(ok("supervisor")).mockResolvedValueOnce(ok({ repetida: true, registro }));
    expect(await registrarConsumoManual(inicial, form({ quantidade_embalagens_mes: "00,000", fonte: " Caderno do laboratório " })))
      .toEqual({ ok: true, estado: "repetida", registro });
    expect(io.rpc.mock.calls[1][1]).toMatchObject({ p_operacao_id: operacao, p_revisao_esperada: 0, p_quantidade_embalagens_mes: 0 });
    expect(io.from).not.toHaveBeenCalled();
  });

  it("preserva decimal sem arredondar a unidade da revisão", async () => {
    const fracao = { ...registro, quantidade_embalagens_mes: 0.5, conteudo_embalagem: 0.0000001 };
    io.rpc.mockResolvedValueOnce(ok("admin")).mockResolvedValueOnce(ok({ repetida: false, registro: fracao }));
    expect(await registrarConsumoManual(inicial, form({ quantidade_embalagens_mes: "0,5", conteudo_embalagem_esperado: "0.0000001" })))
      .toEqual({ ok: true, estado: "registrada", registro: fracao });
    expect(io.rpc.mock.calls[1][1]).toMatchObject({ p_quantidade_embalagens_mes: 0.5, p_conteudo_embalagem_esperado: 0.0000001 });
  });

  it.each([
    ["40001", "REVISAO_DIVERGENTE"], ["23505", "OPERACAO_CONFLITANTE"], ["42501", "SEM_ACESSO"],
    ["22023", "APRESENTACAO_DIVERGENTE"], ["PGRST202", "FALHA_ESCRITA"],
  ])("preserva a diferença de erro %s sem retry nem texto bruto", async (code, codigo) => {
    io.rpc.mockResolvedValueOnce(ok("gestor")).mockResolvedValueOnce({ data: null, error: { code, message: "detalhe privado" } });
    const r = await registrarConsumoManual(inicial, form());
    expect(r).toMatchObject({ ok: false, codigo });
    expect(JSON.stringify(r)).not.toContain("detalhe privado");
    expect(io.rpc.mock.calls.filter(([nome]) => nome === WRITE)).toHaveLength(1);
  });

  it.each([
    { insumo_id: 13 }, { revisao: 2 }, { ator_id: operacao }, { quantidade_embalagens_mes: "0" },
    { conteudo_embalagem: 500 }, { fonte: "Outra" },
  ])("recibo inválido não confirma persistência: %j", async (delta) => {
    io.rpc.mockResolvedValueOnce(ok("admin")).mockResolvedValueOnce(ok({ repetida: false, registro: { ...registro, ...delta } }));
    expect(await registrarConsumoManual(inicial, form())).toMatchObject({ ok: false, codigo: "RESPOSTA_INVALIDA" });
    expect(io.rpc.mock.calls.filter(([nome]) => nome === WRITE)).toHaveLength(1);
  });
});

describe("leitura focal e histórico", () => {
  it("ausência real não vira zero; catálogo é consultado apenas para o insumo selecionado", async () => {
    vi.stubEnv(FLAG, "0");
    expect(await lerConsumoManual(12)).toEqual({
      ok: true, ...nenhuma, podeRegistrar: false, apresentacao: { estado: "disponivel", conteudo: 250, unidade: "mL" },
    });
    expect(io.rpc.mock.calls).toEqual([[READ, { p_insumo_id: 12, p_antes_da_revisao: null, p_limite: 25 }]]);
    expect(io.from.mock.calls).toEqual([["insumos"]]);
    expect(io.eq.mock.calls).toEqual([["id", 12]]);
  });

  it("paginação usa cursor exclusivo sem consultas por linha nem segunda consulta de apresentação", async () => {
    const vigente = { ...registro, revisao: 3 };
    io.rpc.mockResolvedValueOnce(ok({
      estado: "registrada", vigente, historico: [{ ...registro, revisao: 2 }], proxima_antes_da_revisao: 2,
    }));
    expect(await lerConsumoManual(12, 3, 1)).toMatchObject({
      ok: true, estado: "registrada", vigente, proxima_antes_da_revisao: 2,
      historico: [{ revisao: 2, quantidade_embalagens_mes: 0 }], apresentacao: null,
    });
    expect(io.rpc.mock.calls).toEqual([[READ, { p_insumo_id: 12, p_antes_da_revisao: 3, p_limite: 1 }]]);
    expect(io.from).not.toHaveBeenCalled();
  });

  it.each(["compra", "cadastro"])("preserva leitura existente de %s sem oferecer escrita", async (papel) => {
    io.rpc.mockResolvedValueOnce(ok(nenhuma)).mockResolvedValueOnce(ok(papel));
    expect(await lerConsumoManual(12)).toMatchObject({ ok: true, estado: "nenhuma", podeRegistrar: false });
    expect(io.rpc.mock.calls.some(([nome]) => nome === WRITE)).toBe(false);
  });

  it("separa erro da RPC, acesso negado e resposta não confirmada de ausência", async () => {
    io.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "detalhe privado" } })
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } })
      .mockResolvedValueOnce(ok({ ...nenhuma, historico: [registro] }));
    expect(await lerConsumoManual(12)).toMatchObject({ ok: false, codigo: "SEM_ACESSO" });
    expect(await lerConsumoManual(12)).toMatchObject({ ok: false, codigo: "FALHA_LEITURA" });
    expect(await lerConsumoManual(12)).toMatchObject({ ok: false, codigo: "RESPOSTA_INVALIDA" });
    expect(io.from).not.toHaveBeenCalled();
  });

  it("rejeita revisão de outro insumo e cursor não confirmado", async () => {
    const leitura = { estado: "registrada", vigente: registro, historico: [registro], proxima_antes_da_revisao: null };
    io.rpc.mockResolvedValueOnce(ok({ ...leitura, historico: [{ ...registro, insumo_id: 13 }] }))
      .mockResolvedValueOnce(ok({ ...leitura, proxima_antes_da_revisao: 9 }));
    expect(await lerConsumoManual(12)).toMatchObject({ ok: false, codigo: "RESPOSTA_INVALIDA" });
    expect(await lerConsumoManual(12)).toMatchObject({ ok: false, codigo: "RESPOSTA_INVALIDA" });
  });
});
