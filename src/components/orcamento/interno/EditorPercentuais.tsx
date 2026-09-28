"use client";

import { useMemo, useState } from "react";

import { SubmitButton } from "@/components/common/SubmitButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency as brl } from "@/lib/formatters";
import { PARAMETROS_PROPOSTA, calcularPropostaEconomica, parametrosDeRates } from "@/lib/orcamento/engine-economica";

export type ValoresPercentuais = Record<(typeof PARAMETROS_PROPOSTA)[number]["chave"], number>;

export type EdicaoPercentuais = {
  valores: ValoresPercentuais;
  custoLaboratorio: number;
  custoProjeto: number;
  action: (formData: FormData) => void | Promise<void>;
  /** campos ocultos do formulário (ids, operação, retorno) */
  campos: Record<string, string | number>;
  rotuloSalvar: string;
  /** o que acontece ao salvar (ex.: "gera a versão v2") */
  aviso?: string;
};

const ROTULOS: Record<string, string> = {
  impostos_legacy: "Impostos",
  incubacao: "Incubação UFPR",
  reserva: "Fundo de reserva",
  investimentos: "Fundo de investimento",
  lucro: "Lucro",
};

/** Percentuais com prévia do novo total pela mesma engine da emissão. */
export function EditorPercentuais({
  edicao,
  totalAtual,
  onCancelar,
}: {
  edicao: EdicaoPercentuais;
  totalAtual: number;
  onCancelar: () => void;
}) {
  const [valores, setValores] = useState<ValoresPercentuais>(edicao.valores);
  const previa = useMemo(
    () =>
      calcularPropostaEconomica({
        custoLaboratorioTecnico: edicao.custoLaboratorio,
        custoDiretoProjeto: edicao.custoProjeto,
        parametros: parametrosDeRates(valores),
      }),
    [edicao.custoLaboratorio, edicao.custoProjeto, valores],
  );
  const mudou = PARAMETROS_PROPOSTA.some((p) => valores[p.chave] !== edicao.valores[p.chave]);

  return (
    <form action={edicao.action} className="rounded-md border border-brand-200 bg-brand-50/50 p-3 dark:border-brand-900 dark:bg-brand-950/20">
      {Object.entries(edicao.campos).map(([nome, valor]) => (
        <input key={nome} type="hidden" name={nome} value={valor} />
      ))}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {PARAMETROS_PROPOSTA.map((p) => (
          <div key={p.chave}>
            <label htmlFor={`pct-${p.chave}`} className="text-xs font-medium text-muted-foreground">
              {ROTULOS[p.chave] ?? p.label} (%)
            </label>
            <Input
              id={`pct-${p.chave}`}
              name={p.chave}
              type="number"
              inputMode="decimal"
              min={0}
              max={99.99}
              step="0.01"
              value={valores[p.chave]}
              onChange={(e) => {
                const n = Number(e.target.value);
                setValores((atual) => ({ ...atual, [p.chave]: Number.isFinite(n) ? n : 0 }));
              }}
              className="mt-1 h-8 text-right tabular-nums"
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="tabular-nums">
          Σ {previa.somaPercentual.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% · novo total{" "}
          <b>{previa.valido ? brl(previa.totalFinal) : "—"}</b>
          <span className="text-muted-foreground"> (era {brl(totalAtual)})</span>
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancelar}>
            Cancelar
          </Button>
          <SubmitButton size="sm" disabled={!previa.valido || !mudou}>
            {edicao.rotuloSalvar}
          </SubmitButton>
        </div>
      </div>
      {!previa.valido && (
        <p role="alert" className="mt-2 text-xs text-danger-strong">A soma dos percentuais precisa ficar abaixo de 100%.</p>
      )}
      {edicao.aviso && <p className="mt-1 text-xs text-muted-foreground">{edicao.aviso}</p>}
    </form>
  );
}
