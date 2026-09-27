"use client";

import { useMemo, useState } from "react";

import { HelpExample, HelpLegend, HelpTip } from "@/components/common/HelpTip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { salvarParametrosEconomicosDaDemanda } from "@/lib/actions/demandas";
import {
  PARAMETROS_PROPOSTA,
  calcularPropostaEconomica,
  parametrosDeRates,
  type RatesProposta,
} from "@/lib/orcamento/engine-economica";
import type { OrigemParametros } from "@/lib/orcamento/parametros-proposta";
import { formatCurrency as brl } from "@/lib/formatters";

type Rates = Required<{ [K in keyof RatesProposta]: number }>;

const ORIGEM: Record<OrigemParametros, { texto: string; cls: string }> = {
  projeto: { texto: "Do orçamento de projeto", cls: "bg-info-soft text-info-strong" },
  proposta: { texto: "Salvos nesta proposta", cls: "bg-success-soft text-success-strong" },
  padrao: { texto: "Padrão de Parâmetros de custeio (ainda não salvo)", cls: "bg-warning-soft text-warning-strong" },
};

/**
 * Percentuais econômicos da proposta (impostos, incubação, reserva,
 * investimentos, lucro), com prévia pela mesma engine da emissão (Política A).
 */
export function EditorParametrosProposta({
  demandaId,
  custoLaboratorio,
  custoProjeto,
  valores,
  origem,
  erro,
  salvo,
  podeEditar,
}: {
  demandaId: number;
  custoLaboratorio: number;
  custoProjeto: number;
  valores: Rates;
  origem: OrigemParametros;
  erro?: string;
  salvo?: boolean;
  /** editar percentuais exige papel gestor (governança do orçamento) */
  podeEditar: boolean;
}) {
  const [rates, setRates] = useState<Rates>(valores);
  const previa = useMemo(
    () =>
      calcularPropostaEconomica({
        custoLaboratorioTecnico: custoLaboratorio,
        custoDiretoProjeto: custoProjeto,
        parametros: parametrosDeRates(rates),
      }),
    [custoLaboratorio, custoProjeto, rates],
  );

  return (
    <form action={salvarParametrosEconomicosDaDemanda} className="mt-4 rounded-md border border-border">
      <input type="hidden" name="demanda_id" value={demandaId} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-2">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-semibold">Impostos, taxas e lucro</h3>
          <HelpTip title="Impostos, taxas e lucro">
            <p>
              Percentuais aplicados sobre o <b>preço final</b> desta proposta. A soma precisa ficar abaixo
              de 100%.
            </p>
            <p>
              A <b>taxa de incubação (UFPR)</b> tem padrão de 2%, sobre o valor dos serviços <b>sem os impostos</b>; o padrão é ajustado em Parâmetros de custeio.
              A mensalidade fixa da incubação é custo fixo e fica em Cadastros → Overhead.
            </p>
            <HelpExample>
              Nota de R$ 10.000 com 16,33% de impostos: 2% de R$ 8.367 = R$ 167,34 de incubação.
            </HelpExample>
            <HelpLegend
              items={[
                { tom: "info", rotulo: "Do projeto", texto: "gravados no orçamento de projeto." },
                { tom: "ok", rotulo: "Nesta proposta", texto: "gravados nesta proposta." },
                { tom: "atencao", rotulo: "Padrão", texto: "vindos de Parâmetros de custeio; ainda não salvos." },
              ]}
            />
          </HelpTip>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ORIGEM[origem].cls}`}>
          {ORIGEM[origem].texto}
        </span>
      </div>

      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
        {PARAMETROS_PROPOSTA.map((p) => (
          <div key={p.chave}>
            <label htmlFor={`param-${p.chave}`} className="text-xs font-medium text-muted-foreground">
              {p.label} (%)
            </label>
            <Input
              id={`param-${p.chave}`}
              name={p.chave}
              type="number"
              inputMode="decimal"
              min={0}
              max={99.99}
              step="0.01"
              value={rates[p.chave]}
              onChange={(e) => {
                const n = Number(e.target.value);
                setRates((atual) => ({ ...atual, [p.chave]: Number.isFinite(n) ? n : 0 }));
              }}
              disabled={!podeEditar}
              className="mt-1 text-right tabular-nums"
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2 text-sm">
        <p className="tabular-nums">
          Soma <b>{previa.somaPercentual.toLocaleString("pt-BR")}%</b> · custo {brl(previa.subtotal)} → preço{" "}
          <b>{previa.valido ? brl(previa.totalFinal) : "—"}</b>
        </p>
        {podeEditar ? (
          <Button type="submit" disabled={!previa.valido}>
            Salvar parâmetros
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Somente consulta: alterar exige perfil Gestor.</span>
        )}
      </div>
      {!previa.valido && (
        <p className="border-t border-border bg-danger-soft px-3 py-2 text-xs text-danger-strong">
          A soma dos percentuais precisa ficar abaixo de 100%.
        </p>
      )}
      {erro && (
        <p role="alert" className="border-t border-border bg-danger-soft px-3 py-2 text-xs text-danger-strong">
          {erro}
        </p>
      )}
      {salvo && !erro && (
        <p role="status" className="border-t border-border bg-success-soft px-3 py-2 text-xs text-success-strong">
          Parâmetros salvos.
        </p>
      )}
    </form>
  );
}
