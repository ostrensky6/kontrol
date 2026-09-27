"use client";

import { useActionState, type ReactNode } from "react";
import { salvarDemanda, type DemandaFormState } from "@/lib/actions/demandas";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

const initialState: DemandaFormState = { ok: false };
const salvarComEstado: (
  state: DemandaFormState,
  formData: FormData,
) => Promise<DemandaFormState> = salvarDemanda;

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
      className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      {children}
      {mensagem ? (
        <div
          role={salvamentoConfirmado ? "status" : "alert"}
          aria-live={salvamentoConfirmado ? "polite" : "assertive"}
          aria-atomic="true"
          className={`sm:col-span-2 rounded-md px-3 py-2 text-sm ${
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
      ) : null}
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Salvando…" : "Salvar orçamento"}
        </button>
      </div>
    </form>
  );
}
