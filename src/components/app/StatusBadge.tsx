import { cn } from "@/lib/utils";
import type { Tone } from "@/components/app/StatCard";
import { statusInfo } from "@/components/app/status";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success-soft text-success-strong",
  warning: "bg-warning-soft text-warning-strong",
  danger: "bg-danger-soft text-danger-strong",
  info: "bg-info-soft text-info-strong",
  brand: "bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300",
};

/** Badge de status de domínio. `label` sobrepõe o rótulo do dicionário quando necessário. */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  label?: string;
  className?: string;
}) {
  const info = statusInfo(status);
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
        TONE_CLASSES[info.tone],
        className,
      )}
    >
      {label ?? info.label}
    </span>
  );
}
