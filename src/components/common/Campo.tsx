import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Campo padrão de formulário (revisão de 11/11, 10.4): rótulo em frase normal
 * acima do controle, uma frase curta de apoio abaixo quando precisa de
 * explicação e o erro junto do campo. O controle vem dos componentes padrão
 * (`Input`, `Select`, `Textarea`) e leva o mesmo `id` de `htmlFor`.
 */
export function Campo({
  rotulo,
  htmlFor,
  dica,
  erro,
  className,
  children,
}: {
  rotulo: string;
  htmlFor: string;
  /** uma frase curta; explicação longa vai na ajuda da seção */
  dica?: React.ReactNode;
  erro?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={htmlFor} className="block">
        {rotulo}
      </Label>
      <div className="mt-1">{children}</div>
      {dica && <p className="mt-1 text-xs text-muted-foreground">{dica}</p>}
      {erro && (
        <p role="alert" className="mt-1 text-xs text-danger-strong">
          {erro}
        </p>
      )}
    </div>
  );
}
