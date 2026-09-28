"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Tela de erro de uma área (error.tsx): diz o que não abriu, oferece tentar de
 * novo e um caminho de volta. Mesmo visual do erro geral (app/error.tsx); em
 * produção o Next esconde a mensagem do servidor e fica só o código.
 */
export function ErroTela({
  error,
  retry,
  titulo,
  explicacao,
  voltarHref,
  voltarRotulo,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  titulo: string;
  explicacao: string;
  voltarHref: string;
  voltarRotulo: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const mensagem = process.env.NODE_ENV === "production" ? null : error.message || null;

  return (
    <main className="app-page-container">
      <div role="alert" className="mx-auto mt-10 max-w-lg rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-warning-soft text-warning-strong">
          <AlertTriangle className="h-5 w-5" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-semibold">{titulo}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{explicacao}</p>
        {mensagem && (
          <p className="mt-3 rounded-md bg-muted px-3 py-2 text-left font-mono text-xs text-foreground">{mensagem}</p>
        )}
        {error.digest && (
          <p className="mt-3 text-xs text-muted-foreground">
            Código: <span className="font-mono">{error.digest}</span>
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse justify-center gap-2 sm:flex-row">
          <Button asChild variant="ghost">
            <Link href={voltarHref}>{voltarRotulo}</Link>
          </Button>
          <Button type="button" onClick={() => retry()}>
            <RotateCcw />
            Tentar de novo
          </Button>
        </div>
      </div>
    </main>
  );
}
