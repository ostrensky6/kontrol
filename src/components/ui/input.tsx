import * as React from "react";

import { cn } from "@/lib/utils";
import { TOM_ENTRADA } from "@/lib/orcamento/tom-valor";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      // Evita que gerenciadores de senha (LastPass/1Password/Dashlane) injetem
      // ícones nos campos antes da hidratação, o que gera mismatch SSR↔cliente.
      // Sobrescrevível por chamadas que queiram autofill (ex.: login usa <input> cru).
      data-lpignore="true"
      data-1p-ignore=""
      data-form-type="other"
      suppressHydrationWarning
      className={cn(
        // §8.2: o valor digitado pelo usuário é entrada -> azul institucional.
        "flex h-9 w-full rounded-md border border-input bg-card px-3 py-2 text-sm font-medium shadow-xs transition-colors placeholder:text-muted-foreground placeholder:font-normal disabled:cursor-not-allowed disabled:opacity-50",
        TOM_ENTRADA,
        className,
      )}
      {...props}
    />
  );
}

export { Input };
