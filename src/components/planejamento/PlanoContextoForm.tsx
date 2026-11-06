"use client";

import { useActionState, useEffect, useRef } from "react";

import { atualizarPlanejamentoExecutivo } from "@/lib/actions/planejamento";
import type { FormState } from "@/lib/actions/cadastros";
import { enviarSemReset } from "./enviarSemReset";

export type PlanoContextoValores = {
  nome: string;
  projetoId: number | null;
  prioridade: string;
  dataInicioPrevista: string;
  dataFimPrevista: string;
  dataAlvo: string;
  responsavel: string;
  observacao: string;
};

const inp =
  "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-brand-700 disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground dark:text-brand-300"; // §8.2: entrada em azul
const lbl = "block text-[10px] uppercase tracking-wide text-muted-foreground/80";

/**
 * Formulário do contexto operacional. Âncora `#editar`: ao chegar pela ação
 * "Editar" (lista ou cabeçalho), o foco vai para o primeiro campo.
 */
export function PlanoContextoForm({
  planId,
  valores,
  projetos,
  editavel,
  motivoSemEdicao,
}: {
  planId: number;
  valores: PlanoContextoValores;
  projetos: { id: number; nome: string | null }[];
  editavel: boolean;
  motivoSemEdicao: string | null;
}) {
  const nomeRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    atualizarPlanejamentoExecutivo,
    { ok: false },
  );

  useEffect(() => {
    function focarSeEditar() {
      if (window.location.hash !== "#editar") return;
      document.getElementById("editar")?.scrollIntoView({ block: "start" });
      nomeRef.current?.focus({ preventScroll: true });
    }
    focarSeEditar();
    window.addEventListener("hashchange", focarSeEditar);
    return () => window.removeEventListener("hashchange", focarSeEditar);
  }, []);

  const id = (campo: string) => `plano-${campo}`;

  return (
    <form onSubmit={enviarSemReset(formAction)} className="mt-4">
      <input type="hidden" name="planejamento_id" value={planId} />
      {!editavel && motivoSemEdicao && (
        <p className="mb-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          {motivoSemEdicao}
        </p>
      )}
      <fieldset disabled={!editavel || pending} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <legend className="sr-only">Contexto operacional</legend>
        <div className="md:col-span-2">
          <label htmlFor={id("nome")} className={lbl}>Nome</label>
          <input ref={nomeRef} id={id("nome")} name="nome" defaultValue={valores.nome} className={inp} />
        </div>
        <div>
          <label htmlFor={id("projeto")} className={lbl}>Projeto</label>
          <select id={id("projeto")} name="projeto_id" defaultValue={valores.projetoId ?? ""} className={inp}>
            <option value="">—</option>
            {projetos.map((p) => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={id("prioridade")} className={lbl}>Prioridade</label>
          <select id={id("prioridade")} name="prioridade" defaultValue={valores.prioridade} className={inp}>
            <option value="baixa">Baixa</option>
            <option value="normal">Normal</option>
            <option value="alta">Alta</option>
            <option value="urgente">Urgente</option>
          </select>
        </div>
        <div>
          <label htmlFor={id("inicio")} className={lbl}>Início previsto</label>
          <input id={id("inicio")} name="data_inicio_prevista" type="date" defaultValue={valores.dataInicioPrevista} className={inp} />
        </div>
        <div>
          <label htmlFor={id("fim")} className={lbl}>Fim previsto</label>
          <input id={id("fim")} name="data_fim_prevista" type="date" defaultValue={valores.dataFimPrevista} className={inp} />
        </div>
        <div>
          <label htmlFor={id("alvo")} className={lbl}>Data alvo</label>
          <input id={id("alvo")} name="data_alvo" type="date" defaultValue={valores.dataAlvo} className={inp} />
        </div>
        <div>
          <label htmlFor={id("responsavel")} className={lbl}>Responsável</label>
          <input id={id("responsavel")} name="responsavel" defaultValue={valores.responsavel} className={inp} />
        </div>
        <div className="md:col-span-2 xl:col-span-3">
          <label htmlFor={id("observacao")} className={lbl}>Observação operacional</label>
          <input id={id("observacao")} name="observacao" defaultValue={valores.observacao} className={inp} />
        </div>
        <div className="flex flex-col items-start justify-end gap-1">
          <button className="app-action-compact bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {pending ? "Salvando…" : "Salvar contexto"}
          </button>
        </div>
      </fieldset>
      {state.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`mt-2 text-xs ${state.ok ? "text-brand-700 dark:text-brand-300" : "text-danger-strong"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
