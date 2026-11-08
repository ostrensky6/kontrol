import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  rpc: vi.fn(async (..._a: unknown[]) => ({ data: { transferido: 4 } as unknown, error: null as null | { message: string; code?: string } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped: async () => ({ rpc: io.rpc }) }));

import { decidirDisputaReserva, pedirReservaDeOutroPlano } from "./disputas-reserva";

const form = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };

beforeEach(() => vi.clearAllMocks());

describe("pedirReservaDeOutroPlano", () => {
  it("envia o pedido ao banco", async () => {
    const r = await pedirReservaDeOutroPlano({ ok: false }, form({ planejamento_id: "2", insumo_id: "7", motivo: "Começa antes" }));
    expect(r.ok).toBe(true);
    expect(io.rpc).toHaveBeenCalledWith("pedir_reserva_de_outro_plano", { p_planejamento_id: 2, p_insumo_id: 7, p_motivo: "Começa antes" });
  });
  it("exige motivo", async () => {
    expect((await pedirReservaDeOutroPlano({ ok: false }, form({ planejamento_id: "2", insumo_id: "7", motivo: " " }))).ok).toBe(false);
    expect(io.rpc).not.toHaveBeenCalled();
  });
});

describe("decidirDisputaReserva", () => {
  it("transfere do plano escolhido", async () => {
    const r = await decidirDisputaReserva({ ok: false }, form({ disputa_id: "5", decisao: "transferir", planejamento_origem_id: "1", observacao: "Prazo" }));
    expect(r.ok).toBe(true);
    expect(r.message).toContain("4");
    expect(io.rpc).toHaveBeenCalledWith("decidir_disputa_reserva", { p_disputa_id: 5, p_decisao: "transferir", p_planejamento_origem_id: 1, p_observacao: "Prazo" });
  });
  it("nega sem plano de origem", async () => {
    const r = await decidirDisputaReserva({ ok: false }, form({ disputa_id: "5", decisao: "negar", observacao: "Compra chega" }));
    expect(r).toEqual({ ok: true, message: "Pedido negado. Quem pediu foi avisado." });
    expect(io.rpc).toHaveBeenCalledWith("decidir_disputa_reserva", expect.objectContaining({ p_planejamento_origem_id: null }));
  });
  it("transferir sem origem não chama o banco; recusa do banco aparece", async () => {
    expect((await decidirDisputaReserva({ ok: false }, form({ disputa_id: "5", decisao: "transferir", observacao: "x" }))).ok).toBe(false);
    expect(io.rpc).not.toHaveBeenCalled();
    io.rpc.mockResolvedValueOnce({ data: null, error: { message: "Este pedido já foi decidido por outra pessoa. Recarregue a página.", code: "55000" } });
    const r = await decidirDisputaReserva({ ok: false }, form({ disputa_id: "5", decisao: "negar", observacao: "x" }));
    expect(r.message).toContain("já foi decidido");
  });
});
