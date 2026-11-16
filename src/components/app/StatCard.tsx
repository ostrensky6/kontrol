import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

const DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground/50",
  success: "bg-success-strong",
  warning: "bg-warning-strong",
  danger: "bg-danger-strong",
  info: "bg-info-strong",
  brand: "bg-primary",
};

const VALUE: Record<Tone, string> = {
  neutral: "text-foreground",
  success: "text-foreground",
  warning: "text-foreground",
  danger: "text-danger-strong",
  info: "text-foreground",
  brand: "text-foreground",
};

/** KPI padrão: label discreto, valor tabular grande, detalhe opcional. Cor só no ponto de estado. */
export function StatCard({
  label,
  value,
  detail,
  tone = "neutral",
  icon: Icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-4 shadow-xs", className)}>
      {/* o rótulo nunca é cortado com reticências: se não couber, quebra em duas linhas */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium leading-tight text-muted-foreground">{label}</span>
        {Icon ? (
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", DOT[tone])} aria-hidden="true" />
        )}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", VALUE[tone])}>
        {value}
      </div>
      {detail && <p className="mt-1 text-xs leading-snug text-muted-foreground">{detail}</p>}
    </div>
  );
}
