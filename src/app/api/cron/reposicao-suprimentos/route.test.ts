import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { GET } from "./route";

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn().mockReturnValue({ rpc }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("Reposicao suprimentos cron route handler", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({
      data: {
        pedidos_criados: 1,
        itens_criados: 2,
        notificacoes_criadas: 3,
      },
      error: null,
    });
    process.env = { ...originalEnv };
    delete process.env.RESEND_API_KEY;
    delete process.env.NOTIFICATION_EMAIL_TO;
  });

  it("returns 401 if CRON_SECRET is missing", async () => {
    process.env.CRON_SECRET = "";

    const response = await GET(
      new Request("http://localhost/api/cron/reposicao-suprimentos", {
        headers: { authorization: "Bearer qualquer" },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
  });

  it("returns 401 if authorization header is invalid", async () => {
    process.env.CRON_SECRET = "segredo";

    const response = await GET(
      new Request("http://localhost/api/cron/reposicao-suprimentos", {
        headers: { authorization: "Bearer errado" },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
  });

  it("returns 500 if Supabase environment variables are missing", async () => {
    process.env.CRON_SECRET = "segredo";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "";

    const response = await GET(
      new Request("http://localhost/api/cron/reposicao-suprimentos", {
        headers: { authorization: "Bearer segredo" },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Missing Supabase environment variables",
    });
  });

  it("runs gerar_reposicao_automatica with service role credentials", async () => {
    process.env.CRON_SECRET = "segredo";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

    const response = await GET(
      new Request("http://localhost/api/cron/reposicao-suprimentos", {
        headers: { authorization: "Bearer segredo" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      job: "reposicao-suprimentos",
      email: {
        enabled: false,
        skippedReason: "envio de e-mail não configurado (SMTP_USER/SMTP_PASS ou RESEND_API_KEY)",
      },
      result: {
        pedidos_criados: 1,
        itens_criados: 2,
        notificacoes_criadas: 3,
      },
    });
    expect(createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "service-role-key",
      expect.any(Object),
    );
    expect(rpc).toHaveBeenCalledWith("gerar_reposicao_automatica");
  });

  it("returns 500 if the RPC fails", async () => {
    process.env.CRON_SECRET = "segredo";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    rpc.mockResolvedValue({ data: null, error: { message: "falha rpc" } });

    const response = await GET(
      new Request("http://localhost/api/cron/reposicao-suprimentos", {
        headers: { authorization: "Bearer segredo" },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "falha rpc",
    });
  });
});
