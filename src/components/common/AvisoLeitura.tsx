import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";

const lista = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" });

/**
 * Aviso de leitura que não respondeu (auditoria de 16/11, item 1): a tela diz
 * o que ficou sem dado em vez de mostrar lista vazia ou zero como se fosse
 * fato. Sem falha, não aparece.
 */
export function AvisoLeitura({ falhas, className }: { falhas: readonly string[]; className?: string }) {
  if (falhas.length === 0) return null;
  return (
    <div
      role="alert"
      className={cn(
        "mb-4 flex items-start gap-3 rounded-xl border border-warning-strong/30 bg-warning-soft px-4 py-3 text-sm text-warning-strong",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-semibold">Parte desta tela não carregou</p>
        <p className="mt-0.5">
          Sem dado de {lista.format(falhas)}. O que aparece abaixo pode estar incompleto: recarregue a página antes de
          decidir por ela.
        </p>
      </div>
    </div>
  );
}
