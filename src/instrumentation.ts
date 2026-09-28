import type { Instrumentation } from "next";

/**
 * Monitor de erros (auditoria de 28/09/2026). Todo erro que o servidor do Next
 * captura (tela, rota de API, server action, proxy) e toda recusa técnica que
 * mensagemDoBanco esconde do usuário vão para `erros_app` (0141). Uma rotina
 * de hora em hora avisa os administradores em Notificações.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ definirRelatorErroBanco }, { registrarErro }] = await Promise.all([
    import("@/lib/erros"),
    import("@/lib/monitoramento/erros"),
  ]);
  definirRelatorErroBanco((erro) => {
    void registrarErro({
      origem: "banco",
      mensagem: erro.message ?? "Recusa do banco sem mensagem",
      codigo: erro.code ?? null,
      detalhe: erro.details ?? null,
    });
  });
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const erro = err as Error & { digest?: string };
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    console.error("[kontrol-erro]", context.routePath, erro.digest, erro.message);
    return;
  }
  const { registrarErro } = await import("@/lib/monitoramento/erros");
  await registrarErro({
    origem: "servidor",
    mensagem: erro.message,
    // O arquivo da rota (/aprovar/[token]), nunca o caminho com o token.
    rota: context.routePath,
    digest: erro.digest ?? null,
    detalhe: [`${context.routeType} ${request.method}`, erro.stack].filter(Boolean).join("\n"),
  });
};
