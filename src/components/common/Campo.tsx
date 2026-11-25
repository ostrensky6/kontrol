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
  obrigatorio = false,
  children,
}: {
  rotulo: string;
  /** marca o rótulo com * (o controle também leva `required`) */
  obrigatorio?: boolean;
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
        {obrigatorio && <MarcaObrigatorio />}
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

/**
 * O * vermelho de campo obrigatório, o mesmo do Novo orçamento e dos
 * cadastros. Fica fora da leitura de tela: o controle já diz que é obrigatório.
 */
export function MarcaObrigatorio() {
  return (
    <span aria-hidden="true" className="ml-0.5 font-semibold text-danger-strong">
      *
    </span>
  );
}

/** Legenda curta para o topo do formulário que usa o *. */
export function LegendaObrigatorio({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      Campos com <MarcaObrigatorio /> são obrigatórios.
    </p>
  );
}
