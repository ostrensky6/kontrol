"use client";

import { useActionState, type ReactNode } from "react";
import {
  salvarParametrosEconomicos,
  type ParametrosEconomicosState,
} from "@/lib/actions/orcamentos";
import { TOM_ENTRADA } from "@/lib/orcamento/tom-valor";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";
import { HelpTip } from "@/components/common/HelpTip";

type ParametroCampo = {
  chave:
    | "dias_uteis_ano"
    | "margem_lucro"
    | "impostos"
    | "taxas"
    | "fundo_reserva"
    | "fundo_investimento";
  label: string;
  ajuda: string;
  unidade: string;
  step: string;
  min: string;
  max?: string;
};

const CAMPOS: ParametroCampo[] = [
  {
    chave: "dias_uteis_ano",
    label: "Dias úteis por ano",
    ajuda: "Base anual usada para ratear depreciação e manutenção dos equipamentos.",
    unidade: "dias",
    step: "1",
    min: "1",
  },
  {
    chave: "margem_lucro",
    label: "Margem de lucro",
    ajuda: "Nas propostas, é % do preço final. Na tabela de análises, soma-se ao custo.",
    unidade: "%",
    step: "0.1",
    min: "0",
    max: "100",
  },
  {
    chave: "impostos",
    label: "Impostos",
    ajuda: "Percentual de tributos considerado no preço final.",
    unidade: "%",
    step: "0.1",
    min: "0",
    max: "100",
  },
  {
    chave: "taxas",
    label: "Taxas administrativas",
    ajuda: "Encargos administrativos adicionados ao orçamento.",
    unidade: "%",
    step: "0.1",
    min: "0",
    max: "100",
  },
  {
    chave: "fundo_reserva",
    label: "Fundo de reserva",
    ajuda: "Percentual destinado a cobertura de variações e contingências.",
    unidade: "%",
    step: "0.1",
    min: "0",
    max: "100",
  },
  {
    chave: "fundo_investimento",
    label: "Fundo de investimento",
    ajuda: "Percentual para reinvestimento em estrutura e capacidade.",
    unidade: "%",
    step: "0.1",
    min: "0",
    max: "100",
  },
];

export function ParametrosEconomicosForm({
  valores,
  cabecalho,
}: {
  valores: Record<ParametroCampo["chave"], number>;
  /** Título do bloco; fica na mesma linha do botão Salvar. */
  cabecalho?: ReactNode;
}) {
  const [state, action, pending] = useActionState<
    ParametrosEconomicosState,
    FormData
  >(salvarParametrosEconomicos, { ok: false });

  // §8.2: o percentual/valor que o usuário define é entrada -> azul (TOM_ENTRADA).
  // Campos de 32 px e largura curta (28/09): as seis premissas cabem numa linha.
  const inputBase =
    `h-8 w-full rounded-md border bg-card pl-2.5 pr-11 text-sm font-medium tabular-nums focus:outline-none focus:ring-1 focus:ring-brand-500 ${TOM_ENTRADA}`;

  return (
    // Grade: título e Salvar na primeira linha, os seis campos na segunda. O botão
    // vem depois dos campos no DOM, para a ordem do Tab seguir o preenchimento.
    <form
      action={action}
      {...formularioSemPerda(state)}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1"
    >
      <div className="col-start-1 row-start-1 min-w-0">{cabecalho}</div>
      <div className="col-span-2 row-start-2 grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-3 xl:grid-cols-6">
        {CAMPOS.map((campo) => {
          const erro = state.errors?.[campo.chave];
          return (
            <div key={campo.chave} className="min-w-0">
              <div className="flex h-5 items-center gap-0.5">
                <label
                  htmlFor={campo.chave}
                  className="truncate text-xs font-medium text-muted-foreground"
                  title={campo.label}
                >
                  {campo.label}
                  <span className="sr-only"> ({campo.unidade})</span>
                </label>
                <HelpTip title={campo.label} className="h-6 w-6">
                  <p>{campo.ajuda}</p>
                </HelpTip>
              </div>
              <div className="relative mt-0.5 max-w-40">
                <input
                  id={campo.chave}
                  name={campo.chave}
                  type="number"
                  suppressHydrationWarning
                  step={campo.step}
                  min={campo.min}
                  max={campo.max}
                  defaultValue={valores[campo.chave]}
                  aria-invalid={erro ? true : undefined}
                  aria-describedby={erro ? `${campo.chave}-erro` : undefined}
                  className={`${inputBase} ${
                    erro
                      ? "border-danger-strong/40 focus:border-danger-strong"
                      : "border-input focus:border-brand-500"
                  }`}
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs font-medium text-muted-foreground"
                >
                  {campo.unidade}
                </span>
              </div>
              {erro && (
                <p id={`${campo.chave}-erro`} className="mt-1 text-xs text-danger-strong">
                  {erro}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <button
        disabled={pending}
        className="col-start-2 row-start-1 h-8 rounded-md bg-brand-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-500 disabled:opacity-50"
      >
        {pending ? "Salvando..." : "Salvar parâmetros"}
      </button>

      {state.message && (
        <p
          role="status"
          className={`col-span-2 row-start-3 mt-1 rounded-md px-3 py-1.5 text-sm ${
            state.ok
              ? "bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-300"
              : "bg-danger-soft text-danger-strong"
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
