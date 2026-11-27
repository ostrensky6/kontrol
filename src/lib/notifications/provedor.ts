/**
 * Ajuste 1 de 27/11/2026: o Resend está em modo de teste (sem domínio
 * verificado) e recusava todo destinatário que não fosse o dono da conta.
 * Com SMTP_USER e SMTP_PASS (senha de app do Gmail de compras), o envio sai
 * por SMTP; sem eles, continua pelo Resend.
 */
export function provedorEmail(env: NodeJS.ProcessEnv = process.env): "smtp" | "resend" | null {
  if (env.SMTP_USER && env.SMTP_PASS) return "smtp";
  if (env.RESEND_API_KEY) return "resend";
  return null;
}
