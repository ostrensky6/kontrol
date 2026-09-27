import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
const temPapel = vi.fn();
const usuarioAtual = vi.fn();
const deleteUser = vi.fn();
const updateUserById = vi.fn();
const createUser = vi.fn();
const clientFrom = vi.fn();
const adminFrom = vi.fn();
const select = vi.fn();
const categoryEq = vi.fn();
const maybeSingle = vi.fn();
const upsert = vi.fn();
const update = vi.fn();
const eq = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/roles", () => ({ temPapel, usuarioAtual }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: clientFrom })),
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

function formulario(id = "usuario-alvo", email = "alvo@kontrol.test") {
  const formData = new FormData();
  formData.set("id", id);
  formData.set("email", email);
  return formData;
}

describe("excluirUsuario", () => {
  beforeEach(() => {
    revalidatePath.mockReset();
    temPapel.mockReset();
    usuarioAtual.mockReset();
    deleteUser.mockReset();
    updateUserById.mockReset();
    createUser.mockReset();
    clientFrom.mockReset();
    adminFrom.mockReset();
    select.mockReset();
    categoryEq.mockReset();
    maybeSingle.mockReset();
    upsert.mockReset();
    update.mockReset();
    eq.mockReset();
    temPapel.mockResolvedValue(true);
    usuarioAtual.mockResolvedValue({ id: "admin-atual" });
    deleteUser.mockResolvedValue({ error: null });
    updateUserById.mockResolvedValue({ error: null });
    createUser.mockResolvedValue({ data: { user: { id: "usuario-criado" } }, error: null });
    clientFrom.mockReturnValue({ update });
    adminFrom.mockReturnValue({ select, upsert });
    select.mockReturnValue({ eq: categoryEq });
    categoryEq.mockReturnValue({ maybeSingle });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    upsert.mockResolvedValue({ error: null });
    update.mockReturnValue({ eq });
    // update(...).eq(...) é aguardado direto ou seguido de select("id") (conta nova, suspensão)
    eq.mockImplementation(() =>
      Object.assign(Promise.resolve({ error: null }), {
        select: vi.fn(async () => ({ data: [{ id: "usuario-criado" }], error: null })),
      }),
    );
  });

  it("mantem o hard delete para um usuario sem vinculos", async () => {
    const { excluirUsuario } = await import("./usuarios");

    const result = await excluirUsuario({ ok: false }, formulario());

    expect(deleteUser).toHaveBeenCalledOnce();
    expect(deleteUser).toHaveBeenCalledWith("usuario-alvo");
    expect(result).toEqual({ ok: true, message: "Usuário alvo@kontrol.test excluído." });
    expect(revalidatePath).toHaveBeenCalledWith("/usuarios");
  });

  it("nao permite que um admin exclua a propria conta", async () => {
    usuarioAtual.mockResolvedValue({ id: "usuario-alvo" });
    const { excluirUsuario } = await import("./usuarios");

    const result = await excluirUsuario({ ok: false }, formulario());

    expect(result).toEqual({ ok: false, message: "Você não pode excluir o seu próprio usuário." });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("traduz falha de FK historica sem vazar detalhes internos", async () => {
    deleteUser.mockResolvedValue({
      error: {
        code: "unexpected_failure",
        message: "Database error deleting user: violates foreign key constraint secret_name",
      },
    });
    const { excluirUsuario } = await import("./usuarios");

    const result = await excluirUsuario({ ok: false }, formulario());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("vínculos históricos");
    expect(result.message).toContain("Reatribua");
    expect(result.message).not.toContain("secret_name");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("orienta sobre objetos do Storage sem afirmar exclusao parcial", async () => {
    deleteUser.mockResolvedValue({
      error: { code: "unexpected_failure", message: "User still owns storage objects in bucket private-bucket" },
    });
    const { excluirUsuario } = await import("./usuarios");

    const result = await excluirUsuario({ ok: false }, formulario());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("arquivos no Storage");
    expect(result.message).toContain("Reatribua ou remova");
    expect(result.message).not.toContain("private-bucket");
    expect(result.message).not.toContain("excluído");
  });

  it("falha fechada e acionavel para vinculo desconhecido", async () => {
    deleteUser.mockResolvedValue({ error: { code: "unexpected_failure", message: "opaque internal detail" } });
    const { excluirUsuario } = await import("./usuarios");

    const result = await excluirUsuario({ ok: false }, formulario());

    expect(result).toEqual({
      ok: false,
      message:
        "Não foi possível excluir o usuário. A exclusão não foi confirmada; verifique vínculos e arquivos associados antes de tentar novamente.",
    });
  });

  it("preserva a escolha explicita de nenhuma permissao", async () => {
    const formData = new FormData();
    formData.set("id", "usuario-alvo");
    formData.set("nome", "Usuário sem permissão");
    formData.set("papel", "tecnico");
    formData.set("permissoes_presentes", "1");
    const { editarUsuario } = await import("./usuarios");

    const result = await editarUsuario({ ok: false }, formData);

    expect(result).toEqual({ ok: true, message: "Usuário atualizado." });
    const payload = update.mock.calls[0]?.[0] as { permissoes: Record<string, boolean> };
    expect(Object.keys(payload.permissoes).length).toBeGreaterThan(0);
    expect(Object.values(payload.permissoes).every((enabled) => enabled === false)).toBe(true);
  });

  it("novo usuário segue a categoria: não grava cópia das permissões", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        permissoes: {
          "analises.ver": false,
          "usuarios.gerenciar": true,
        },
      },
      error: null,
    });
    const formData = new FormData();
    formData.set("email", "novo@kontrol.test");
    formData.set("nome", "Novo usuário");
    formData.set("papel", "tecnico");
    const { criarUsuario } = await import("./usuarios");

    const result = await criarUsuario({ ok: false }, formData);

    expect(result.ok).toBe(true);
    expect(adminFrom).toHaveBeenCalledWith("permissoes_categorias");
    const payload = update.mock.calls[0]?.[0] as { permissoes: Record<string, boolean> };
    // só exceções ficam no usuário; sem ajuste no formulário, nenhuma (0124)
    expect(payload.permissoes).toEqual({});
  });

  it("salva categoria explicitamente vazia como todas as permissoes desativadas", async () => {
    const formData = new FormData();
    formData.set("papel", "tecnico");
    formData.set("permissoes_presentes", "1");
    const { salvarPermissoesCategoria } = await import("./usuarios");

    const result = await salvarPermissoesCategoria({ ok: false }, formData);

    expect(result).toEqual({ ok: true, message: "Permissões da categoria atualizadas." });
    expect(adminFrom).toHaveBeenCalledWith("permissoes_categorias");
    expect(upsert).toHaveBeenCalledOnce();
    const payload = upsert.mock.calls[0]?.[0] as { permissoes: Record<string, boolean> };
    expect(Object.keys(payload.permissoes).length).toBeGreaterThan(0);
    expect(Object.values(payload.permissoes).every((enabled) => enabled === false)).toBe(true);
    // a matriz de Privilégios lê a mesma tabela: precisa ser revalidada junto
    expect(revalidatePath).toHaveBeenCalledWith("/usuarios");
    expect(revalidatePath).toHaveBeenCalledWith("/governanca/privilegios");
  });

  it("mantem a permissao de remuneracao ao salvar a categoria (nao some do jsonb)", async () => {
    const formData = new FormData();
    formData.set("papel", "gestor");
    formData.set("permissoes_presentes", "1");
    formData.append("permissoes", "tecnicos.salario.ver");
    const { salvarPermissoesCategoria } = await import("./usuarios");

    await salvarPermissoesCategoria({ ok: false }, formData);

    const payload = upsert.mock.calls[0]?.[0] as { permissoes: Record<string, boolean> };
    expect(payload.permissoes["tecnicos.salario.ver"]).toBe(true);
  });
});
