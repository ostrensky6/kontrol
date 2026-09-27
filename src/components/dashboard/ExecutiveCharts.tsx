"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompactCurrency, formatInteger } from "@/lib/formatters";

type GastoRow = {
  mes: string;
  projeto: string;
  gasto: number;
};

type FunnelRow = {
  status: string;
  total: number;
};

// Paleta institucional: azul GIA, teal e verde ATGC, âmbar para perdidos.
const COLORS = ["#01489d", "#008e9c", "#008a00", "#d97706"];

export function ExecutiveCharts({
  gastos,
  funil,
}: {
  /** null esconde o gráfico (sem a permissão de ver o módulo). */
  gastos: GastoRow[] | null;
  funil: FunnelRow[] | null;
}) {
  const [mounted, setMounted] = useState(false);
  const gastosPorMes = Object.values(
    (gastos ?? []).reduce<Record<string, { mes: string; gasto: number }>>((acc, item) => {
      const mes = item.mes.slice(0, 7);
      acc[mes] ??= { mes, gasto: 0 };
      acc[mes].gasto += item.gasto;
      return acc;
    }, {}),
  );
  const temGastos = gastosPorMes.length > 0;
  const temFunil = (funil ?? []).some((item) => item.total > 0);
  const ambos = gastos !== null && funil !== null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (gastos === null && funil === null) return null;

  return (
    <div className={`grid min-w-0 gap-4 ${ambos ? "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)]" : ""}`}>
      {gastos !== null && (
      <section className="min-w-0 rounded-lg border border-border bg-card p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-foreground dark:text-white">Gasto por mês</h3>
        <div className="mt-3 h-64 min-h-64 min-w-0">
          {mounted && temGastos ? (
            <ResponsiveContainer width="100%" height={256}>
              <BarChart data={gastosPorMes}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="mes" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => formatCompactCurrency(Number(value))} width={78} />
                <Tooltip formatter={(value) => formatCompactCurrency(Number(value))} cursor={{ fill: "rgba(148, 163, 184, 0.12)" }} />
                <Bar dataKey="gasto" radius={[4, 4, 0, 0]} fill="#01489d" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-md bg-muted/50 text-xs text-muted-foreground">
              Sem dados de gastos
            </div>
          )}
        </div>
      </section>
      )}

      {funil !== null && (
      <section className="min-w-0 rounded-lg border border-border bg-card p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-foreground dark:text-white">Funil de orçamentos</h3>
        <div className="mt-3 h-64 min-h-64 min-w-0">
          {mounted && temFunil ? (
            <ResponsiveContainer width="100%" height={256}>
              <PieChart>
                <Pie data={funil} dataKey="total" nameKey="status" innerRadius={56} outerRadius={88} paddingAngle={2}>
                  {funil.map((entry, index) => (
                    <Cell key={entry.status} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatInteger(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-md bg-muted/50 text-xs text-muted-foreground">
              Sem dados de funil
            </div>
          )}
        </div>
        <div className="grid gap-2 text-xs">
          {funil.map((f, i) => (
            <div key={f.status} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                {f.status}
              </span>
              <span className="font-semibold tabular-nums">{f.total}</span>
            </div>
          ))}
        </div>
      </section>
      )}
    </div>
  );
}
