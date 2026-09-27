"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Mostra a senha provisória recém-gerada, uma única vez, com botão para copiar. */
export function SenhaProvisoriaGerada({ senha }: { senha: string }) {
  const [copiada, setCopiada] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(senha);
      setCopiada(true);
    } catch {
      setCopiada(false);
    }
  }

  return (
    <div role="status" className="rounded-lg border border-warning-strong/40 bg-warning-soft p-3 text-warning-strong">
      <p className="text-xs font-semibold">Senha provisória</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code
          data-testid="senha-provisoria-gerada"
          className="select-all rounded bg-card px-2 py-1 font-mono text-base font-semibold tracking-wide text-foreground"
        >
          {senha}
        </code>
        <Button type="button" variant="outline" size="sm" onClick={copiar}>
          {copiada ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copiada ? "Copiada" : "Copiar"}
        </Button>
      </div>
      <p className="mt-2 text-xs leading-5">
        Anote ou copie agora: ela não será mostrada de novo. Passe para a pessoa por um canal
        direto (WhatsApp ou pessoalmente). No primeiro acesso ela cria a senha pessoal.
      </p>
    </div>
  );
}
