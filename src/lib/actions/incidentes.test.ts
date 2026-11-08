import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  rpc: vi.fn(async (..._a: unknown[]) => ({ data: 1 as unknown, error: null as null | { message: string; code?: string } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped: async () => ({ rpc: io.rpc }) }));

import { atualizarIncidente, registrarIncidente } from "./incidentes";

const form = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };
const base = { titulo: "Freezer parado", descricao: "Desligou.", afetados: "Laboratório", orientacao: "Use o reserva." };

beforeEach(() => vi.clearAllMocks());

describe("registrarIncidente", () => {
  it("envia ao banco com causa vazia como desconhecida", async () => {
    const r = await registrarIncidente({ ok: false }, form({ ...base, causa: "  " }));
    expect(r.ok).toBe(true);
    expect(io.rpc).toHaveBeenCalledWith("registrar_incidente", {
      p_titulo: "Freezer parado", p_descricao: "Desligou.", p_afetados: "Laboratório",
      p_orientacao: "Use o reserva.", p_causa: null, p_papel_destino: "laboratorio",
    });
  });
  it("aponta campos faltando sem chamar o banco", async () => {
    const r = await registrarIncidente({ ok: false }, form({ ...base, orientacao: "", papel_destino: "chefe" }));
    expect(r.ok).toBe(false);
    expect(r.errors).toMatchObject({ orientacao: expect.any(String), papel_destino: expect.any(String) });
    expect(io.rpc).not.toHaveBeenCalled();
  });
  it("mostra a recusa do banco", async () => {
    io.rpc.mockResolvedValueOnce({ data: null, error: { message: "Somente Coordenador, Gestor, Supervisor ou Administrador registram incidentes.", code: "42501" } });
    const r = await registrarIncidente({ ok: false }, form(base));
    expect(r.message).toContain("Somente Coordenador");
  });
});

describe("atualizarIncidente", () => {
  it("registra a resolução", async () => {
    const r = await atualizarIncidente({ ok: false }, form({ incidente_id: "4", situacao: "resolvido", nota: "Religado.", causa: "Disjuntor" }));
    expect(r).toEqual({ ok: true, message: "Incidente marcado como resolvido." });
    expect(io.rpc).toHaveBeenCalledWith("atualizar_incidente", {
      p_incidente_id: 4, p_situacao: "resolvido", p_nota: "Religado.", p_causa: "Disjuntor", p_orientacao: null,
    });
  });
  it("recusa situação desconhecida ou nota vazia", async () => {
    expect((await atualizarIncidente({ ok: false }, form({ incidente_id: "4", situacao: "sumido", nota: "x" }))).ok).toBe(false);
    expect((await atualizarIncidente({ ok: false }, form({ incidente_id: "4", situacao: "aberto", nota: " " }))).ok).toBe(false);
    expect(io.rpc).not.toHaveBeenCalled();
  });
});
