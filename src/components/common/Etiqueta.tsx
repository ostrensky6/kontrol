import { cn } from "@/lib/utils";

export type TomEtiqueta = "neutro" | "sucesso" | "atencao" | "perigo" | "info" | "marca";

/**
 * Forma única das etiquetas de situação (rodada 11): pílula sem borda, letra de
 * 12 px em negrito leve. A cor vem do tom; a borda saiu porque duplicava o
 * contorno e pesava a linha da tabela.
 */
export const FORMA_ETIQUETA =
  "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold";

export const TOM_ETIQUETA: Record<TomEtiqueta, string> = {
  neutro: "bg-muted text-muted-foreground",
  sucesso: "bg-success-soft text-success-strong",
  atencao: "bg-warning-soft text-warning-strong",
  perigo: "bg-danger-soft text-danger-strong",
  info: "bg-info-soft text-info-strong",
  marca: "bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300",
};

/** Etiqueta de situação solta (fora do dicionário de status de `StatusBadge`). */
export function Etiqueta({
  tom = "neutro",
  className,
  ...props
}: React.ComponentProps<"span"> & { tom?: TomEtiqueta }) {
  return <span data-etiqueta="" className={cn(FORMA_ETIQUETA, TOM_ETIQUETA[tom], className)} {...props} />;
}
