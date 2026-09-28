"use client";

import { useActionState, type ReactNode } from "react";
import { salvarDemanda, type DemandaFormState } from "@/lib/actions/demandas";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

const initialState: DemandaFormState = { ok: false };
const salvarComEstado: (
  state: DemandaFormState,
  formData: FormData,
) => Promise<DemandaFormState> = salvarDemanda;

/**
 * Formulário "Dados do orçamento": os grupos de campos vêm como filhos
 * (grade de 12 colunas); a barra de salvar fica presa no pé da tela.
 */
export function SalvarDemandaForm({ children }: { children: ReactNode }) {
  const [state, formAction, pending] = useActionState(salvarComEstado, initialState);
  const salvamentoConfirmado = state.ok && Boolean(state.savedAt);
  const mensagem = state.ok && !state.savedAt
    ? "O salvamento não pôde ser confirmado. Tente novamente."
    : state.message;

  return (
    <form
      action={formAction}
      {...formularioSemPerda(salvamentoConfirmado ? state : { ok: false, message: mensagem })}
      aria-busy={pending}
      className="mt-3 space-y-3"
    >
      {children}
      <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t border-border bg-card/95 px-4 py-2.5 backdrop-blur">
        {mensagem ? (
          <div
            role={salvamentoConfirmado ? "status" : "alert"}
            aria-live={salvamentoConfirmado ? "polite" : "assertive"}
            aria-atomic="true"
            className={`rounded-md px-3 py-1.5 text-sm ${
              salvamentoConfirmado
                ? "bg-brand-50 text-brand-900 dark:bg-brand-950/40 dark:text-brand-200"
                : "bg-danger-soft text-danger-strong"
            }`}
          >
            {mensagem}
            {salvamentoConfirmado && state.savedAt ? (
              <span className="ml-2 text-xs opacity-75">
                Último salvamento: <time dateTime={state.savedAt}>{new Date(state.savedAt).toLocaleString("pt-BR")}</time>
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Alterações só valem depois de salvar.</span>
        )}
        <button
          type="submit"
          disabled={pending}
          className="min-h-10 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Salvando…" : "Salvar orçamento"}
        </button>
      </div>
    </form>
  );
}
