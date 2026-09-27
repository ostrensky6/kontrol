"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Erro inesperado numa tela: mantém o menu, explica em linguagem simples e
 * oferece tentar de novo. Em produção o Next esconde a mensagem do servidor;
 * o código (digest) ajuda o suporte a achar o registro.
 */
export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const mensagem =
    process.env.NODE_ENV === "production" ? null : error.message || null;

  return (
    <main className="app-page-container">
      <div className="mx-auto mt-10 max-w-lg rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-warning-soft text-warning-strong">
          <AlertTriangle className="h-5 w-5" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-semibold">Não foi possível concluir</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          O que você digitou nesta tela não foi salvo. Tente de novo; se continuar, avise o suporte
          com o código abaixo.
        </p>
        {mensagem && (
          <p className="mt-3 rounded-md bg-muted px-3 py-2 text-left font-mono text-xs text-foreground">
            {mensagem}
          </p>
        )}
        {error.digest && (
          <p className="mt-3 text-xs text-muted-foreground">
            Código: <span className="font-mono">{error.digest}</span>
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse justify-center gap-2 sm:flex-row">
          <Button asChild variant="ghost">
            <Link href="/">Ir para o início</Link>
          </Button>
          <Button type="button" onClick={() => unstable_retry()}>
            <RotateCcw />
            Tentar de novo
          </Button>
        </div>
      </div>
    </main>
  );
}
