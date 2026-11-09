import "server-only";
import { after } from "next/server";
import { createAdminClientUntyped } from "@/lib/supabase/admin";
import { dispatchEntityNotificationEmails } from "./email";

type Cliente = Parameters<typeof dispatchEntityNotificationEmails>[0];

/** Só envia quando o servidor tem o Resend e a chave de serviço (nunca no modo de teste). */
export function envioImediatoLigado(env: NodeJS.ProcessEnv = process.env) {
  if (env.PLAYWRIGHT_MOCK_SUPABASE === "1") return false;
  if (!env.RESEND_API_KEY || !env.NEXT_PUBLIC_SUPABASE_URL) return false;
  return Boolean(env.SUPABASE_AUTH_ADMIN_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * 0173: depois de uma passagem de etapa, manda na hora o e-mail dos avisos que
 * o banco acabou de gerar para o pedido (quem precisa agir e o solicitante).
 * Roda depois da resposta (after), então não atrasa a tela; uma falha fica
 * registrada no aviso e o envio diário tenta de novo.
 */
export function enviarAvisosDoPedidoAgora(pedidoId: number) {
  if (!Number.isInteger(pedidoId) || pedidoId <= 0 || !envioImediatoLigado()) return;
  after(async () => {
    try {
      await dispatchEntityNotificationEmails(
        createAdminClientUntyped() as unknown as Cliente,
        "pedido_interno",
        pedidoId,
      );
    } catch (erro) {
      console.error("Kontrol: e-mail imediato do pedido interno não enviado", pedidoId, erro);
    }
  });
}
