import { beforeEach, describe, expect, it, vi } from "vitest";

// D7 (0136): fechar a campanha de inventário pelo banco, com a mensagem dele
// quando ainda há diferença sem ajuste.

const revalidatePath = vi.fn();
const pode = vi.fn();
const rpc = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/permissao-efetiva", () => ({ pode }));
vi.mock("@/lib/supabase/server", () => ({
  createClientUntyped: vi.fn(async () => ({ rpc })),
  createClient: vi.fn(async () => ({ rpc })),
}));

function formulario(ciclo = "7") {
  const formData = new FormData();
  formData.set("ciclo_id", ciclo);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  pode.mockResolvedValue(true);
  rpc.mockResolvedValue({ data: { ciclo_id: 7, contagens: 5, ajustes: 2 }, error: null });
});

describe("fecharCicloInventario", () => {
  it("fecha pela RPC e resume contagens e ajustes", async () => {
    const { fecharCicloInventario } = await import("./inventario");

    const resultado = await fecharCicloInventario({ ok: false }, formulario());

    expect(rpc).toHaveBeenCalledWith("fechar_ciclo_inventario", { p_ciclo_id: 7 });
    expect(resultado).toEqual({ ok: true, message: "Campanha fechada: 5 contagem(ns), 2 ajuste(s) aplicado(s)." });
    expect(revalidatePath).toHaveBeenCalledWith("/estoque/inventario");
  });

  it("devolve a recusa do banco quando há diferença sem ajuste", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "Há 1 contagem(ns) com diferença sem ajuste aplicado. Aplique os ajustes antes de fechar a campanha." },
    });
    const { fecharCicloInventario } = await import("./inventario");

    const resultado = await fecharCicloInventario({ ok: false }, formulario());

    expect(resultado.ok).toBe(false);
    expect(resultado.message).toContain("sem ajuste aplicado");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("exige a permissão de corrigir estoque", async () => {
    pode.mockResolvedValue(false);
    const { fecharCicloInventario } = await import("./inventario");

    const resultado = await fecharCicloInventario({ ok: false }, formulario());

    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("recusa campanha inválida sem chamar o banco", async () => {
    const { fecharCicloInventario } = await import("./inventario");

    const resultado = await fecharCicloInventario({ ok: false }, formulario("abc"));

    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
