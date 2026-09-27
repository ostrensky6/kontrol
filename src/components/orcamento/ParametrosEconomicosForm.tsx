"use client";

import { useActionState } from "react";
import {
  salvarParametrosEconomicos,
  type ParametrosEconomicosState,
} from "@/lib/actions/orcamentos";
import { TOM_ENTRADA } from "@/lib/orcamento/tom-valor";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

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
}: {
  valores: Record<ParametroCampo["chave"], number>;
}) {
  const [state, action, pending] = useActionState<
    ParametrosEconomicosState,
    FormData
  >(salvarParametrosEconomicos, { ok: false });

  // §8.2: o percentual/valor que o usuário define é entrada -> azul (TOM_ENTRADA).
  const inputBase =
    `mt-1 w-full rounded-md border bg-card px-3 py-2 text-sm font-medium tabular-nums focus:outline-none focus:ring-1 focus:ring-brand-500 ${TOM_ENTRADA}`;

  return (
    <form action={action} {...formularioSemPerda(state)} className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        {CAMPOS.map((campo) => {
          const erro = state.errors?.[campo.chave];
          return (
            <div
              key={campo.chave}
              className="rounded-lg border border-border bg-card p-4 shadow-sm"
            >
              <label
                htmlFor={campo.chave}
                className="block text-sm font-semibold text-foreground"
              >
                {campo.label}
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id={campo.chave}
                  name={campo.chave}
                  type="number"
                  suppressHydrationWarning
                  step={campo.step}
                  min={campo.min}
                  max={campo.max}
                  defaultValue={valores[campo.chave]}
                  className={`${inputBase} ${
                    erro
                      ? "border-danger-strong/40 focus:border-danger-strong"
                      : "border-input focus:border-brand-500"
                  }`}
                />
                <span className="min-w-10 rounded-md border border-border bg-muted/50 px-2 py-2 text-center text-xs font-medium text-muted-foreground">
                  {campo.unidade}
                </span>
              </div>
              {erro ? (
                <p className="mt-2 text-xs text-danger-strong">{erro}</p>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {campo.ajuda}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {state.message && (
        <p
          className={`rounded-md px-3 py-2 text-sm ${
            state.ok
              ? "bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-300"
              : "bg-danger-soft text-danger-strong"
          }`}
        >
          {state.message}
        </p>
      )}

      <div className="flex justify-end">
        <button
          disabled={pending}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-500 disabled:opacity-50"
        >
          {pending ? "Salvando..." : "Salvar parâmetros"}
        </button>
      </div>
    </form>
  );
}
