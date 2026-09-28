import { beforeEach, describe, expect, it, vi } from "vitest";
import { contaCriadaPeloLinkLocal, prepararContaLocal } from "./dev-conta-local";

// Depois de zerar o banco local, o link mágico do login automático recria a
// conta; pela 0132 ela nasce suspensa e técnica. O login local a promove a
// administrador; contas cadastradas pelo administrador ficam como estão.

describe("contaCriadaPeloLinkLocal", () => {
  it("reconhece a conta recriada pelo link mágico", () => {
    expect(contaCriadaPeloLinkLocal({ app_metadata: { provider: "email" } })).toBe(true);
    expect(contaCriadaPeloLinkLocal({})).toBe(true);
  });

  it("não mexe em conta cadastrada pelo administrador (teste de outros papéis)", () => {
    expect(contaCriadaPeloLinkLocal({ app_metadata: { cadastrado_pelo_admin: true } })).toBe(false);
  });

  it("sem conta, nada a fazer", () => {
    expect(contaCriadaPeloLinkLocal(null)).toBe(false);
  });
});

describe("prepararContaLocal", () => {
  const updateUserById = vi.fn();
  const update = vi.fn();
  const eq = vi.fn();
  const select = vi.fn();
  const admin = {
    auth: { admin: { updateUserById } },
    from: vi.fn(() => ({ update })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    updateUserById.mockResolvedValue({ error: null });
    update.mockReturnValue({ eq });
    eq.mockReturnValue({ select });
    select.mockResolvedValue({ data: [{ id: "conta-local" }], error: null });
  });

  it("marca a conta como cadastrada e o perfil como administrador ativo", async () => {
    const erro = await prepararContaLocal(admin as never, "conta-local");

    expect(erro).toBeNull();
    expect(updateUserById).toHaveBeenCalledWith("conta-local", {
      app_metadata: { cadastrado_pelo_admin: true, senha_provisoria: false },
      ban_duration: "none",
    });
    expect(admin.from).toHaveBeenCalledWith("perfis");
    expect(update).toHaveBeenCalledWith({ papel: "admin", suspenso: false, senha_provisoria: false });
    expect(eq).toHaveBeenCalledWith("id", "conta-local");
  });

  it("devolve o motivo quando o perfil não é ajustado", async () => {
    select.mockResolvedValue({ data: [], error: null });

    expect(await prepararContaLocal(admin as never, "conta-local")).toContain("perfil");
  });

  it("devolve o motivo quando o Auth recusa", async () => {
    updateUserById.mockResolvedValue({ error: { message: "auth fora do ar" } });

    expect(await prepararContaLocal(admin as never, "conta-local")).toContain("auth fora do ar");
    expect(update).not.toHaveBeenCalled();
  });
});
