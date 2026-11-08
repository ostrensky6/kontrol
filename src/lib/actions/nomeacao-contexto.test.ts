import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ client: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped: m.client }));
vi.mock("next/navigation", () => ({ unstable_rethrow: (error: unknown) => {
  if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
} }));
import { listarContextoNomeacao } from "./nomeacao-contexto";
const ator = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const alvo = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const outro = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const item = { usuario_id: alvo, nome: null, papel_atual_esperado: "gestor", suspenso: false,
  senha_provisoria: false, papeis_destino: ["gestor"] };
const pagina = { itens: [item], proximo_usuario_id: null };
beforeEach(() => {
  vi.resetAllMocks();
  m.client.mockResolvedValue({ auth: { getUser: m.getUser }, rpc: m.rpc, from: m.from });
  m.getUser.mockResolvedValue({ data: { user: { id: ator } }, error: null });
  m.rpc.mockResolvedValue({ data: pagina, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("ORD152 contexto nomeação", () => {
  it("Coordenador: preserva Gestor -> Gestor sem inventar troca efetiva", async () => {
    vi.stubEnv("KONTROL_VINCULOS_PROJETO_ESCRITA", undefined);
    expect(await listarContextoNomeacao()).toEqual({ ok: true, estado: "PAGINA_CONFIRMADA", pagina });
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("listar_contexto_nomeacao", { p_apos_usuario_id: null, p_limite: 50 });
    expect(m.from).not.toHaveBeenCalled();
  });
  it("Supervisor: mantém apenas destinos fornecidos e CAS do alvo", async () => {
    const row = { ...item, papel_atual_esperado: "coordenador", papeis_destino: ["gestor", "coordenador"] };
    m.rpc.mockResolvedValue({ data: { ...pagina, itens: [row] }, error: null });
    expect(await listarContextoNomeacao()).toMatchObject({ ok: true, pagina: { itens: [row] } });
    expect(m.from).not.toHaveBeenCalled();
  });
  it.each(["laboratorio", "compra", "cadastro", "gestor", "coordenador", "supervisor", "admin"])(
    "Admin: preserva alvo %s e os sete destinos reais sem filtro paralelo", async (papel) => {
      const row = { ...item, papel_atual_esperado: papel, suspenso: true, senha_provisoria: true,
        papeis_destino: ["laboratorio", "compra", "cadastro", "gestor", "coordenador", "supervisor", "admin"] };
      m.rpc.mockResolvedValue({ data: { ...pagina, itens: [row] }, error: null });
      expect(await listarContextoNomeacao()).toMatchObject({ ok: true, pagina: { itens: [row] } });
    });
  it("vazio confirmado não é negação", async () => {
    m.rpc.mockResolvedValue({ data: { itens: [], proximo_usuario_id: null }, error: null });
    expect(await listarContextoNomeacao()).toEqual({ ok: true, estado: "PAGINA_VAZIA", pagina: { itens: [], proximo_usuario_id: null } });
  });
  it("keyset UUID com cursor último, sem coerção de limite", async () => {
    m.rpc.mockResolvedValue({ data: { itens: [item, { ...item, usuario_id: outro }], proximo_usuario_id: outro.toUpperCase() }, error: null });
    expect(await listarContextoNomeacao({ apos_usuario_id: ator.toUpperCase(), limite: 2 }))
      .toMatchObject({ ok: true, pagina: { proximo_usuario_id: outro } });
    expect(m.rpc.mock.calls[0][1]).toEqual({ p_apos_usuario_id: ator, p_limite: 2 });
  });
  it.each([null, [], { limite: 0 }, { limite: 101 }, { limite: 1.5 }, { limite: "50" }, { limite: null },
    { apos_usuario_id: "inválido" }, { projeto_id: 1 }, { papel: "admin" }])("entrada inválida %j", async (input) => {
    expect(await listarContextoNomeacao(input)).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    expect(m.client).not.toHaveBeenCalled();
  });
  it.each([{ data: { user: null }, error: null }, { data: { user: { id: "inválido" } }, error: null },
    { data: { user: { id: ator } }, error: { message: "Auth negou" } }])("sessão inadequada", async (resposta) => {
    m.getUser.mockResolvedValue(resposta);
    expect(await listarContextoNomeacao()).toMatchObject({ ok: false, codigo: "SESSAO_INVALIDA" });
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", "ACESSO_NEGADO"], ["22023", "ENTRADA_INVALIDA"], ["PGRST202", "FALHA_LEITURA"]])(
    "erro %s não vira vazio e não vaza detalhes", async (code, codigo) => {
      m.rpc.mockResolvedValue({ data: pagina, error: { code, message: "SEGREDO" } });
      const result = await listarContextoNomeacao();
      expect(result).toMatchObject({ ok: false, codigo });
      expect(JSON.stringify(result)).not.toContain("SEGREDO");
    });
  it.each([null, {}, { ...pagina, privado: "SEGREDO" }, { itens: [], proximo_usuario_id: alvo },
    { ...pagina, itens: [item, item] }, { ...pagina, itens: [{ ...item, usuario_id: outro }, item] },
    { ...pagina, itens: [{ ...item, usuario_id: ator }] }, { ...pagina, proximo_usuario_id: outro },
    { ...pagina, itens: [{ ...item, nome: undefined }] }, { ...pagina, itens: [{ ...item, suspenso: "false" }] },
    { ...pagina, itens: [{ ...item, email: "privado@example.invalid" }] },
    { ...pagina, itens: [{ ...item, papeis_destino: [] }] }, { ...pagina, itens: [{ ...item, papeis_destino: ["gestor", "gestor"] }] },
    { ...pagina, itens: [{ ...item, papeis_destino: ["inventado"] }] },
    { ...pagina, itens: [{ ...item, papel_atual_esperado: "inventado" }] },
  ])("contrato inválido sem dados parciais %j", async (data) => {
    m.rpc.mockResolvedValue({ data, error: null });
    const result = await listarContextoNomeacao();
    expect(result).toMatchObject({ ok: false, codigo: "CONTRATO_INVALIDO" });
    expect(result).not.toHaveProperty("pagina");
  });
  it("não aceita item anterior/igual ao cursor", async () => {
    expect(await listarContextoNomeacao({ apos_usuario_id: alvo })).toMatchObject({ codigo: "CONTRATO_INVALIDO" });
  });
  it("recusa página maior que solicitado", async () => {
    m.rpc.mockResolvedValue({ data: { ...pagina, itens: [item, { ...item, usuario_id: outro }] }, error: null });
    expect(await listarContextoNomeacao({ limite: 1 })).toMatchObject({ codigo: "CONTRATO_INVALIDO" });
  });
  it("cursor não nulo exige página cheia", async () => {
    m.rpc.mockResolvedValue({ data: { ...pagina, proximo_usuario_id: alvo }, error: null });
    expect(await listarContextoNomeacao({ limite: 2 })).toMatchObject({ codigo: "CONTRATO_INVALIDO" });
  });
  it("timeout não gera retry", async () => {
    m.rpc.mockRejectedValue(new Error("timeout"));
    expect(await listarContextoNomeacao()).toMatchObject({ ok: false, codigo: "FALHA_LEITURA" });
    expect(m.rpc).toHaveBeenCalledTimes(1);
  });
  it("preserva controle Next", async () => {
    m.client.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(listarContextoNomeacao()).rejects.toThrow("NEXT_REDIRECT");
  });
});
