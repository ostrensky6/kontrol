"use client";

import { useEffect } from "react";

import { reportarErroDaTela } from "@/lib/monitoramento/reportar-no-navegador";

/**
 * Erro no próprio layout raiz (menu, sessão): substitui a página inteira, então
 * não conta com o CSS nem com os componentes do app. Estilo mínimo embutido,
 * legível nos dois temas.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
    reportarErroDaTela(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          background: "Canvas",
          color: "CanvasText",
          colorScheme: "light dark",
        }}
      >
        <title>Kontrol: erro</title>
        <main role="alert" style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", margin: "0 0 8px" }}>O Kontrol não abriu</h1>
          <p style={{ margin: "0 0 16px", lineHeight: 1.5 }}>
            Algo falhou ao carregar o app. O erro foi registrado. Tente de novo; se continuar, avise
            o suporte com o código abaixo.
          </p>
          {error.digest && (
            <p style={{ margin: "0 0 16px", fontSize: "0.8rem" }}>
              Código: <span style={{ fontFamily: "ui-monospace, monospace" }}>{error.digest}</span>
            </p>
          )}
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              font: "inherit",
              padding: "10px 18px",
              minHeight: "44px",
              borderRadius: "8px",
              border: "1px solid currentColor",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            Tentar de novo
          </button>
        </main>
      </body>
    </html>
  );
}
