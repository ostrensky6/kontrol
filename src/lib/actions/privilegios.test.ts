import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
const temPapel = vi.fn();
const clientFrom = vi.fn();
const adminFrom = vi.fn();
const select = vi.fn();
const upsert = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/roles", () => ({ temPapel }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: clientFrom })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: adminFrom })),
}));

describe("privilegios", () => {
  beforeEach(() => {
    vi.resetModules();
    revalidatePath.mockReset();
    temPapel.mockReset();
    clientFrom.mockReset();
    adminFrom.mockReset();
    select.mockReset();
    upsert.mockReset();

    clientFrom.mockReturnValue({ select });
    adminFrom.mockReturnValue({ upsert });
    select.mockResolvedValue({ data: [], error: null });
    upsert.mockResolvedValue({ error: null });
  });

  it("bloqueia leitura da matriz para nao-admin", async () => {
    temPapel.mockResolvedValue(false);
    const { obterMatrizPrivilegios } = await import("./privilegios");

    await expect(obterMatrizPrivilegios()).resolves.toBeNull();
    expect(clientFrom).not.toHaveBeenCalled();
  });

  it("le matriz de privilegios para admin", async () => {
    temPapel.mockResolvedValue(true);
    select.mockResolvedValue({
      data: [{ papel: "gestor", permissoes: { "auditoria.visualizar": false } }],
      error: null,
    });
    const { obterMatrizPrivilegios } = await import("./privilegios");

    const matriz = await obterMatrizPrivilegios();

    expect(matriz?.admin["auditoria.visualizar"]).toBe(true);
    expect(matriz?.gestor["auditoria.visualizar"]).toBe(false);
    expect(clientFrom).toHaveBeenCalledWith("permissoes_categorias");
  });

  it("bloqueia salvamento de privilegios para nao-admin", async () => {
    temPapel.mockResolvedValue(false);
    const { salvarMatrizPrivilegios } = await import("./privilegios");

    const result = await salvarMatrizPrivilegios({ ok: false }, new FormData());

    expect(result.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("salva a matriz inteira, só as funções que mudaram, e revalida as telas", async () => {
    temPapel.mockResolvedValue(true);
    const { buildPermissoesPorCategoria } = await import("@/lib/auth/permission-categories");
    const atual = buildPermissoesPorCategoria([]);
    const formData = new FormData();
    formData.set("permissoes_presentes", "1");
    // todas as funções repetem o que já vale, menos Gestor (perde auditoria) e Compra (ganha cadastros.editar)
    for (const papel of ["laboratorio", "compra", "cadastro", "coordenador", "gestor", "supervisor"] as const) {
      for (const [chave, pode] of Object.entries(atual[papel])) {
        if (!pode) continue;
        if (papel === "gestor" && chave === "auditoria.visualizar") continue;
        formData.append(`permissoes:${papel}`, chave);
      }
    }
    formData.append("permissoes:compra", "cadastros.editar");
    formData.append("permissoes:compra", "chave.inventada");
    // o admin nunca é gravado
    formData.append("permissoes:admin", "analises.ver");
    const { salvarMatrizPrivilegios } = await import("./privilegios");

    const result = await salvarMatrizPrivilegios({ ok: false }, formData);

    expect(result).toEqual({ ok: true, message: "Privilégios salvos: Compra, Gestor." });
    expect(upsert).toHaveBeenCalledOnce();
    const linhas = upsert.mock.calls[0]?.[0] as Array<{ papel: string; permissoes: Record<string, boolean> }>;
    expect(linhas.map((linha) => linha.papel)).toEqual(["compra", "gestor"]);
    expect(linhas[0].permissoes["cadastros.editar"]).toBe(true);
    expect(linhas[0].permissoes).not.toHaveProperty("chave.inventada");
    expect(linhas[1].permissoes["auditoria.visualizar"]).toBe(false);
    expect(revalidatePath).toHaveBeenCalledWith("/governanca/privilegios");
    expect(revalidatePath).toHaveBeenCalledWith("/usuarios");
  });

  it("desmarcar tudo de uma função grava tudo desligado (não volta ao padrão do código)", async () => {
    temPapel.mockResolvedValue(true);
    const formData = new FormData();
    formData.set("permissoes_presentes", "1");
    const { salvarMatrizPrivilegios } = await import("./privilegios");

    await salvarMatrizPrivilegios({ ok: false }, formData);

    const linhas = upsert.mock.calls[0]?.[0] as Array<{ papel: string; permissoes: Record<string, boolean> }>;
    expect(linhas.map((linha) => linha.papel)).toEqual(["laboratorio", "compra", "cadastro", "coordenador", "gestor", "supervisor"]);
    for (const linha of linhas) {
      expect(Object.values(linha.permissoes).every((pode) => pode === false)).toBe(true);
    }
  });

  it("sem o marcador do formulário, recusa (evita zerar a matriz por engano)", async () => {
    temPapel.mockResolvedValue(true);
    const { salvarMatrizPrivilegios } = await import("./privilegios");

    const result = await salvarMatrizPrivilegios({ ok: false }, new FormData());

    expect(result.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
});
