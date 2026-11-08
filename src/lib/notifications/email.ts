import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { caminhoNotificacao, rotuloTipoNotificacao } from "@/lib/notifications/links";

type SupabaseLike = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

type NotificationEmailRow = {
  id: number;
  versao: number;
  tipo: string;
  titulo: string;
  corpo: string | null;
  entidade_tipo: string | null;
  entidade_id: number | null;
  criado_em: string;
};

export type EmailDispatchResult = {
  enabled: boolean;
  sent: number;
  failed: number;
  accepted: number;
  acceptedUnconfirmed: number;
  reconciliationRequired: number;
  skippedReason?: "CONFIGURACAO_AUSENTE_OU_INVALIDA" | "FILA_NAO_CONFIRMADA" | "CLAIM_NAO_CONFIRMADO";
};

type Dependencias = {
  env?: Readonly<Record<string, string | undefined>>;
  post?: typeof fetch;
  now?: () => number;
  operacaoId?: () => string;
};

const LIMITE = 20;
const ENDPOINT = "https://api.resend.com/emails";
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+$/;
const CHAVE = /^[A-Za-z0-9_./:-]{1,256}$/;

function configuracao(env: NonNullable<Dependencias["env"]>) {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM?.trim();
  const appUrl = env.NEXT_PUBLIC_APP_URL || (env.VERCEL_URL && `https://${env.VERCEL_URL}`);
  if (env.NOTIFICATION_EMAIL_DURABLE_ENABLED !== "1" || !apiKey || !from || !appUrl ||
    /[\r\n]/.test(apiKey) || /[\r\n]/.test(from)) return null;
  try {
    const url = new URL(appUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    const fallback = (env.NOTIFICATION_EMAIL_TO ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    if (fallback.some((value) => !EMAIL.test(value))) return null;
    return { apiKey, from, baseUrl: url.href.replace(/\/$/, ""), fallback };
  } catch {
    return null;
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function emailHtml(row: NotificationEmailRow, baseUrl: string) {
  const url = escapeHtml(`${baseUrl}${caminhoNotificacao(row.entidade_tipo, row.entidade_id) ?? "/notificacoes"}`);
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

function registro(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function inteiroPositivo(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function candidato(value: unknown): value is NotificationEmailRow {
  const row = registro(value);
  return Boolean(row && inteiroPositivo(row.id) && inteiroPositivo(row.versao) &&
    typeof row.tipo === "string" && typeof row.titulo === "string" &&
    (row.corpo === null || typeof row.corpo === "string") &&
    (row.entidade_tipo === null || typeof row.entidade_tipo === "string") &&
    (row.entidade_id === null || inteiroPositivo(row.entidade_id)) &&
    typeof row.criado_em === "string" && Number.isFinite(Date.parse(row.criado_em)));
}

async function rpc(supabase: SupabaseLike, fn: string, args: Record<string, unknown>) {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    return error ? null : data;
  } catch {
    return null; // Nunca devolver mensagem da RPC, parâmetros ou resposta do provedor.
  }
}

function corresponde(recibo: Record<string, unknown> | null, row: NotificationEmailRow, operacao: string) {
  return recibo?.notificacao_id === row.id && recibo.versao === row.versao && recibo.operacao_id === operacao;
}

type Resultado = "ACEITO" | "RECUSA_CONFIRMADA" | "INCERTO" | "REVISAO_NECESSARIA";

async function postar(post: typeof fetch, apiKey: string, chave: string, payload: string) {
  let resultado: Resultado = "INCERTO";
  let codigo: number | null = null;
  let provedorId: string | null = null;
  try {
    const response = await post(ENDPOINT, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": chave,
      },
      body: payload,
    });
    if (Number.isInteger(response.status) && response.status >= 200 && response.status <= 599) codigo = response.status;
    if (codigo !== null && codigo >= 200 && codigo < 300) {
      resultado = "ACEITO";
      // A evidência opcional não invalida o aceite HTTP se o corpo estiver ausente.
      const id = registro(await response.json().catch(() => null))?.id;
      if (typeof id === "string" && UUID.test(id)) provedorId = id;
    } else if (codigo === 409) {
      resultado = "REVISAO_NECESSARIA";
    } else if (codigo !== null && [400, 401, 403, 404, 405, 413, 415, 422].includes(codigo)) {
      resultado = "RECUSA_CONFIRMADA";
    }
  } catch {
    // Transporte incerto não é recusa, não é entrega e não autoriza nova tentativa.
  }
  return { resultado, codigo, provedorId };
}

/** Envia apenas a primeira autorização durável; não possui caminho de reapresentação. */
export async function dispatchPendingNotificationEmails(
  supabase: SupabaseLike,
  deps: Dependencias = {},
): Promise<EmailDispatchResult> {
  const resumo: EmailDispatchResult = { enabled: false, sent: 0, failed: 0, accepted: 0, acceptedUnconfirmed: 0, reconciliationRequired: 0 };
  const config = configuracao(deps.env ?? process.env);
  if (!config) return { ...resumo, skippedReason: "CONFIGURACAO_AUSENTE_OU_INVALIDA" };
  const fila = await rpc(supabase, "listar_email_operacional_v1", { p_limite: LIMITE });
  if (!Array.isArray(fila) || fila.length > LIMITE || !fila.every(candidato) ||
    new Set(fila.map((row) => row.id)).size !== fila.length) {
    return { ...resumo, skippedReason: "FILA_NAO_CONFIRMADA" };
  }
  resumo.enabled = true;
  const now = deps.now ?? Date.now;
  const novaOperacao = deps.operacaoId ?? randomUUID;
  for (const row of fila) {
    // Lista fixa é apenas candidata quando a resolução está vazia. O claim
    // exige autorização privada de fallback; env não concede essa autorização.
    const lista = await rpc(supabase, "destinatarios_notificacao", { p_notificacao_id: row.id });
    if (!Array.isArray(lista) || !lista.every((email): email is string => typeof email === "string" && EMAIL.test(email))) {
      resumo.failed += 1;
      continue;
    }
    const to = lista.length ? lista : config.fallback;
    if (!to.length) {
      resumo.failed += 1;
      continue;
    }
    const operacao = novaOperacao();
    const payload = JSON.stringify({
      from: config.from,
      to,
      subject: `[Kontrol] ${row.titulo}`,
      html: emailHtml(row, config.baseUrl),
    });
    const digest = createHash("sha256").update(payload).digest("hex");
    const identidade = { p_notificacao_id: row.id, p_versao: row.versao, p_operacao_id: operacao };
    const claim = registro(await rpc(supabase, "iniciar_post_email_operacional_v1", {
      ...identidade, p_payload: payload,
    }));
    if (claim && corresponde(claim, row, operacao) && claim.autorizou_post === false) continue;
    const lease = typeof claim?.lease_ate === "string" && /(?:Z|[+-]\d{2}:\d{2})$/i.test(claim.lease_ate)
      ? Date.parse(claim.lease_ate)
      : NaN;
    if (!claim || !corresponde(claim, row, operacao) || claim.autorizou_post !== true ||
      claim.estado !== "POST_INICIADO" || claim.payload_sha256 !== digest || !inteiroPositivo(claim.geracao) ||
      typeof claim.chave_idempotencia !== "string" || !CHAVE.test(claim.chave_idempotencia) ||
      !Number.isFinite(lease) || !(now() < lease)) {
      resumo.failed += 1;
      resumo.reconciliationRequired += 1;
      return { ...resumo, enabled: false, skippedReason: "CLAIM_NAO_CONFIRMADO" };
    }
    const envio = await postar(deps.post ?? fetch, config.apiKey, claim.chave_idempotencia, payload);
    if (envio.resultado === "ACEITO") resumo.accepted += 1;
    // Geração expirada não finaliza: a recuperação é responsabilidade do estado durável.
    const recibo = now() < lease ? registro(await rpc(supabase, "registrar_resultado_email_operacional_v1", {
      ...identidade,
      p_geracao: claim.geracao,
      p_resultado: envio.resultado,
      p_codigo_http: envio.codigo,
      p_id_provedor: envio.provedorId,
    })) : null;
    const mesmaPosse = recibo && corresponde(recibo, row, operacao) && recibo.geracao === claim.geracao;
    if (envio.resultado === "ACEITO" && mesmaPosse &&
      recibo.estado === "ACEITE_REGISTRADO" && recibo.marcador_confirmado === true) {
      resumo.sent += 1;
    } else {
      resumo.failed += 1;
      if (envio.resultado === "ACEITO") resumo.acceptedUnconfirmed += 1;
      if (envio.resultado !== "RECUSA_CONFIRMADA" || !mesmaPosse ||
        recibo.estado !== "RECUSA_CONFIRMADA" || recibo.marcador_confirmado !== false) {
        resumo.reconciliationRequired += 1;
      }
    }
  }
  return resumo;
}
