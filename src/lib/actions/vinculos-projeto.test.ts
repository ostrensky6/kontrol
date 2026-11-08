import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  client: vi.fn(), getUser: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), perfil: vi.fn(), rpc: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped: m.client }));
vi.mock("next/navigation", () => ({ unstable_rethrow: (error: unknown) => {
  if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
} }));
import { configurarVinculoProjeto, listarVinculosProjeto } from "./vinculos-projeto";

const ator = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const usuario = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const pedido = { projeto_id: 12, usuario_id: usuario, vinculado: true };
const perfil = { id: ator, papel: "admin", suspenso: false, senha_provisoria: false };
const recibo = { ...pedido, alterado: true, coordenacao_direta: false };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("KONTROL_VINCULOS_PROJETO_ESCRITA", "1");
  m.client.mockResolvedValue({ auth: { getUser: m.getUser }, from: m.from, rpc: m.rpc });
  m.getUser.mockResolvedValue({ data: { user: { id: ator } }, error: null });
  m.from.mockReturnValue({ select: m.select });
  m.select.mockReturnValue({ eq: m.eq });
  m.eq.mockReturnValue({ maybeSingle: m.perfil });
  m.perfil.mockResolvedValue({ data: perfil, error: null });
  m.rpc.mockResolvedValue({ data: recibo, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("ORD123 configurarVinculoProjeto", () => {
  it.each([undefined, "", "true", "0"])("fechada sem chave explícita: %s", async (chave) => {
    vi.stubEnv("KONTROL_VINCULOS_PROJETO_ESCRITA", chave);
    expect(await configurarVinculoProjeto(pedido)).toMatchObject({ ok: false, codigo: "ESCRITA_DESLIGADA" });
    expect(m.client).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...pedido, projeto_id: "12" }, { ...pedido, projeto_id: 0 },
    { ...pedido, projeto_id: 1.5 }, { ...pedido, projeto_id: Number.MAX_SAFE_INTEGER + 1 },
    { ...pedido, usuario_id: "invalido" }, { ...pedido, vinculado: "false" },
    { ...pedido, papel: "admin" }, { ...pedido, permissoes: {} }, { ...pedido, ator_id: ator },
  ])("nega entrada não estrita: %j", async (input) => {
    expect(await configurarVinculoProjeto(input)).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    expect(m.client).not.toHaveBeenCalled();
  });
  it.each([{ data: { user: null }, error: null }, { data: { user: { id: ator } }, error: { message: "negado" } }])(
    "nega sessão ausente/erro", async (resposta) => {
      m.getUser.mockResolvedValue(resposta);
      expect(await configurarVinculoProjeto(pedido)).toMatchObject({ ok: false, codigo: "NAO_AUTORIZADO" });
      expect(m.from).not.toHaveBeenCalled();
      expect(m.rpc).not.toHaveBeenCalled();
    });
  it.each([null, {}, { ...perfil, id: usuario }, { ...perfil, papel: "supervisor" },
    { ...perfil, suspenso: true }, { ...perfil, senha_provisoria: true }, { ...perfil, suspenso: null },
  ])("nega perfil inapto sem fallback: %j", async (data) => {
    m.perfil.mockResolvedValue({ data, error: null });
    expect(await configurarVinculoProjeto(pedido)).toMatchObject({ ok: false, codigo: "NAO_AUTORIZADO" });
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("nega erro de leitura mesmo com perfil aparente", async () => {
    m.perfil.mockResolvedValue({ data: perfil, error: { message: "erro" } });
    expect(await configurarVinculoProjeto(pedido)).toMatchObject({ ok: false, codigo: "NAO_AUTORIZADO" });
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it.each([true, false])("confirma recibo alterado=%s sem atribuir função/chave", async (alterado) => {
    m.rpc.mockResolvedValue({ data: { ...recibo, alterado }, error: null });
    expect(await configurarVinculoProjeto({ ...pedido, usuario_id: usuario.toUpperCase() }))
      .toEqual({ ok: true, recibo: { ...recibo, alterado } });
    expect(m.eq).toHaveBeenCalledWith("id", ator);
    expect(m.from).toHaveBeenCalledExactlyOnceWith("perfis");
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("configurar_vinculo_projeto", {
      p_projeto_id: 12, p_usuario_id: usuario, p_vinculado: true,
    });
  });
  it("remove só vínculo explícito e preserva coordenação direta no recibo", async () => {
    const removido = { ...recibo, vinculado: false, coordenacao_direta: true };
    m.rpc.mockResolvedValue({ data: removido, error: null });
    expect(await configurarVinculoProjeto({ ...pedido, vinculado: false })).toEqual({ ok: true, recibo: removido });
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("configurar_vinculo_projeto", {
      p_projeto_id: 12, p_usuario_id: usuario, p_vinculado: false,
    });
  });
  it.each([null, [], {}, { ...recibo, projeto_id: 13 }, { ...recibo, usuario_id: ator },
    { ...recibo, vinculado: false }, { ...recibo, alterado: "true" },
    { ...recibo, coordenacao_direta: undefined }, { ...recibo, privado: "não expor" },
  ])("não confirma recibo incoerente: %j", async (data) => {
    m.rpc.mockResolvedValue({ data, error: null });
    expect(await configurarVinculoProjeto(pedido)).toMatchObject({ ok: false, codigo: "NAO_CONFIRMADO" });
    expect(m.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["42501", "PGRST202", "P0002", "22023"])("não confirma erro RPC %s nem vaza detalhes", async (code) => {
    m.rpc.mockResolvedValue({ data: recibo, error: { code, message: "SEGREDO" } });
    const resposta = await configurarVinculoProjeto(pedido);
    expect(resposta).toMatchObject({ ok: false, codigo: "NAO_CONFIRMADO" });
    expect(JSON.stringify(resposta)).not.toContain("SEGREDO");
    expect(m.rpc).toHaveBeenCalledTimes(1);
  });
  it("timeout não vira sucesso nem retry", async () => {
    m.rpc.mockRejectedValue(new Error("timeout"));
    expect(await configurarVinculoProjeto(pedido)).toMatchObject({ ok: false, codigo: "NAO_CONFIRMADO" });
    expect(m.rpc).toHaveBeenCalledTimes(1);
  });
  it("preserva exceções de controle do Next", async () => {
    m.client.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(configurarVinculoProjeto(pedido)).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("ORD145 listarVinculosProjeto", () => {
  const item = { usuario_id: usuario, nome: null, papel: "coordenador", suspenso: false,
    senha_provisoria: false, vinculado: false, coordenacao_direta: true };
  const pagina = { projeto_id: 12, itens: [item], proximo_usuario_id: null };
  beforeEach(() => { m.rpc.mockResolvedValue({ data: pagina, error: null }); });
  it("leitura sem flag de escrita, com nome nulo e coordenação independente", async () => {
    vi.stubEnv("KONTROL_VINCULOS_PROJETO_ESCRITA", undefined);
    expect(await listarVinculosProjeto({ projeto_id: 12 })).toEqual({ ok: true, estado: "PAGINA_CONFIRMADA", pagina, escrita_habilitada: false });
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("listar_vinculos_projeto", { p_projeto_id: 12, p_apos_usuario_id: null, p_limite: 50 });
    expect(m.from).toHaveBeenCalledExactlyOnceWith("perfis");
  });
  it("vazio confirmado é só a página", async () => {
    const vazia = { projeto_id: 12, itens: [], proximo_usuario_id: null };
    m.rpc.mockResolvedValue({ data: vazia, error: null });
    expect(await listarVinculosProjeto({ projeto_id: 12, apos_usuario_id: usuario })).toMatchObject({ ok: true, estado: "PAGINA_VAZIA", pagina: vazia });
  });
  it("preserva vínculo removível de papel alterado", async () => {
    m.rpc.mockResolvedValue({ data: { ...pagina, itens: [{ ...item, papel: "cadastro", vinculado: true, coordenacao_direta: false }] }, error: null });
    expect(await listarVinculosProjeto({ projeto_id: 12 })).toMatchObject({ ok: true, pagina: {
      itens: [{ papel: "cadastro", vinculado: true, coordenacao_direta: false }] } });
  });
  it("keyset normaliza UUID e confirma cursor último", async () => {
    m.rpc.mockResolvedValue({ data: { ...pagina, proximo_usuario_id: usuario.toUpperCase() }, error: null });
    expect(await listarVinculosProjeto({ projeto_id: 12, apos_usuario_id: ator.toUpperCase(), limite: 1 }))
      .toMatchObject({ ok: true, pagina: { proximo_usuario_id: usuario } });
    expect(m.rpc.mock.calls[0][1]).toEqual({ p_projeto_id: 12, p_apos_usuario_id: ator, p_limite: 1 });
  });
  it.each([null, {}, { projeto_id: "12" }, { projeto_id: 0 }, { projeto_id: Number.MAX_SAFE_INTEGER + 1 },
    { projeto_id: 12, limite: 0 }, { projeto_id: 12, limite: 101 }, { projeto_id: 12, limite: 1.5 },
    { projeto_id: 12, apos_usuario_id: "não uuid" }, { projeto_id: 12, papel: "admin" },
  ])("entrada inválida: %j", async (input) => {
    expect(await listarVinculosProjeto(input)).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    expect(m.client).not.toHaveBeenCalled();
  });
  it.each([null, { ...perfil, papel: "supervisor" }, { ...perfil, suspenso: true },
    { ...perfil, senha_provisoria: true }, { ...perfil, id: usuario }])("Admin inapto negado: %j", async (data) => {
    m.perfil.mockResolvedValue({ data, error: null });
    expect(await listarVinculosProjeto({ projeto_id: 12 })).toMatchObject({ ok: false, codigo: "NAO_AUTORIZADO" });
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("sessão inválida não lê perfil nem RPC", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await listarVinculosProjeto({ projeto_id: 12 })).toMatchObject({ codigo: "NAO_AUTORIZADO" });
    expect(m.from).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", "NAO_AUTORIZADO"], ["P0002", "PROJETO_INEXISTENTE"],
    ["22023", "ENTRADA_INVALIDA"], ["PGRST202", "FALHA_LEITURA"]])("erro %s separado de vazio", async (code, codigo) => {
    m.rpc.mockResolvedValue({ data: pagina, error: { code, message: "SEGREDO" } });
    const result = await listarVinculosProjeto({ projeto_id: 12 });
    expect(result).toMatchObject({ ok: false, codigo });
    expect(JSON.stringify(result)).not.toContain("SEGREDO");
  });
  it.each([null, { ...pagina, projeto_id: 13 }, { ...pagina, extra: true },
    { ...pagina, itens: [item, item] },
    { ...pagina, itens: [item, { ...item, usuario_id: ator }] },
    { ...pagina, proximo_usuario_id: ator }, { ...pagina, itens: [], proximo_usuario_id: usuario },
    { ...pagina, itens: [{ ...item, vinculado: "false" }] },
    { ...pagina, itens: [{ ...item, papel: "gestor" }] },
    { ...pagina, itens: [{ ...item, papel: "cadastro", coordenacao_direta: false }] },
  ])("recusa shape/identidade/ordem/cursor inválido: %j", async (data) => {
    m.rpc.mockResolvedValue({ data, error: null });
    expect(await listarVinculosProjeto({ projeto_id: 12 })).toMatchObject({ ok: false, codigo: "RESPOSTA_INVALIDA" });
  });
  it("recusa UUID anterior ou igual ao cursor de entrada", async () => {
    expect(await listarVinculosProjeto({ projeto_id: 12, apos_usuario_id: usuario })).toMatchObject({ codigo: "RESPOSTA_INVALIDA" });
  });
  it("não confirma próxima página se a atual veio incompleta", async () => {
    m.rpc.mockResolvedValue({ data: { ...pagina, proximo_usuario_id: usuario }, error: null });
    expect(await listarVinculosProjeto({ projeto_id: 12, limite: 2 })).toMatchObject({ codigo: "RESPOSTA_INVALIDA" });
  });
  it("timeout sem retry e sem lista vazia fabricada", async () => {
    m.rpc.mockImplementation(async () => { throw new Error("timeout"); });
    expect(await listarVinculosProjeto({ projeto_id: 12 })).toMatchObject({ ok: false, codigo: "FALHA_LEITURA" });
    expect(m.rpc).toHaveBeenCalledTimes(1);
  });
});
