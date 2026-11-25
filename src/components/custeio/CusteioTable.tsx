"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable, numericSort } from "@/components/common/DataTable";
import { formatCurrency } from "@/lib/formatters";

export type CusteioRow = {
  codigo: string;
  nome?: string;
  lote: number;
  reagentes: number;
  equipamento: number;
  pessoal: number;
  custoAnalitico: number;
  overhead: number;
  custoTotal: number;
  preco: number;
};

const money = (key: keyof CusteioRow, header: string, strong = false): ColumnDef<CusteioRow, unknown> => ({
  accessorKey: key,
  header,
  sortingFn: numericSort,
  meta: { align: "right" },
  cell: ({ row }) => (
    <span className={strong ? "font-semibold text-primary" : undefined}>
      {formatCurrency(Number(row.original[key]))}
    </span>
  ),
});

const columns: ColumnDef<CusteioRow, unknown>[] = [
  {
    id: "analise",
    // a busca acha pelo nome e pelo código
    accessorFn: (row) => `${row.nome ?? ""} ${row.codigo}`.trim(),
    header: "Análise",
    meta: { className: "min-w-44" },
    cell: ({ row }) => (
      <div>
        <Link
          href={`/analises/${encodeURIComponent(row.original.codigo)}`}
          className="font-medium text-brand-700 hover:underline dark:text-brand-300"
        >
          {row.original.nome ?? row.original.codigo}
        </Link>
        {row.original.nome && <p className="font-mono text-xs text-muted-foreground">{row.original.codigo}</p>}
      </div>
    ),
  },
  { accessorKey: "lote", header: "Lote", sortingFn: numericSort, meta: { align: "right" } },
  money("reagentes", "Reagentes"),
  money("equipamento", "Equip."),
  money("pessoal", "Pessoal"),
  money("custoAnalitico", "Custo analítico", true),
  money("overhead", "Overhead"),
  money("custoTotal", "Custo total"),
  money("preco", "Preço", true),
];

export function CusteioTable({ rows }: { rows: CusteioRow[] }) {
  return (
    <DataTable
      data={rows}
      columns={columns}
      searchPlaceholder="Buscar análise..."
      emptyText="Nenhum custo calculado."
      getMobileTitle={(row) => row.nome ?? row.codigo}
      getMobileHref={(row) => `/analises/${encodeURIComponent(row.codigo)}`}
      getMobileDescription={(row) => `${row.nome ? `${row.codigo} · ` : ""}Lote ${row.lote} · custo ${formatCurrency(row.custoTotal)} · preço ${formatCurrency(row.preco)}`}
    />
  );
}
