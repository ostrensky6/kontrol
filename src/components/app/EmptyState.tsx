import { Inbox, SearchX, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Estado vazio padrão para listas, tabelas e seções sem dados. */
export function EmptyState({
  icon: Icon = SearchX,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex max-w-sm flex-col items-center gap-2 py-6 text-center",
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

/**
 * Estado vazio de uma seção pequena (documentos, comunicações, linha do tempo):
 * uma linha só, com o ícone do assunto numa bolinha, no lugar do texto solto.
 */
export function VazioCompacto({
  icon: Icon = Inbox,
  children,
  className,
}: {
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p data-vazio="" className={cn("flex items-center gap-2.5 text-sm text-muted-foreground", className)}>
      <span
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span>{children}</span>
    </p>
  );
}
