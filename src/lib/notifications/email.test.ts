import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchEntityNotificationEmails, dispatchPendingNotificationEmails } from "./email";

type Chamada = { tabela: string; valores: Record<string, unknown>; filtros: Record<string, unknown> };

function supabaseFalso(destinatarios: string[], opcoes: { reservaPerdida?: boolean; marcacaoFalha?: boolean } = {}) {
  const updates: Chamada[] = [];
  const filtrosConsulta: Record<string, unknown> = {};
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
  const filtro = (chamada: Chamada) => {
    const f = {
      eq: (coluna: string, valor: number) => { chamada.filtros[coluna] = valor; return f; },
      is: (coluna: string, valor: null) => { chamada.filtros[coluna] = valor; return f; },
      // reserva: update ... select("id")
      select: async () => ({ data: opcoes.reservaPerdida ? [] : [{ id: 10 }], error: null }),
      then: (ok: (v: { error: { message: string } | null }) => unknown) =>
        Promise.resolve({ error: opcoes.marcacaoFalha && "email_enviado_em" in chamada.valores ? { message: "falhou" } : null }).then(ok),
    };
    return f;
  };
  const cliente = {
    from: (tabela: string) => ({
      select: () => {
        const consulta = {
          is: () => ({
            neq: () => ({
              lt: () => ({
                order: () => ({ limit: async () => ({ data: linhas, error: null }) }),
              }),
            }),
          }),
          // 0173: avisos de um registro (entidade_tipo, entidade_id)
          eq: (coluna: string, valor: unknown) => {
            filtrosConsulta[coluna] = valor;
            return consulta;
          },
        };
        return consulta;
      },
      update: (valores: Record<string, unknown>) => {
        const chamada: Chamada = { tabela, valores, filtros: {} };
        updates.push(chamada);
        return filtro(chamada);
      },
    }),
    rpc: vi.fn(async () => ({ data: destinatarios, error: null })),
  };
  return { cliente: cliente as typeof cliente & Parameters<typeof dispatchPendingNotificationEmails>[0], updates, filtrosConsulta };
}

describe("dispatchPendingNotificationEmails", () => {
  const ambiente = process.env;
  const fetchOriginal = globalThis.fetch;
  let enviados: Array<{ to: string[]; html: string; chave: string | null }>;

  beforeEach(() => {
    process.env = { ...ambiente, RESEND_API_KEY: "teste", NEXT_PUBLIC_APP_URL: "https://kontrol.test" };
    delete process.env.NOTIFICATION_EMAIL_TO;
    enviados = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: { body?: unknown; headers?: Record<string, string> }) => {
      const corpo = JSON.parse(String(init?.body ?? "{}")) as { to: string[]; html: string };
      enviados.push({ ...corpo, chave: init?.headers?.["Idempotency-Key"] ?? null });
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
    // primeiro reserva a tentativa (só se ninguém mexeu), depois marca o envio
    expect(updates[0].valores).toEqual({ email_tentativas: 1 });
    expect(updates[0].filtros).toMatchObject({ id: 10, email_tentativas: 0, email_enviado_em: null });
    expect(updates[1].valores).toMatchObject({ email_erro: null });
    expect(updates[1].valores.email_enviado_em).toBeTruthy();
    expect(enviados[0].chave).toBe("kontrol-notificacao-10");
  });

  it("sem destinatário e sem lista fixa, registra o erro em vez de mandar para todos", async () => {
    const { cliente, updates } = supabaseFalso([]);
    const resultado = await dispatchPendingNotificationEmails(cliente);
    expect(resultado).toMatchObject({ sent: 0, failed: 1 });
    expect(enviados).toHaveLength(0);
    expect(String(updates[1].valores.email_erro)).toContain("Nenhum destinatário");
  });

  it("sem destinatário, usa a lista fixa como reserva", async () => {
    process.env.NOTIFICATION_EMAIL_TO = "equipe@example.com";
    const { cliente } = supabaseFalso([]);
    await dispatchPendingNotificationEmails(cliente);
    expect(enviados[0].to).toEqual(["equipe@example.com"]);
  });

  it("se outro envio já reservou o aviso, não manda de novo", async () => {
    const { cliente, updates } = supabaseFalso(["coord@example.com"], { reservaPerdida: true });
    const resultado = await dispatchPendingNotificationEmails(cliente);
    expect(resultado).toMatchObject({ sent: 0, failed: 0, skipped: 1 });
    expect(enviados).toHaveLength(0);
    expect(updates).toHaveLength(1);
  });

  it("e-mail saiu mas a marcação falhou: registra e a próxima tentativa usa a mesma chave", async () => {
    const { cliente, updates } = supabaseFalso(["coord@example.com"], { marcacaoFalha: true });
    const resultado = await dispatchPendingNotificationEmails(cliente);
    expect(resultado).toMatchObject({ sent: 0, failed: 1 });
    expect(String(updates[2].valores.email_erro)).toContain("Enviado, mas não marcado");
    await dispatchPendingNotificationEmails(cliente);
    expect(enviados.map((e) => e.chave)).toEqual(["kontrol-notificacao-10", "kontrol-notificacao-10"]);
  });

  it("0173: envia na hora os avisos de um pedido, com a mesma reserva", async () => {
    const { cliente, updates, filtrosConsulta } = supabaseFalso(["nathieli@example.com"]);
    const resultado = await dispatchEntityNotificationEmails(cliente, "pedido_interno", 3);
    expect(filtrosConsulta).toEqual({ entidade_tipo: "pedido_interno", entidade_id: 3 });
    expect(resultado).toMatchObject({ enabled: true, sent: 1, failed: 0 });
    expect(enviados[0].to).toEqual(["nathieli@example.com"]);
    expect(updates[0].valores).toEqual({ email_tentativas: 1 });
  });

  it("0173: sem Resend configurado, não tenta enviar", async () => {
    delete process.env.RESEND_API_KEY;
    const { cliente } = supabaseFalso(["nathieli@example.com"]);
    const resultado = await dispatchEntityNotificationEmails(cliente, "pedido_interno", 3);
    expect(resultado).toMatchObject({ enabled: false, sent: 0 });
    expect(enviados).toHaveLength(0);
  });
});
