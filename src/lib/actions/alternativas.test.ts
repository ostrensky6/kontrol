import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  rpc: vi.fn(async (..._args: unknown[]) => ({ data: { id: 1 } as null | { id: number }, error: null as null | { message: string; code?: string } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped: async () => ({ rpc: io.rpc }) }));

import { validarAlternativaInsumo } from "./alternativas";

const form = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};

beforeEach(() => vi.clearAllMocks());

describe("validar alternativa de insumo", () => {
  it("chama a função do banco com a decisão", async () => {
    const r = await validarAlternativaInsumo({ ok: false }, form({ insumo_analise_id: "7", codigo_analise: "PCR", decisao: "invalida", observacao: "Não amplifica" }));
    expect(r.ok).toBe(true);
    expect(io.rpc).toHaveBeenCalledWith("validar_alternativa_insumo", { p_insumo_analise_id: 7, p_decisao: "invalida", p_observacao: "Não amplifica" });
  });

  it("exige observação e decisão conhecida", async () => {
    expect((await validarAlternativaInsumo({ ok: false }, form({ insumo_analise_id: "7", decisao: "valida", observacao: " " }))).ok).toBe(false);
    expect((await validarAlternativaInsumo({ ok: false }, form({ insumo_analise_id: "7", decisao: "talvez", observacao: "x" }))).ok).toBe(false);
    expect(io.rpc).not.toHaveBeenCalled();
  });

  it("mostra a recusa do banco", async () => {
    io.rpc.mockResolvedValueOnce({ data: null, error: { message: "O grupo \"kit\" ficaria sem nenhuma alternativa válida.", code: "23514" } });
    const r = await validarAlternativaInsumo({ ok: false }, form({ insumo_analise_id: "7", decisao: "invalida", observacao: "x" }));
    expect(r.ok).toBe(false);
  });
});
