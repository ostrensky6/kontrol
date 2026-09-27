"use client";

/** `destaque`: ação principal da página (a proposta do cliente). */
export function PrintButton({ destaque = false }: { destaque?: boolean }) {
  return (
    <button
      onClick={() => window.print()}
      className={
        destaque
          ? "inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          : "rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted"
      }
    >
      Imprimir / PDF
    </button>
  );
}
