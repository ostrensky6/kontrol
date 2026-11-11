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
  labelInteiro = false,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
  className?: string;
  /** rótulo comprido quebra em duas linhas em vez de ser cortado com reticências */
  labelInteiro?: boolean;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-4 shadow-xs", className)}>
      <div className={cn("flex justify-between gap-2", labelInteiro ? "items-start" : "items-center")}>
        <span
          className={cn(
            "text-xs font-medium uppercase tracking-wide text-muted-foreground",
            labelInteiro ? "leading-tight" : "truncate",
          )}
          title={labelInteiro ? undefined : label}
        >
          {label}
        </span>
        {Icon ? (
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <span className={cn("h-2 w-2 shrink-0 rounded-full", labelInteiro && "mt-1", DOT[tone])} aria-hidden="true" />
        )}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", VALUE[tone])}>
        {value}
      </div>
      {detail && <p className="mt-1 text-xs leading-snug text-muted-foreground">{detail}</p>}
    </div>
  );
}
