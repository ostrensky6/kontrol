import Link from "next/link";

import { textoResumoAlertas, type ResumoAlertas } from "@/lib/cadastros/painel-decisao";
import { cn } from "@/lib/utils";

export const HREF_SITUACAO_ESTOQUE = "/estoque/situacao";

/**
 * Contagem do painel único de situação do estoque, para as telas que não são o
 * painel (D1): mostra o número e leva até ele. `resumo` null = leitura
 * incompleta, que aparece como "sem dado" e nunca como "nada urgente".
 */
export function CartaoSituacaoEstoque({ resumo, className }: { resumo: ResumoAlertas | null; className?: string }) {
  const tom =
    resumo === null
      ? "bg-muted text-muted-foreground"
      : resumo.urgentes > 0
        ? "bg-danger-soft text-danger-strong"
        : resumo.atencao > 0
          ? "bg-warning-soft text-warning-strong"
          : "bg-success-soft text-success-strong";
  const quadros = resumo?.quadros ?? [];
  return (
    <Link
      href={HREF_SITUACAO_ESTOQUE}
      data-testid="cartao-situacao-estoque"
      className={cn(
        "group flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-4 py-3 outline-none transition-colors hover:border-primary/60 focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    >
      <span className="text-sm font-semibold text-foreground">Situação do estoque</span>
      <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", tom)}>{textoResumoAlertas(resumo)}</span>
      <span className="min-w-0 text-sm text-muted-foreground">
        {quadros.length > 0
          ? `${quadros.slice(0, 3).join(" · ")}${quadros.length > 3 ? ` e mais ${quadros.length - 3}` : ""}`
          : "Saldo, compra, validade e lotes num painel só."}
      </span>
      <span className="ml-auto text-sm font-medium text-primary group-hover:underline">Abrir o painel</span>
    </Link>
  );
}
