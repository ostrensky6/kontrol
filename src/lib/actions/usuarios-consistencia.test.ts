import { beforeEach, describe, expect, it, vi } from "vitest";

// Auth e perfil são gravados em sistemas separados: cada falha no meio do
// caminho precisa terminar em estado coerente ou em erro explícito (27/09).

const revalidatePath = vi.fn();
const temPapel = vi.fn();
const usuarioAtual = vi.fn();
const createUser = vi.fn();
const deleteUser = vi.fn();
const updateUserById = vi.fn();
const clientFrom = vi.fn();
const adminFrom = vi.fn();
const storageRemove = vi.fn();

// perfis: update(...).eq(...) pode ser aguardado direto ou seguido de select("id")
const perfilUpdate = vi.fn();
const perfilEq = vi.fn();
const perfilSelect = vi.fn();
let resultadoPerfil: { error: { message: string } | null };
let linhasPerfil: { data: { id: string }[] | null; error: { message: string } | null };

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/roles", () => ({ temPapel, usuarioAtual }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: clientFrom,
    storage: { from: () => ({ remove: storageRemove }) },
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    auth: { admin: { createUser, deleteUser, updateUserById } },
    from: adminFrom,
  })),
  mensagemErroAdminSupabase: vi.fn((error: { message?: string } | null | undefined) =>
    error?.message ?? "Falha administrativa.",
  ),
}));

function tabelaPerfis() {
  return { update: perfilUpdate };
}

function preAprovado() {
  return {
    select: () => ({
      eq: () => ({
        single: async () => ({
          data: { id: 7, nome: "Pré", email: "pre@kontrol.test", papel: "coordenador", permissoes: {} },
          error: null,
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  temPapel.mockResolvedValue(true);
  usuarioAtual.mockResolvedValue({ id: "admin-atual" });
  createUser.mockResolvedValue({ data: { user: { id: "conta-nova" } }, error: null });
  deleteUser.mockResolvedValue({ error: null });
  updateUserById.mockResolvedValue({ error: null });
  storageRemove.mockResolvedValue({ data: [], error: null });
  resultadoPerfil = { error: null };
  linhasPerfil = { data: [{ id: "conta-nova" }], error: null };
  perfilUpdate.mockReturnValue({ eq: perfilEq });
  perfilEq.mockImplementation(() =>
    Object.assign(Promise.resolve(resultadoPerfil), { select: perfilSelect }),
  );
  perfilSelect.mockImplementation(async () => linhasPerfil);
  clientFrom.mockImplementation((tabela: string) =>
    tabela === "usuarios_pre_aprovados" ? preAprovado() : tabelaPerfis(),
  );
  adminFrom.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
  });
});

function novoUsuario() {
  const formData = new FormData();
  formData.set("email", "novo@kontrol.test");
  formData.set("nome", "Novo");
  formData.set("papel", "coordenador");
  return formData;
}

describe("criarUsuario", () => {
  it("desfaz a conta quando o perfil não pode ser ajustado", async () => {
    linhasPerfil = { data: null, error: { message: "permission denied for table perfis" } };
    const { criarUsuario } = await import("./usuarios");

    const result = await criarUsuario({ ok: false }, novoUsuario());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("não foi criada");
    expect(deleteUser).toHaveBeenCalledWith("conta-nova");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("desfaz a conta quando o perfil não existe (nenhuma linha ajustada)", async () => {
    linhasPerfil = { data: [], error: null };
    const { criarUsuario } = await import("./usuarios");

    const result = await criarUsuario({ ok: false }, novoUsuario());

    expect(result.ok).toBe(false);
    expect(deleteUser).toHaveBeenCalledWith("conta-nova");
  });

  it("bloqueia a conta e orienta quando nem desfazer é possível", async () => {
    linhasPerfil = { data: null, error: { message: "timeout" } };
    deleteUser.mockResolvedValue({ error: { message: "database error deleting user" } });
    const { criarUsuario } = await import("./usuarios");

    const result = await criarUsuario({ ok: false }, novoUsuario());

    expect(result.ok).toBe(false);
    expect(updateUserById).toHaveBeenCalledWith("conta-nova", { ban_duration: "876000h" });
    expect(result.message).toContain("novo@kontrol.test");
    expect(result.message).toContain("suspensa");
  });

  it("não mexe na conta quando o perfil é ajustado", async () => {
    const { criarUsuario } = await import("./usuarios");

    const result = await criarUsuario({ ok: false }, novoUsuario());

    expect(result.ok).toBe(true);
    expect(deleteUser).not.toHaveBeenCalled();
  });
});

describe("criarUsuarioPreAprovado", () => {
  it("desfaz a conta quando o perfil não pode ser ajustado", async () => {
    linhasPerfil = { data: [], error: null };
    const formData = new FormData();
    formData.set("pre_aprovado_id", "7");
    const { criarUsuarioPreAprovado } = await import("./usuarios");

    const result = await criarUsuarioPreAprovado({ ok: false }, formData);

    expect(result.ok).toBe(false);
    expect(deleteUser).toHaveBeenCalledWith("conta-nova");
  });
});

function suspensao(suspender: boolean) {
  const formData = new FormData();
  formData.set("id", "usuario-alvo");
  formData.set("suspender", suspender ? "1" : "0");
  return formData;
}

describe("alternarSuspensao", () => {
  it("informa o resultado quando suspende", async () => {
    linhasPerfil = { data: [{ id: "usuario-alvo" }], error: null };
    const { alternarSuspensao } = await import("./usuarios");

    const result = await alternarSuspensao(suspensao(true));

    expect(result).toEqual({ ok: true, message: "Usuário suspenso." });
    expect(updateUserById).toHaveBeenCalledWith("usuario-alvo", { ban_duration: "876000h" });
  });

  it("desfaz o bloqueio do login quando o perfil não é atualizado", async () => {
    linhasPerfil = { data: null, error: { message: "permission denied" } };
    const { alternarSuspensao } = await import("./usuarios");

    const result = await alternarSuspensao(suspensao(true));

    expect(result.ok).toBe(false);
    expect(result.message).toContain("nada foi alterado");
    expect(updateUserById).toHaveBeenNthCalledWith(1, "usuario-alvo", { ban_duration: "876000h" });
    expect(updateUserById).toHaveBeenNthCalledWith(2, "usuario-alvo", { ban_duration: "none" });
  });

  it("volta a bloquear o login quando a reativação do perfil falha", async () => {
    linhasPerfil = { data: [], error: null };
    const { alternarSuspensao } = await import("./usuarios");

    const result = await alternarSuspensao(suspensao(false));

    expect(result.ok).toBe(false);
    expect(updateUserById).toHaveBeenNthCalledWith(2, "usuario-alvo", { ban_duration: "876000h" });
  });

  it("avisa quando o bloqueio no Auth falha e não toca no perfil", async () => {
    updateUserById.mockResolvedValue({ error: { message: "auth indisponível" } });
    const { alternarSuspensao } = await import("./usuarios");

    const result = await alternarSuspensao(suspensao(true));

    expect(result).toEqual({ ok: false, message: "auth indisponível" });
    expect(perfilUpdate).not.toHaveBeenCalled();
  });

  it("recusa suspender a própria conta com mensagem", async () => {
    usuarioAtual.mockResolvedValue({ id: "usuario-alvo" });
    const { alternarSuspensao } = await import("./usuarios");

    const result = await alternarSuspensao(suspensao(true));

    expect(result.ok).toBe(false);
    expect(updateUserById).not.toHaveBeenCalled();
  });
});

describe("editarUsuario", () => {
  it("não altera o Auth quando o perfil recusa a edição", async () => {
    resultadoPerfil = { error: { message: "permission denied" } };
    const formData = new FormData();
    formData.set("id", "usuario-alvo");
    formData.set("nome", "Nome novo");
    formData.set("papel", "tecnico");
    const { editarUsuario } = await import("./usuarios");

    const result = await editarUsuario({ ok: false }, formData);

    expect(result.ok).toBe(false);
    expect(updateUserById).not.toHaveBeenCalled();
  });
});

describe("removerAssinaturaUsuario", () => {
  it("mantém o cadastro quando o arquivo não pode ser apagado", async () => {
    storageRemove.mockResolvedValue({ data: null, error: { message: "storage indisponível" } });
    const formData = new FormData();
    formData.set("id", "usuario-alvo");
    formData.set("assinatura_path", "usuario-alvo/assinatura.png");
    const { removerAssinaturaUsuario } = await import("./usuarios");

    const result = await removerAssinaturaUsuario({ ok: false }, formData);

    expect(result.ok).toBe(false);
    expect(perfilUpdate).not.toHaveBeenCalled();
  });
});
