import type { EstadoAcao } from "@/lib/erros";
import { cn } from "@/lib/utils";

/**
 * Retorno de uma action na tela. Fica sempre montado (região viva vazia) para
 * que o leitor de tela anuncie a mensagem quando ela aparecer.
 */
export function MensagemAcao({ estado, className }: { estado: EstadoAcao | null | undefined; className?: string }) {
  const texto = estado?.message;
  const erro = Boolean(texto) && !estado?.ok;
  return (
    <p
      role={erro ? "alert" : "status"}
      aria-live={erro ? "assertive" : "polite"}
      className={cn(
        "text-sm empty:hidden",
        erro ? "text-destructive" : "text-emerald-700 dark:text-emerald-400",
        className,
      )}
    >
      {texto ?? ""}
    </p>
  );
}
