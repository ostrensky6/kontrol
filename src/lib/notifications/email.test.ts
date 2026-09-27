import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchPendingNotificationEmails } from "./email";

type Chamada = { tabela: string; valores: Record<string, unknown>; id: number };

function supabaseFalso(destinatarios: string[]) {
  const updates: Chamada[] = [];
  const linhas = [
    {
      id: 10,
      tipo: "aprovacao_pendente",
      titulo: "Pedido interno aguardando validação",
      corpo: "Pedido interno #3",
      entidade_tipo: "pedido_interno",
      entidade_id: 3,
      criado_em: "2026-09-26T10:00:00Z",
      email_tentativas: 0,
    },
  ];
  const cliente = {
    from: (tabela: string) => ({
      select: () => ({
        is: () => ({
          neq: () => ({
            lt: () => ({
              order: () => ({ limit: async () => ({ data: linhas, error: null }) }),
            }),
          }),
        }),
      }),
      update: (valores: Record<string, unknown>) => ({
        eq: async (_coluna: string, id: number) => {
          updates.push({ tabela, valores, id });
          return { error: null };
        },
      }),
    }),
    rpc: vi.fn(async () => ({ data: destinatarios, error: null })),
  };
  return { cliente, updates };
}

describe("dispatchPendingNotificationEmails", () => {
  const ambiente = process.env;
  const fetchOriginal = globalThis.fetch;
  let enviados: Array<{ to: string[]; html: string }>;

  beforeEach(() => {
    process.env = { ...ambiente, RESEND_API_KEY: "teste", NEXT_PUBLIC_APP_URL: "https://kontrol.test" };
    delete process.env.NOTIFICATION_EMAIL_TO;
    enviados = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const corpo = JSON.parse(String(init?.body ?? "{}")) as { to: string[]; html: string };
      enviados.push(corpo);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = ambiente;
    globalThis.fetch = fetchOriginal;
  });

  it("envia só para quem o banco aponta como destinatário, com link da etapa", async () => {
    const { cliente, updates } = supabaseFalso(["coord@example.com"]);
    const resultado = await dispatchPendingNotificationEmails(cliente);
    expect(resultado).toMatchObject({ enabled: true, sent: 1, failed: 0 });
    expect(cliente.rpc).toHaveBeenCalledWith("destinatarios_notificacao", { p_notificacao_id: 10 });
    expect(enviados[0].to).toEqual(["coord@example.com"]);
    expect(enviados[0].html).toContain("https://kontrol.test/pedido/3");
    expect(updates[0].valores).toMatchObject({ email_erro: null, email_tentativas: 1 });
  });

  it("sem destinatário e sem lista fixa, registra o erro em vez de mandar para todos", async () => {
    const { cliente, updates } = supabaseFalso([]);
    const resultado = await dispatchPendingNotificationEmails(cliente);
    expect(resultado).toMatchObject({ sent: 0, failed: 1 });
    expect(enviados).toHaveLength(0);
    expect(String(updates[0].valores.email_erro)).toContain("Nenhum destinatário");
  });

  it("sem destinatário, usa a lista fixa como reserva", async () => {
    process.env.NOTIFICATION_EMAIL_TO = "equipe@example.com";
    const { cliente } = supabaseFalso([]);
    await dispatchPendingNotificationEmails(cliente);
    expect(enviados[0].to).toEqual(["equipe@example.com"]);
  });
});
