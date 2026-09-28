import { cn } from "@/lib/utils";

/**
 * Card de seção com cabeçalho padronizado. Substitui <section className="rounded-lg border..."> ad hoc.
 * Explicação da seção vai em `help` (um <HelpTip> ao lado do título), não em `description`.
 */
export function SectionCard({
  title,
  description,
  help,
  actions,
  children,
  className,
  contentClassName,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  help?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const hasHeader = Boolean(title || description || help || actions);
  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground shadow-xs",
        className,
      )}
    >
      {hasHeader && (
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-b border-border/70 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {(title || help) && (
              // o "?" fica fora do h2 para não entrar no nome acessível do título
              <div className="flex items-center gap-1">
                {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
                {help}
              </div>
            )}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn("p-4", contentClassName)}>{children}</div>
    </section>
  );
}
