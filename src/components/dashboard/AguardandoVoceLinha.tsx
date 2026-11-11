import Link from "next/link";

import { cn } from "@/lib/utils";
import { destinoDaPendencia, type Pendencia } from "./aguardando";

/** Quantas pendências a linha mostra pelo nome; o resto vai para o Início. */
const NA_LINHA = 3;

/**
 * "Sua vez" em uma linha (revisão de 11/11, D4): o quadro completo de
 * Aguardando você fica só no Início e no sino. Nas outras telas, a linha diz
 * o que espera a pessoa ali e leva direto ao registro ou à lista. Sem
 * pendência, não aparece.
 */
export function AguardandoVoceLinha({ pendencias, className }: { pendencias: Pendencia[]; className?: string }) {
  if (pendencias.length === 0) return null;
  const visiveis = pendencias.slice(0, NA_LINHA);
  const resto = pendencias.length - visiveis.length;
  return (
    <div
      role="status"
      aria-label="Sua vez"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm",
        className,
      )}
    >
      <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">Sua vez</span>
      {visiveis.map((p) => (
        <Link key={p.chave} href={destinoDaPendencia(p)} className="font-medium text-primary underline-offset-4 hover:underline">
          {p.frase}
        </Link>
      ))}
      {resto > 0 && (
        <Link href="/" className="text-muted-foreground underline-offset-4 hover:underline">
          e mais {resto} no Início
        </Link>
      )}
    </div>
  );
}
