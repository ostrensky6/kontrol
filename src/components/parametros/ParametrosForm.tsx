"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { salvarParametros } from "@/lib/actions/parametros";
import type { FormState } from "@/lib/actions/cadastros";
import { ehParametroVersionado, rotuloParametro } from "@/lib/cadastros/parametros";
import { HelpExample, HelpFormula, HelpTip } from "@/components/common/HelpTip";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import { formatCurrency as brl, APP_LOCALE } from "@/lib/formatters";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

export type Param = {
  chave: string;
  valor: number;
  unidade: string | null;
  descricao: string | null;
};

const FATORES = [
  "margem_lucro",
  "impostos",
  "taxas",
  "fundo_reserva",
  "fundo_investimento",
] as const;

const ORDEM = [
  ...FATORES,
  "taxa_incubacao",
  "dias_uteis_ano",
  "horas_mes_tecnico",
  "horas_bancada_mes",
  "janela_vencimento_dias",
];

const num = (v: number, casas = 2) =>
  v.toLocaleString(APP_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: casas,
  });

const inp =
  "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm font-medium tabular-nums text-brand-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:cursor-not-allowed disabled:bg-muted disabled:text-foreground dark:text-brand-300"; // §8.2: entrada em azul
const lbl = "block text-xs font-medium text-muted-foreground";
const sec = "text-sm font-semibold uppercase tracking-wide text-muted-foreground";
const LINK_VERSIONADOS = "/orcamento/parametros";

function ordenar(a: Param, b: Param) {
  const ia = ORDEM.indexOf(a.chave);
  const ib = ORDEM.indexOf(b.chave);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.chave.localeCompare(b.chave);
}

/**
 * Parâmetros de custeio. Fatores de preço e dias úteis aparecem só para
 * consulta: são versionados e se alteram em Orçamento → Parâmetros econômicos
 * (CAD-4). Os demais são editáveis por quem tem a permissão.
 */
export function ParametrosForm({ params, podeEditar = true }: { params: Param[]; podeEditar?: boolean }) {
  const router = useRouter();
  const [state, action] = useActionState<FormState, FormData>(
    salvarParametros,
    { ok: false },
  );
  const [valores, setValores] = useState<Record<string, string>>(
    Object.fromEntries(params.map((p) => [p.chave, String(p.valor)])),
  );

  const fatores = useMemo(
    () => params.filter((p) => FATORES.includes(p.chave as (typeof FATORES)[number])).sort(ordenar),
    [params],
  );
  const operacionais = useMemo(
    () => params.filter((p) => !FATORES.includes(p.chave as (typeof FATORES)[number])).sort(ordenar),
    [params],
  );
  const editaveis = params.filter((p) => !ehParametroVersionado(p.chave)).map((p) => p.chave);

  const somaFatores = fatores.reduce((acc, p) => acc + (Number.isFinite(p.valor) ? p.valor : 0), 0);
  const multiplicador = 1 + somaFatores / 100;

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  function set(chave: string, value: string) {
    setValores((prev) => ({ ...prev, [chave]: value }));
  }

  function campo(p: Param) {
    const step = p.unidade === "%" ? "0.1" : "1";
    const versionado = ehParametroVersionado(p.chave);
    const descricaoId = `valor_${p.chave}-desc`;
    const erroId = `valor_${p.chave}-erro`;
    const descritoPor =
      [p.descricao || versionado ? descricaoId : null, state.errors?.[p.chave] ? erroId : null]
        .filter(Boolean)
        .join(" ") || undefined;

    return (
      <div key={p.chave}>
        <label htmlFor={`valor_${p.chave}`} className={lbl}>
          {rotuloParametro(p.chave)}
          {p.unidade ? <span className="ml-1 text-muted-foreground/80">({p.unidade})</span> : null}
        </label>
        <input
          id={`valor_${p.chave}`}
          // versionado: sem `name`, nunca é enviado por esta tela
          name={versionado ? undefined : `valor_${p.chave}`}
          type="number"
          suppressHydrationWarning
          inputMode="decimal"
          min="0"
          step={step}
          value={valores[p.chave] ?? ""}
          onChange={(e) => set(p.chave, e.target.value)}
          disabled={versionado || !podeEditar}
          aria-invalid={state.errors?.[p.chave] ? true : undefined}
          aria-describedby={descritoPor}
          className={inp}
        />
        {(p.descricao || versionado) && (
          <p id={descricaoId} className="mt-1 text-[11px] text-muted-foreground/80">
            {versionado ? "Com versão: altere em Orçamento → Parâmetros econômicos." : p.descricao}
          </p>
        )}
        {state.errors?.[p.chave] && (
          <p id={erroId} className="mt-1 text-xs text-danger-strong">{state.errors[p.chave]}</p>
        )}
      </div>
    );
  }

  return (
    <form action={action} {...formularioSemPerda(state)} className="space-y-6">
      <input suppressHydrationWarning type="hidden" name="chaves" value={editaveis.join(",")} />

      <section>
        <div className="flex flex-wrap items-center gap-1">
          <h2 className={sec}>Fatores de preço</h2>
          <HelpTip title="Fatores de preço">
            <p>
              Percentuais somados sobre o <b>custo total</b> para formar o preço de tabela das
              análises. Nas propostas, os percentuais incidem sobre o preço final (gross-up).
            </p>
            <HelpFormula>preço = custo × (1 + soma dos fatores)</HelpFormula>
            <HelpExample>Custo de R$ 100 e fatores somando 40% → preço de R$ 140.</HelpExample>
          </HelpTip>
          <Link href={LINK_VERSIONADOS} className="ml-auto text-sm font-medium text-primary hover:underline">
            Alterar em Parâmetros econômicos
          </Link>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Só consulta aqui: a outra tela guarda a versão anterior a cada mudança.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {fatores.map((p) => campo(p))}
        </div>

        <div
          className={`mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border px-4 py-3 text-sm ${
            somaFatores === 0
              ? "border-warning-strong/30 bg-warning-soft text-warning-strong"
              : "border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-900/40 dark:bg-brand-950/20 dark:text-brand-300"
          }`}
        >
          <span>
            Soma dos fatores: <b className="tabular-nums">{num(somaFatores)}%</b>
          </span>
          <span>
            Multiplicador de preço: <b className="tabular-nums">x{num(multiplicador, 3)}</b>
          </span>
          <span>
            Exemplo R$ 100: <b className="tabular-nums">{brl(100 * multiplicador)}</b>
          </span>
          {somaFatores === 0 && (
            <span className="text-xs">Com 0%, o preço é igual ao custo total.</span>
          )}
        </div>
      </section>

      {operacionais.length > 0 && (
        <section>
          <h2 className={sec}>Parâmetros operacionais</h2>
          <p className="mt-1 text-xs text-muted-foreground/80">
            Bases de rateio e constantes usadas por custeio, estoque e alertas.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {operacionais.map((p) => campo(p))}
          </div>
        </section>
      )}

      <MensagemAcao
        estado={state}
        className={`rounded-md px-3 py-2 empty:p-0 ${
          state.ok
            ? "bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
            : "bg-danger-soft text-danger-strong"
        }`}
      />

      {podeEditar ? (
        <div>
          <SubmitButton>Salvar parâmetros</SubmitButton>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Somente consulta: alterar exige a permissão “Editar parâmetros econômicos”.
        </p>
      )}
    </form>
  );
}
