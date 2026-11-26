import { cn } from "@/lib/utils";
import type { Tone } from "@/components/app/StatCard";
import { statusInfo } from "@/components/app/status";
import { FORMA_ETIQUETA } from "@/components/common/Etiqueta";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success-soft text-success-strong",
  warning: "bg-warning-soft text-warning-strong",
  danger: "bg-danger-soft text-danger-strong",
  info: "bg-info-soft text-info-strong",
  brand: "bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300",
};

// só a cor da letra: a variante "ponto" não tem fundo
const TONE_TEXTO: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  success: "text-success-strong",
  warning: "text-warning-strong",
  danger: "text-danger-strong",
  info: "text-info-strong",
  brand: "text-brand-700 dark:text-brand-300",
};

/**
 * Badge de status de domínio. `label` sobrepõe o rótulo do dicionário quando necessário.
 *
 * `variante="ponto"` troca a pílula por um ponto colorido e o nome: é para a
 * linha de tabela em que o status é longo e quebraria em duas linhas dentro de
 * uma pílula (lista de Pedidos). O texto pode quebrar; a pílula, não.
 */
export function StatusBadge({
  status,
  label,
  className,
  variante = "pilula",
}: {
  status: string;
  label?: string;
  className?: string;
  variante?: "pilula" | "ponto";
}) {
  const info = statusInfo(status);
  if (variante === "ponto") {
    return (
      <span className={cn("flex items-baseline gap-1.5 text-xs font-semibold leading-4", TONE_TEXTO[info.tone], className)}>
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 -translate-y-px rounded-full bg-current" />
        <span>{label ?? info.label}</span>
      </span>
    );
  }
  return (
    <span data-etiqueta="" className={cn(FORMA_ETIQUETA, TONE_CLASSES[info.tone], className)}>
      {label ?? info.label}
    </span>
  );
}
