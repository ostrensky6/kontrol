/**
 * Envia um erro de tela para /api/erros. Chamado pelas telas de erro
 * (error.tsx, global-error.tsx); nunca lança e não espera a resposta.
 * Erro com `digest` veio do servidor e já foi registrado pelo
 * onRequestError do instrumentation.ts: não manda de novo.
 */
export function reportarErroDaTela(error: Error & { digest?: string }): void {
  if (typeof window === "undefined" || error.digest) return;
  try {
    const corpo = JSON.stringify({
      mensagem: String(error.message ?? "").slice(0, 2000),
      rota: window.location.pathname,
      detalhe: String(error.stack ?? "").slice(0, 8000),
    });
    void fetch("/api/erros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: corpo,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // sem rede ou sem fetch: a tela de erro continua funcionando
  }
}
