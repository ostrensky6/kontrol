import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
const from = vi.fn();
const update = vi.fn();
const eq = vi.fn();
const select = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from })),
}));

function formulario(valores: Record<string, string>) {
  const formData = new FormData();
  formData.set("chaves", Object.keys(valores).join(","));
  for (const [chave, valor] of Object.entries(valores)) formData.set(`valor_${chave}`, valor);
  return formData;
}

describe("salvarParametros", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    from.mockReturnValue({ update });
    update.mockReturnValue({ eq });
    eq.mockReturnValue({ select });
  });

  it("confirma o salvamento quando a linha volta do banco", async () => {
    select.mockResolvedValue({ data: [{ chave: "horas_bancada_mes" }], error: null });
    const { salvarParametros } = await import("./parametros");

    const result = await salvarParametros({ ok: false }, formulario({ horas_bancada_mes: "12,5" }));

    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ valor: 12.5 }));
    expect(select).toHaveBeenCalledWith("chave");
    expect(revalidatePath).toHaveBeenCalledWith("/custeio");
  });

  it("acusa erro quando o RLS não deixa gravar nada (0 linhas, sem error)", async () => {
    select.mockResolvedValue({ data: [], error: null });
    const { salvarParametros } = await import("./parametros");

    const result = await salvarParametros({ ok: false }, formulario({ horas_bancada_mes: "10" }));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Não foi possível salvar "Horas de bancada por mês"/);
    expect(result.message).toMatch(/permissão/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("traduz o erro do banco", async () => {
    select.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const { salvarParametros } = await import("./parametros");

    const result = await salvarParametros({ ok: false }, formulario({ taxa_incubacao: "1" }));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/não tem permissão/);
    expect(result.message).not.toMatch(/permission denied/);
  });

  it("CAD-4: recusa fatores versionados, que só mudam em Parâmetros econômicos", async () => {
    const { salvarParametros } = await import("./parametros");

    const result = await salvarParametros({ ok: false }, formulario({ impostos: "10", horas_bancada_mes: "400" }));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Impostos: altere em Orçamento → Parâmetros econômicos/);
    expect(update).not.toHaveBeenCalled();
  });

  it("promete só novos cálculos, não recálculo de propostas", async () => {
    select.mockResolvedValue({ data: [{ chave: "janela_vencimento_dias" }], error: null });
    const { salvarParametros } = await import("./parametros");

    const result = await salvarParametros({ ok: false }, formulario({ janela_vencimento_dias: "90" }));

    expect(result).toEqual({ ok: true, message: "Parâmetros salvos. Valem para novos cálculos; propostas emitidas não mudam." });
  });
});
