"use client";

import { startTransition, useActionState, useEffect, useRef, type ReactNode } from "react";
import { unstable_rethrow } from "next/navigation";
import { salvarDemanda, type DemandaFormState } from "@/lib/actions/demandas";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

const initialState: DemandaFormState = { ok: false };
const SALVAMENTO_NAO_CONFIRMADO =
  "Não foi possível confirmar o salvamento. Os dados continuam neste formulário. Confira o registro antes de tentar novamente.";

async function salvarComEstado(
  state: DemandaFormState,
  formData: FormData,
): Promise<DemandaFormState> {
  if (navigator.onLine === false) {
    return {
      ok: false,
      message: "Alterações não enviadas. Os dados continuam neste formulário. Tente novamente quando houver conexão.",
    };
  }

  try {
    return await salvarDemanda(state, formData);
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: SALVAMENTO_NAO_CONFIRMADO };
  }
}

/**
 * Formulário "Dados do orçamento": os grupos de campos vêm como filhos
 * (grade de 12 colunas); a barra de salvar fica presa no pé da tela.
 * "Salvar e ir para …" grava e já abre a próxima etapa (antes o fluxo "morria"
 * no salvar). O que falta nos dados só é exigido para emitir a proposta: a
 * barra informa, mas não impede de seguir (dono, 28/09).
 */
export function SalvarDemandaForm({
  children,
  pendencias = [],
  rotuloContinuar = null,
}: {
  children: ReactNode;
  pendencias?: string[];
  /** nome da próxima etapa; com ele aparece o botão "Salvar e ir para …" */
  rotuloContinuar?: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [estadoNativo, acaoNativa, pendenteNativo] = useActionState(salvarDemanda, initialState);
  const [estadoLocal, acaoLocal, pendenteLocal] = useActionState(salvarComEstado, initialState);
  const state = estadoLocal === initialState ? estadoNativo : estadoLocal;
  const pending = pendenteNativo || pendenteLocal;
  const salvamentoConfirmado = state.ok && Boolean(state.savedAt);
  const mensagem = state.ok && !state.savedAt
    ? SALVAMENTO_NAO_CONFIRMADO
    : state.message;
  const salvamentoLocal = estadoLocal.ok ? estadoLocal.savedAt : undefined;

  useEffect(() => {
    if (salvamentoLocal) formRef.current?.reset();
  }, [salvamentoLocal]);

  return (
    <form
      ref={formRef}
      action={acaoNativa}
      {...formularioSemPerda(salvamentoConfirmado ? state : { ok: false, message: mensagem })}
      onSubmit={(event) => {
        // Após hidratar, preserva os campos até confirmar; sem JS, vale a action nativa.
        event.preventDefault();
        if (pending) return;
        const dados = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
        startTransition(() => acaoLocal(dados));
      }}
      aria-busy={pending}
      className="mt-3 space-y-3"
    >
      {children}
      <div className="sticky bottom-0 z-10 shadow-[0_-4px_12px_-6px_rgba(15,23,42,0.18)] -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t border-border bg-card px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
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
          {pendencias.length > 0 && (
            <span className="text-xs text-warning-strong">
              Para emitir a proposta, falta: {pendencias.join("; ")}. Pode seguir e completar depois.
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Enter no campo usa o primeiro botão (só salvar); o principal salva e segue. */}
          <button
            type="submit"
            disabled={pending}
            className={rotuloContinuar
              ? "min-h-10 rounded-md border border-input bg-card px-4 py-2 text-sm font-medium hover:bg-muted disabled:cursor-wait disabled:opacity-60"
              : "min-h-10 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"}
          >
            {pending ? "Salvando…" : "Salvar orçamento"}
          </button>
          {rotuloContinuar && (
            <button
              type="submit"
              name="continuar"
              value="1"
              disabled={pending}
              className="min-h-10 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
            >
              Salvar e ir para {rotuloContinuar} →
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
