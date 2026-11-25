import { cn } from "@/lib/utils";

/**
 * Número do passo num círculo: mostra a ordem da tela (primeiro os dados que
 * você informa, depois o resultado). Fica fora da leitura de tela; o título ao
 * lado já diz o que é.
 */
export function NumeroPasso({
  n,
  tom = "entrada",
  className,
}: {
  n: number | string;
  /** "entrada": dado que você informa; "resultado": o que o Kontrol calcula */
  tom?: "entrada" | "resultado";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
        tom === "entrada" ? "bg-primary text-primary-foreground" : "bg-success-soft text-success-strong ring-1 ring-success-strong/30",
        className,
      )}
    >
      {n}
    </span>
  );
}
