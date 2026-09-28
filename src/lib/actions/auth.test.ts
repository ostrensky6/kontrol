import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const signInWithPassword = vi.fn();
const signOut = vi.fn(async () => ({ error: null }));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { signInWithPassword, signOut },
  })),
}));

const { entrar } = await import("./auth");

function loginForm(senha: string) {
  const formData = new FormData();
  formData.set("email", "usuario@example.com");
  formData.set("senha", senha);
  return formData;
}

function loginAceito(appMetadata: Record<string, unknown>) {
  signInWithPassword.mockResolvedValue({
    data: { user: { app_metadata: appMetadata } },
    error: null,
  });
}

const futuro = new Date(Date.now() + 86_400_000).toISOString();
const passado = new Date(Date.now() - 86_400_000).toISOString();

describe("login com senha provisória", () => {
  beforeEach(() => {
    redirect.mockClear();
    signInWithPassword.mockReset();
    signOut.mockClear();
  });

  it("aceita a senha provisória individual dentro do prazo", async () => {
    loginAceito({ cadastrado_pelo_admin: true, senha_provisoria: true, senha_provisoria_expira_em: futuro });

    await expect(entrar({ ok: false }, loginForm("kx7M-4pqR-29tW"))).rejects.toThrow("NEXT_REDIRECT:/");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("recusa a senha fixa antiga mesmo que o Auth ainda a aceite", async () => {
    loginAceito({ cadastrado_pelo_admin: true, senha_provisoria: true });

    await expect(entrar({ ok: false }, loginForm("GIA2026"))).resolves.toEqual({
      ok: false,
      message:
        "Essa senha provisória antiga não vale mais. Peça ao administrador uma nova senha provisória.",
    });
    expect(signOut).toHaveBeenCalledOnce();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("recusa a senha provisória vencida", async () => {
    loginAceito({ cadastrado_pelo_admin: true, senha_provisoria: true, senha_provisoria_expira_em: passado });

    await expect(entrar({ ok: false }, loginForm("kx7M-4pqR-29tW"))).resolves.toEqual({
      ok: false,
      message: "Sua senha provisória venceu. Peça ao administrador uma nova.",
    });
    expect(signOut).toHaveBeenCalledOnce();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("não afeta quem já tem senha definitiva", async () => {
    loginAceito({ cadastrado_pelo_admin: true, senha_provisoria: false, senha_provisoria_expira_em: passado });

    await expect(entrar({ ok: false }, loginForm("minha-senha-pessoal"))).rejects.toThrow("NEXT_REDIRECT:/");
    expect(signOut).not.toHaveBeenCalled();
  });
});
