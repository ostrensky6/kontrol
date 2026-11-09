import { afterEach, describe, expect, it, vi } from "vitest";

const after = vi.fn();
vi.mock("next/server", () => ({ after: (fn: () => unknown) => after(fn) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClientUntyped: vi.fn(() => ({})) }));
const dispatch = vi.fn(async () => ({ enabled: true, sent: 1, failed: 0 }));
vi.mock("./email", () => ({ dispatchEntityNotificationEmails: (...args: unknown[]) => dispatch(...(args as [])) }));

import { enviarAvisosDoPedidoAgora, envioImediatoLigado } from "./envio-imediato";

const LIGADO = {
  RESEND_API_KEY: "teste",
  NEXT_PUBLIC_SUPABASE_URL: "https://exemplo.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "chave-de-teste",
} as unknown as NodeJS.ProcessEnv;

describe("envio imediato dos avisos do pedido (0173)", () => {
  const ambiente = process.env;
  afterEach(() => {
    process.env = ambiente;
    after.mockReset();
    dispatch.mockClear();
  });

  it("só liga com Resend, endereço e chave de serviço, e nunca no modo de teste", () => {
    expect(envioImediatoLigado(LIGADO)).toBe(true);
    expect(envioImediatoLigado({ ...LIGADO, RESEND_API_KEY: "" })).toBe(false);
    expect(envioImediatoLigado({ ...LIGADO, SUPABASE_SERVICE_ROLE_KEY: undefined })).toBe(false);
    expect(envioImediatoLigado({ ...LIGADO, PLAYWRIGHT_MOCK_SUPABASE: "1" })).toBe(false);
  });

  it("agenda o envio depois da resposta, só para os avisos do pedido", async () => {
    process.env = { ...ambiente, ...LIGADO };
    delete process.env.PLAYWRIGHT_MOCK_SUPABASE;
    enviarAvisosDoPedidoAgora(42);
    expect(after).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
    await (after.mock.calls[0][0] as () => Promise<void>)();
    expect(dispatch).toHaveBeenCalledWith({}, "pedido_interno", 42);
  });

  it("desligado (sem chaves ou id inválido), não agenda nada", () => {
    process.env = { ...ambiente, RESEND_API_KEY: "" };
    enviarAvisosDoPedidoAgora(42);
    process.env = { ...ambiente, ...LIGADO };
    enviarAvisosDoPedidoAgora(0);
    expect(after).not.toHaveBeenCalled();
  });
});
