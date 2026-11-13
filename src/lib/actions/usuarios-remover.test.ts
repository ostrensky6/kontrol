import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 0180: trocar a função na lista e remover quem saiu da equipe sem apagar o histórico.

const revalidatePath = vi.fn();
const temPapel = vi.fn();
const usuarioAtual = vi.fn();
const updateUserById = vi.fn();
const perfilUpdate = vi.fn();
const preUpdate = vi.fn();
const preDelete = vi.fn();
let linhasUpdate: { data: Record<string, unknown>[] | null; error: { message: string } | null };
let suspensoAntes = false;
let indicacoes: Record<string, Record<string, unknown>[]> = {};

function encadeado(resultado: () => unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["eq", "or", "select"]) q[m] = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => resultado());
  q.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(resultado()).then(ok, erro);
  return q;
}

function from(tabela: string) {
  if (tabela === "perfis") {
    return {
      update: (dados: unknown) => {
        perfilUpdate(dados);
        return encadeado(() => linhasUpdate);
      },
      select: () => encadeado(() => ({ data: { suspenso: suspensoAntes }, error: null })),
    };
  }
  if (tabela === "usuarios_pre_aprovados") {
    return {
      update: (dados: unknown) => {
        preUpdate(dados);
        return encadeado(() => ({ data: [{ nome: "Pré" }], error: null }));
      },
      delete: () => {
        preDelete();
        return encadeado(() => ({ data: [{ nome: "Pré", email: "pre@kontrol.test" }], error: null }));
      },
    };
  }
  return { select: () => encadeado(() => ({ data: indicacoes[tabela] ?? [], error: null })) };
}

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/roles", () => ({ temPapel, usuarioAtual }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from })),
  createClientUntyped: vi.fn(async () => ({ from })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ auth: { admin: { updateUserById } } })),
  mensagemErroAdminSupabase: vi.fn((error: { message?: string } | null | undefined) => error?.message ?? "Falha."),
}));

afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.stubEnv("PLAYWRIGHT_MOCK_SUPABASE", undefined);
  vi.clearAllMocks();
  temPapel.mockResolvedValue(true);
  usuarioAtual.mockResolvedValue({ id: "admin-atual" });
  updateUserById.mockResolvedValue({ error: null });
  linhasUpdate = { data: [{ nome: "Fulana", email: "fulana@kontrol.test", suspenso: true }], error: null };
  suspensoAntes = false;
  indicacoes = {};
});

function fd(campos: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

describe("alterarFuncaoUsuario", () => {
  it("passa Laboratório para Administrativo com o padrão da nova função", async () => {
    linhasUpdate = { data: [{ nome: "Fulana", email: "fulana@kontrol.test" }], error: null };
    const { alterarFuncaoUsuario } = await import("./usuarios");
    const r = await alterarFuncaoUsuario(fd({ id: "u1", papel: "administrativo" }));
    expect(r).toEqual({ ok: true, message: "Fulana agora é Administrativo." });
    expect(perfilUpdate).toHaveBeenCalledWith({ papel: "administrativo", permissoes: {} });
    expect(revalidatePath).toHaveBeenCalledWith("/usuarios");
  });

  it("troca a função de um pré-aprovado", async () => {
    const { alterarFuncaoUsuario } = await import("./usuarios");
    const r = await alterarFuncaoUsuario(fd({ pre_aprovado_id: "3", papel: "administrativo" }));
    expect(r.ok).toBe(true);
    expect(preUpdate).toHaveBeenCalledWith({ papel: "administrativo", permissoes: {} });
  });

  it("recusa função desconhecida e quem não é Administrador", async () => {
    const { alterarFuncaoUsuario } = await import("./usuarios");
    expect((await alterarFuncaoUsuario(fd({ id: "u1", papel: "chefe" }))).ok).toBe(false);
    temPapel.mockResolvedValue(false);
    expect((await alterarFuncaoUsuario(fd({ id: "u1", papel: "compra" }))).ok).toBe(false);
    expect(perfilUpdate).not.toHaveBeenCalled();
  });

  it("não deixa o Administrador tirar a própria função", async () => {
    usuarioAtual.mockResolvedValue({ id: "u1" });
    const { alterarFuncaoUsuario } = await import("./usuarios");
    const r = await alterarFuncaoUsuario(fd({ id: "u1", papel: "administrativo" }));
    expect(r.ok).toBe(false);
    expect(perfilUpdate).not.toHaveBeenCalled();
  });
});

describe("removerUsuario", () => {
  it("bloqueia o login, marca removido e guarda o histórico", async () => {
    const { removerUsuario } = await import("./usuarios");
    const r = await removerUsuario(fd({ id: "u1" }));
    expect(r.ok).toBe(true);
    expect(r.message).toContain("histórico");
    expect(updateUserById).toHaveBeenCalledWith("u1", { ban_duration: "876000h" });
    const dados = perfilUpdate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(dados.suspenso).toBe(true);
    expect(typeof dados.removido_em).toBe("string");
    expect(dados.removido_por).toBe("admin-atual");
  });

  it("aponta onde a pessoa ainda está indicada", async () => {
    indicacoes = {
      projetos: [{ nome: "Y va'e" }],
      responsaveis_compras: [{ etapa: "pagamento", usuario_id: "u1", substituto_id: null }],
    };
    const { removerUsuario } = await import("./usuarios");
    const r = await removerUsuario(fd({ id: "u1" }));
    expect(r.message).toContain("coordenação do projeto Y va'e");
    expect(r.message).toContain("responsável do pagamento");
  });

  it("devolve o login quando o perfil não muda", async () => {
    linhasUpdate = { data: null, error: { message: "permission denied" } };
    const { removerUsuario } = await import("./usuarios");
    const r = await removerUsuario(fd({ id: "u1" }));
    expect(r.ok).toBe(false);
    expect(updateUserById).toHaveBeenNthCalledWith(2, "u1", { ban_duration: "none" });
  });

  it("não remove a si mesmo", async () => {
    usuarioAtual.mockResolvedValue({ id: "u1" });
    const { removerUsuario } = await import("./usuarios");
    expect((await removerUsuario(fd({ id: "u1" }))).ok).toBe(false);
    expect(updateUserById).not.toHaveBeenCalled();
  });
});

describe("reativar e pré-aprovado", () => {
  it("reativar limpa a marca de removido", async () => {
    linhasUpdate = { data: [{ id: "u1" }], error: null };
    const { alternarSuspensao } = await import("./usuarios");
    const r = await alternarSuspensao(fd({ id: "u1", suspender: "0" }));
    expect(r.ok).toBe(true);
    expect(perfilUpdate).toHaveBeenCalledWith({ suspenso: false, removido_em: null, removido_por: null });
  });

  it("retira a pré-aprovação de quem nunca entrou", async () => {
    const { excluirPreAprovado } = await import("./usuarios");
    const r = await excluirPreAprovado(fd({ pre_aprovado_id: "3" }));
    expect(r.ok).toBe(true);
    expect(preDelete).toHaveBeenCalled();
  });
});
