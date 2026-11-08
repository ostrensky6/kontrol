import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  rpc: vi.fn(async (..._a: unknown[]) => ({ data: {} as unknown, error: null as null | { message: string; code?: string } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped: async () => ({ rpc: io.rpc }) }));

import { alterarVinculoProjeto } from "./vinculos-projeto";

const form = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };
const uid = "00000000-0000-4000-8000-000000000001";

beforeEach(() => vi.clearAllMocks());

describe("alterarVinculoProjeto", () => {
  it("liga a pessoa pelo banco", async () => {
    const r = await alterarVinculoProjeto({ ok: false }, form({ projeto_id: "3", usuario_id: uid, vinculado: "1" }));
    expect(r.ok).toBe(true);
    expect(io.rpc).toHaveBeenCalledWith("configurar_vinculo_projeto", { p_projeto_id: 3, p_usuario_id: uid, p_vinculado: true });
  });
  it("recusa dados inválidos sem chamar o banco", async () => {
    expect((await alterarVinculoProjeto({ ok: false }, form({ projeto_id: "x", usuario_id: uid, vinculado: "1" }))).ok).toBe(false);
    expect((await alterarVinculoProjeto({ ok: false }, form({ projeto_id: "3", usuario_id: "abc", vinculado: "1" }))).ok).toBe(false);
    expect(io.rpc).not.toHaveBeenCalled();
  });
  it("mostra a recusa do banco", async () => {
    io.rpc.mockResolvedValueOnce({ data: null, error: { message: "Somente Administrador pode configurar o vínculo.", code: "42501" } });
    const r = await alterarVinculoProjeto({ ok: false }, form({ projeto_id: "3", usuario_id: uid, vinculado: "0" }));
    expect(r).toEqual({ ok: false, message: "Somente Administrador pode configurar o vínculo." });
  });
});
