import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";

const io = vi.hoisted(() => ({
  cliente: vi.fn(), rpc: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(),
  ler: vi.fn(), auth: vi.fn(), admin: vi.fn(), revalidate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: io.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped: io.cliente }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: io.admin,
  mensagemErroAdminSupabase: () => "Falha administrativa.",
}));

const ator = "00000000-0000-4000-8000-000000000001";
const alvo = "00000000-0000-4000-8000-000000000002";
const nomeacao = (atual = "gestor", destino = "coordenador", id = alvo) => {
  const form = new FormData();
  form.set("id", id);
  form.set("papel_atual_esperado", atual);
  form.set("papel_destino", destino);
  return form;
};

const resposta = (data: unknown) => ({ data, error: null });
const confirmado = { usuario_id: alvo, papel: "coordenador", alterado: true };

beforeEach(() => {
  vi.resetAllMocks();
  io.cliente.mockResolvedValue({ auth: { getUser: io.auth }, rpc: io.rpc, from: io.from });
  io.auth.mockResolvedValue(resposta({ user: { id: ator } }));
  io.rpc.mockImplementation(async (fn: string) => {
    if (fn === "current_papel") return resposta("supervisor");
    if (fn === "nomear_papel_usuario") return resposta(confirmado);
    throw new Error("RPC fora do contrato de teste");
  });
  io.from.mockReturnValue({ select: io.select });
  io.select.mockReturnValue({ eq: io.eq });
  io.eq.mockReturnValue({ maybeSingle: io.ler });
  io.ler.mockResolvedValue(resposta({ id: alvo, papel: "gestor", permissoes: { "usuarios.gerenciar": false } }));
  io.admin.mockImplementation(() => { throw new Error("cliente administrativo fora do contrato"); });
});

describe("nomeação de função", () => {
  it("envia exatamente o contrato à RPC com a mesma sessão e sem override/admin", async () => {
    const { nomearPapelUsuario } = await import("./usuarios");
    expect(await nomearPapelUsuario({ ok: false }, nomeacao())).toMatchObject({ ok: true });
    expect(io.cliente).toHaveBeenCalledOnce();
    expect(io.auth).toHaveBeenCalledOnce();
    expect(io.select).toHaveBeenCalledWith("id, papel");
    expect(io.rpc.mock.calls).toEqual([
      ["current_papel"],
      ["nomear_papel_usuario", { p_usuario_id: alvo, p_papel_atual_esperado: "gestor", p_papel_destino: "coordenador" }],
    ]);
    expect(io.admin).not.toHaveBeenCalled();
    expect(io.revalidate).toHaveBeenCalledWith("/usuarios");
  });

  it.each([
    ["sem sessão", null, "supervisor", "gestor", "coordenador", alvo],
    ["papel ausente/suspenso/provisório", ator, null, "gestor", "coordenador", alvo],
    ["papel desconhecido", ator, "inventado", "gestor", "coordenador", alvo],
    ["autoalteração Admin", ator, "admin", "gestor", "coordenador", ator],
    ["par", ator, "supervisor", "supervisor", "gestor", alvo],
    ["superior", ator, "supervisor", "admin", "gestor", alvo],
    ["destino não inferior", ator, "supervisor", "gestor", "supervisor", alvo],
    ["Coordenador remove Supervisor", ator, "coordenador", "supervisor", "gestor", alvo],
    ["sem hierarquia operacional inferida", ator, "supervisor", "compra", "gestor", alvo],
    ["não aplica proteção do último Admin apenas no cliente", ator, "admin", "admin", "gestor", alvo],
  ])("nega %s sem chamar a mutação", async (_caso, idSessao, papel, atual, destino, idAlvo) => {
    io.auth.mockResolvedValue(resposta({ user: idSessao ? { id: idSessao } : null }));
    io.rpc.mockResolvedValue(resposta(papel));
    const { nomearPapelUsuario } = await import("./usuarios");
    expect((await nomearPapelUsuario({ ok: false }, nomeacao(atual, destino, idAlvo))).ok).toBe(false);
    expect(io.from).not.toHaveBeenCalled();
    expect(io.rpc.mock.calls.every(([fn]) => fn === "current_papel")).toBe(true);
    expect(io.admin).not.toHaveBeenCalled();
  });

  it("Admin retira Supervisor de outra pessoa pela mesma RPC", async () => {
    io.rpc.mockResolvedValueOnce(resposta("admin"))
      .mockResolvedValueOnce(resposta({ usuario_id: alvo, papel: "gestor", alterado: true }));
    io.ler.mockResolvedValue(resposta({ id: alvo, papel: "supervisor" }));
    const { nomearPapelUsuario } = await import("./usuarios");
    expect((await nomearPapelUsuario({ ok: false }, nomeacao("supervisor", "gestor"))).ok).toBe(true);
    expect(io.admin).not.toHaveBeenCalled();
  });

  it("recusa payload individual e conflito da pré-imagem sem enviar a mutação", async () => {
    const { nomearPapelUsuario } = await import("./usuarios");
    const form = nomeacao();
    form.set("permissoes_presentes", "0");
    expect(await nomearPapelUsuario({ ok: false }, form)).toMatchObject({ ok: false, codigo: "PERMISSAO_INDIVIDUAL_DESATIVADA" });
    io.ler.mockResolvedValue(resposta({ id: alvo, papel: "coordenador" }));
    expect(await nomearPapelUsuario({ ok: false }, nomeacao())).toMatchObject({ ok: false, codigo: "PAPEL_ALTERADO" });
    expect(io.rpc.mock.calls).toEqual([["current_papel"]]);
  });

  it.each([
    resposta(true),
    resposta({ ...confirmado, usuario_id: ator }),
    resposta({ ...confirmado, papel: "admin" }),
    resposta({ ...confirmado, alterado: false }),
    { data: null, error: { code: "PGRST202" } },
    { data: null, error: { code: "40001" } },
  ])("não confirma resultado incompatível, RPC ausente ou conflito: %j", async (retorno) => {
    io.rpc.mockResolvedValueOnce(resposta("supervisor")).mockResolvedValueOnce(retorno);
    const { nomearPapelUsuario } = await import("./usuarios");
    const result = await nomearPapelUsuario({ ok: false }, nomeacao());
    expect(result.ok).toBe(false);
    if (retorno.error?.code === "40001") expect(result.codigo).toBe("PAPEL_ALTERADO");
    expect(io.admin).not.toHaveBeenCalled();
    expect(io.revalidate).not.toHaveBeenCalled();
  });

  it("não reaproveita delegação para criação, pré-aprovação ou edição cadastral", async () => {
    const { criarUsuario, criarUsuarioPreAprovado, editarUsuario } = await import("./usuarios");
    for (const action of [criarUsuario, criarUsuarioPreAprovado, editarUsuario]) {
      expect((await action({ ok: false }, nomeacao())).ok).toBe(false);
    }
    expect(io.from).not.toHaveBeenCalled();
    expect(io.admin).not.toHaveBeenCalled();
    expect(io.rpc.mock.calls.every(([fn]) => fn === "current_papel")).toBe(true);
  });

  it("Admin não abre conta já nomeada, inclusive por pré-aprovação", async () => {
    io.rpc.mockResolvedValue(resposta("admin"));
    io.eq.mockReturnValue({ single: async () => resposta({ id: 7, email: "pre@kontrol.test", papel: "gestor" }) });
    const { criarUsuario, criarUsuarioPreAprovado } = await import("./usuarios");
    const form = new FormData();
    form.set("papel", "gestor");
    form.set("email", "teste@kontrol.test");
    form.set("pre_aprovado_id", "7");
    expect((await criarUsuario({ ok: false }, form)).message).toContain("nomeação separada");
    expect((await criarUsuarioPreAprovado({ ok: false }, form)).message).toContain("Nenhuma conta foi criada");
    expect(io.admin).not.toHaveBeenCalled();
    expect(io.rpc.mock.calls.every(([fn]) => fn === "current_papel")).toBe(true);
  });
});

it("lê decisão canônica, falha fechado e não engole sinal de controle Next", async () => {
  const { pode, minhasPermissoes } = await import("@/lib/auth/permissao-efetiva");
  io.rpc.mockResolvedValueOnce(resposta(true))
    .mockResolvedValueOnce(resposta({ admin: false, permissoes: { "analises.ver": true } }));
  expect(await pode("analises.ver")).toBe(true);
  expect(await minhasPermissoes()).toEqual({ admin: false, permissoes: { "analises.ver": true } });
  expect(io.rpc.mock.calls).toEqual([["tem_permissao", { p_chave: "analises.ver" }], ["minhas_permissoes"]]);
  io.rpc.mockRejectedValue(new Error("falha de transporte"));
  expect(await pode("estoque.ver")).toBe(false);
  expect(await minhasPermissoes()).toEqual({ admin: false, permissoes: {} });
  let sinal: unknown;
  try { redirect("/local"); } catch (error) { sinal = error; }
  io.cliente.mockRejectedValue(sinal);
  await expect(pode("cadastros.ver")).rejects.toBe(sinal);
});
