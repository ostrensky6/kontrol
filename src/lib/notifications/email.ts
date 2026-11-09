import { caminhoNotificacao, rotuloTipoNotificacao } from "@/lib/notifications/links";

type Resultado<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      is: (column: string, value: null) => {
        neq: (column: string, value: string) => {
          lt: (column: string, value: number) => {
            order: (
              column: string,
              options: { ascending: boolean },
            ) => {
              limit: (count: number) => Resultado<NotificationEmailRow[]>;
            };
          };
        };
      };
    };
    update: (values: Record<string, unknown>) => FiltroUpdate;
  };
  rpc: (fn: string, args: Record<string, unknown>) => Resultado<unknown>;
};

/** Encadeamento de filtros do update (PostgREST). */
type FiltroUpdate = PromiseLike<{ error: { message: string } | null }> & {
  eq: (column: string, value: number) => FiltroUpdate;
  is: (column: string, value: null) => FiltroUpdate;
  select: (columns: string) => Resultado<{ id: number }[]>;
};

type NotificationEmailRow = {
  id: number;
  tipo: string;
  titulo: string;
  corpo: string | null;
  entidade_tipo: string | null;
  entidade_id: number | null;
  criado_em: string;
  email_tentativas: number | null;
};

type EmailDispatchResult = {
  enabled: boolean;
  sent: number;
  failed: number;
  /** Avisos que outro envio simultâneo já tinha reservado. */
  skipped?: number;
  skippedReason?: string;
};

const COLUNAS_AVISO = "id,tipo,titulo,corpo,entidade_tipo,entidade_id,criado_em,email_tentativas";

/** Depois disso o aviso deixa de ser tentado por e-mail (continua no app). */
const MAX_TENTATIVAS = 5;

/** Lista fixa só para avisos sem destinatário identificável (opcional). */
function recipientsFromEnv() {
  return (process.env.NOTIFICATION_EMAIL_TO ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function appBaseUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function notificationUrl(row: NotificationEmailRow) {
  return `${appBaseUrl()}${caminhoNotificacao(row.entidade_tipo, row.entidade_id) ?? "/notificacoes"}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function emailHtml(row: NotificationEmailRow) {
  const url = notificationUrl(row);
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#18181b">
      <p style="font-size:12px;text-transform:uppercase;color:#71717a;margin:0 0 8px">Kontrol · ${escapeHtml(rotuloTipoNotificacao(row.tipo))}</p>
      <h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(row.titulo)}</h1>
      ${row.corpo ? `<p style="font-size:14px;margin:0 0 16px">${escapeHtml(row.corpo)}</p>` : ""}
      <p style="font-size:14px;margin:0 0 16px">
        <a href="${url}" style="color:#047857;font-weight:700">Abrir no Kontrol</a>
      </p>
      <p style="font-size:12px;color:#71717a;margin:0">Gerada em ${escapeHtml(row.criado_em)}.</p>
    </div>
  `;
}

/**
 * A chave de idempotência é a mesma em todas as tentativas do mesmo aviso: se
 * o envio deu certo mas a marcação no banco falhou, a nova tentativa não
 * manda o e-mail de novo (o Resend reconhece a chave por 24 horas).
 */
export function chaveIdempotencia(row: Pick<NotificationEmailRow, "id">) {
  return `kontrol-notificacao-${row.id}`;
}

async function sendWithResend(row: NotificationEmailRow, to: string[]) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": chaveIdempotencia(row),
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? "Kontrol <onboarding@resend.dev>",
      to,
      subject: `[Kontrol] ${row.titulo}`,
      html: emailHtml(row),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Resend HTTP ${response.status}`);
  }
}

/**
 * Destinatários do aviso pelo destino gravado (pessoa, permissão ou papel),
 * calculados no banco (public.destinatarios_notificacao, 0128). Sem ninguém,
 * cai na lista fixa NOTIFICATION_EMAIL_TO, se houver.
 */
async function destinatarios(supabase: SupabaseLike, row: NotificationEmailRow, fallback: string[]) {
  const { data, error } = await supabase.rpc("destinatarios_notificacao", { p_notificacao_id: row.id });
  if (error) throw new Error(error.message);
  const emails = Array.isArray(data)
    ? data.filter((item): item is string => typeof item === "string" && item.includes("@"))
    : [];
  return emails.length > 0 ? emails : fallback;
}

export async function dispatchPendingNotificationEmails(
  supabase: SupabaseLike,
): Promise<EmailDispatchResult> {
  if (!process.env.RESEND_API_KEY) {
    return { enabled: false, sent: 0, failed: 0, skippedReason: "RESEND_API_KEY ausente" };
  }

  const { data, error } = await supabase
    .from("notificacoes")
    .select(COLUNAS_AVISO)
    .is("email_enviado_em", null)
    .neq("status", "arquivada")
    .lt("email_tentativas", MAX_TENTATIVAS)
    .order("criado_em", { ascending: true })
    .limit(20);

  if (error) throw new Error(error.message);
  return enviarAvisos(supabase, data ?? []);
}

/** Consulta dos avisos de um registro (pedido interno, compra…) ainda sem e-mail. */
type ConsultaAvisosDoRegistro = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string | number) => {
        eq: (column: string, value: string | number) => {
          is: (column: string, value: null) => {
            neq: (column: string, value: string) => {
              lt: (column: string, value: number) => {
                order: (column: string, options: { ascending: boolean }) => {
                  limit: (count: number) => Resultado<NotificationEmailRow[]>;
                };
              };
            };
          };
        };
      };
    };
  };
};

/**
 * 0173: envia na hora os e-mails dos avisos que uma ação acabou de gerar
 * (passagem de etapa do pedido), sem esperar o envio diário. Usa a mesma
 * reserva por tentativa: se o envio diário pegar o mesmo aviso, só um manda.
 */
export async function dispatchEntityNotificationEmails(
  supabase: SupabaseLike,
  entidadeTipo: string,
  entidadeId: number,
): Promise<EmailDispatchResult> {
  if (!process.env.RESEND_API_KEY) {
    return { enabled: false, sent: 0, failed: 0, skippedReason: "RESEND_API_KEY ausente" };
  }
  const consulta = supabase as unknown as ConsultaAvisosDoRegistro;
  const { data, error } = await consulta
    .from("notificacoes")
    .select(COLUNAS_AVISO)
    .eq("entidade_tipo", entidadeTipo)
    .eq("entidade_id", entidadeId)
    .is("email_enviado_em", null)
    .neq("status", "arquivada")
    .lt("email_tentativas", MAX_TENTATIVAS)
    .order("criado_em", { ascending: true })
    .limit(10);
  if (error) throw new Error(error.message);
  return enviarAvisos(supabase, data ?? []);
}

async function enviarAvisos(supabase: SupabaseLike, linhas: NotificationEmailRow[]): Promise<EmailDispatchResult> {
  const fallback = recipientsFromEnv();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of linhas) {
    const tentativas = Number(row.email_tentativas ?? 0);
    // Reserva a tentativa antes de enviar: só passa se ninguém mexeu no aviso
    // desde a leitura. Dois envios ao mesmo tempo não mandam o mesmo e-mail.
    const { data: reservado, error: erroReserva } = await supabase
      .from("notificacoes")
      .update({ email_tentativas: tentativas + 1 })
      .eq("id", row.id)
      .eq("email_tentativas", tentativas)
      .is("email_enviado_em", null)
      .select("id");
    if (erroReserva) throw new Error(erroReserva.message);
    if (!reservado || reservado.length === 0) {
      skipped += 1;
      continue;
    }
    let enviado = false;
    try {
      const to = await destinatarios(supabase, row, fallback);
      if (to.length === 0) throw new Error("Nenhum destinatário com e-mail para este aviso.");
      await sendWithResend(row, to);
      enviado = true;
      const { error: updateError } = await supabase
        .from("notificacoes")
        .update({ email_enviado_em: new Date().toISOString(), email_erro: null })
        .eq("id", row.id);
      if (updateError) throw new Error(updateError.message);
      sent += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Falha desconhecida";
      // Se o e-mail saiu e só a marcação falhou, a próxima tentativa usa a
      // mesma chave de idempotência e o Resend não reenvia.
      await supabase
        .from("notificacoes")
        .update({ email_erro: (enviado ? `Enviado, mas não marcado: ${message}` : message).slice(0, 500) })
        .eq("id", row.id);
    }
  }

  return { enabled: true, sent, failed, skipped };
}
