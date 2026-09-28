"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { calcularAnalise, calcularAnaliseOrcamento, type Parametros } from "@/lib/costing/engine";
import type { SimuladorAnalise } from "@/lib/costing/loader";
import { formatCompactCurrency, formatCurrency, formatNumber } from "@/lib/formatters";
import { TOM_ENTRADA } from "@/lib/orcamento/tom-valor";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";

const COLORS = ["#01489d", "#008e9c", "#008a00", "#d97706", "#7c3aed", "#dc2626"];
const DEFAULT_MAX_AMOSTRAS = 192;
const DEFAULT_VISIBLE_SERIES = 4;

type Metric = "total" | "unitario";
type ChartRow = { amostras: number } & Record<string, number>;

export function CusteioAmostrasChart({
  analises,
  params,
  valorHoraPessoal,
  custoHoraOverhead,
}: {
  analises: SimuladorAnalise[];
  params: Parametros;
  valorHoraPessoal: number;
  custoHoraOverhead: number;
}) {
  const [mounted, setMounted] = useState(false);
  const [metric, setMetric] = useState<Metric>("unitario");
  const [maxAmostras, setMaxAmostras] = useState(DEFAULT_MAX_AMOSTRAS);
  const [selecionadas, setSelecionadas] = useState<string[]>(() =>
    analises.slice(0, DEFAULT_VISIBLE_SERIES).map((analise) => analise.codigo),
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const analisesSelecionadas = useMemo(
    () => analises.filter((analise) => selecionadas.includes(analise.codigo)),
    [analises, selecionadas],
  );

  const data = useMemo<ChartRow[]>(() => {
    const limite = Math.max(1, Math.min(1000, maxAmostras));
    return Array.from({ length: limite }, (_, index) => {
      const numeroAmostras = index + 1;
      const row: ChartRow = { amostras: numeroAmostras };

      for (const analise of analisesSelecionadas) {
        const resultado = calcularAnaliseOrcamento({
          codigo: analise.codigo,
          etapas: analise.etapas,
          equip: analise.equip,
          insumos: analise.insumos,
          valorHoraPessoal,
          custoHoraOverhead,
          params,
          numeroAmostras,
        });
        row[analise.codigo] = metric === "total" ? resultado.totais.custoTotal : resultado.custoTotal;
      }

      return row;
    });
  }, [analisesSelecionadas, custoHoraOverhead, maxAmostras, metric, params, valorHoraPessoal]);

  const resumo = useMemo(
    () =>
      analisesSelecionadas.map((analise) => {
        const base = calcularAnalise({
          codigo: analise.codigo,
          etapas: analise.etapas,
          equip: analise.equip,
          insumos: analise.insumos,
          valorHoraPessoal,
          custoHoraOverhead,
          params,
        });
        const ultimo = calcularAnaliseOrcamento({
          codigo: analise.codigo,
          etapas: analise.etapas,
          equip: analise.equip,
          insumos: analise.insumos,
          valorHoraPessoal,
          custoHoraOverhead,
          params,
          numeroAmostras: maxAmostras,
        });

        return {
          codigo: analise.codigo,
          lote: base.lote,
          custoTotalMaximo: ultimo.totais.custoTotal,
          custoUnitarioMaximo: ultimo.custoTotal,
        };
      }),
    [analisesSelecionadas, custoHoraOverhead, maxAmostras, params, valorHoraPessoal],
  );

  const toggleAnalise = (codigo: string) => {
    setSelecionadas((atuais) =>
      atuais.includes(codigo) ? atuais.filter((item) => item !== codigo) : [...atuais, codigo],
    );
  };

  return (
    <section className="mt-8 rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1">
            <h2 className="text-lg font-semibold text-foreground dark:text-white">Custo por número de amostras</h2>
            <HelpTip title="Custo por número de amostras">
              <p>
                Compare análises lado a lado: cada linha é uma análise. Os <b>degraus</b> aparecem quando as amostras passam do
                lote e é preciso abrir mais uma corrida.
              </p>
              <p>
                A curva usa só o custo técnico, <b>sem margem nem impostos</b>. Em &quot;Custo por
                amostra&quot;, o valor cai conforme mais amostras dividem a mesma corrida.
              </p>
              {analisesSelecionadas.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {analisesSelecionadas.map((analise, index) => (
                    <li key={analise.codigo} className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-[3px] w-4 shrink-0 rounded-full"
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <span className="text-foreground">{analise.codigo}</span>
                    </li>
                  ))}
                </ul>
              )}
              <HelpExample>
                Lote de 12: da 12ª para a 13ª amostra, o custo total sobe um degrau (nova corrida).
              </HelpExample>
            </HelpTip>
          </div>
        </div>
        <label className="block min-w-44">
          <span className="text-xs font-medium text-muted-foreground">Métrica</span>
          <select
            value={metric}
            suppressHydrationWarning
            onChange={(event) => setMetric(event.target.value as Metric)}
            className={`mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm font-medium ${TOM_ENTRADA}`}
          >
            <option value="total">Custo total</option>
            <option value="unitario">Custo por amostra</option>
          </select>
        </label>
      </div>

      <div className="mt-5 grid gap-5">
        <div className="min-w-0">
          <label className="block">
            <span className="flex justify-between text-xs font-medium text-muted-foreground">
              <span>Número máximo de amostras</span>
              <span>{formatNumber(maxAmostras)} amostras</span>
            </span>
            <input
              type="range"
              suppressHydrationWarning
              min={12}
              max={384}
              step={12}
              value={maxAmostras}
              onChange={(event) => setMaxAmostras(Number(event.target.value))}
              className="mt-3 w-full accent-brand-600"
            />
          </label>

          <div className="mt-4 h-[520px] min-h-[520px] min-w-0 rounded-md border border-border/60 bg-background/40 p-3">
            {mounted && analisesSelecionadas.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 16, right: 28, left: 8, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.28)" />
                  <XAxis
                    dataKey="amostras"
                    fontSize={12}
                    tickLine={{ stroke: "var(--muted-foreground)" }}
                    axisLine={{ stroke: "var(--foreground)", strokeWidth: 1.25 }}
                    label={{ value: "Amostras", position: "insideBottom", offset: -12, fontSize: 12 }}
                  />
                  <YAxis
                    fontSize={12}
                    tickLine={{ stroke: "var(--muted-foreground)" }}
                    axisLine={{ stroke: "var(--foreground)", strokeWidth: 1.25 }}
                    tickFormatter={(value) => formatCompactCurrency(Number(value))}
                    width={82}
                    label={{
                      value: metric === "unitario" ? "Custo por amostra" : "Custo total",
                      angle: -90,
                      position: "insideLeft",
                      offset: 4,
                      style: { textAnchor: "middle", fontSize: 12, fill: "var(--muted-foreground)" },
                    }}
                  />
                  <Tooltip
                    formatter={(value, name) => [formatCurrency(Number(value)), name]}
                    labelFormatter={(value) => `${value} amostra(s)`}
                    cursor={{ stroke: "rgba(15, 23, 42, 0.2)", strokeWidth: 1 }}
                  />
                  {analisesSelecionadas.map((analise, index) => (
                    <Line
                      key={analise.codigo}
                      type="stepAfter"
                      dataKey={analise.codigo}
                      stroke={COLORS[index % COLORS.length]}
                      strokeWidth={2.75}
                      dot={false}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center rounded-md bg-muted/50 text-xs text-muted-foreground">
                Selecione ao menos uma análise
              </div>
            )}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {resumo.map((item, index) => (
              <div key={item.codigo} className="rounded-md border border-border/70 bg-muted/40 p-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                  <span className="min-w-0 truncate text-xs font-medium">{item.codigo}</span>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">Lote {formatNumber(item.lote)} amostras</p>
                <p className="mt-1 text-sm font-semibold tabular-nums">
                  {metric === "total" ? formatCurrency(item.custoTotalMaximo) : formatCurrency(item.custoUnitarioMaximo)}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          <div className="rounded-md border border-border/70 bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Análises</p>
              <button
                type="button"
                onClick={() => setSelecionadas([])}
                className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
              >
                Limpar
              </button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {analises.map((analise) => (
                <label key={analise.codigo} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-card">
                  <input
                    type="checkbox"
                    checked={selecionadas.includes(analise.codigo)}
                    onChange={() => toggleAnalise(analise.codigo)}
                    className="h-4 w-4 accent-brand-600"
                  />
                  <span className="min-w-0 truncate text-sm">{analise.codigo}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
