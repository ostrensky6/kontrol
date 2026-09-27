"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/common/DataTable";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/app/StatusBadge";

export type DemandaRow = {
  id: number;
  titulo: string;
  cliente: string;
  modalidade: string;
  modalidadeLabel: string;
  projeto: string;
  prazo: string;
  prioridade: string;
  dataSolicitacao: string;
  status: string;
  statusLabel: string;
  completudeLabel: string;
  completa: boolean;
};

const columns: ColumnDef<DemandaRow, unknown>[] = [
  {
    accessorKey: "titulo",
    header: "Orçamento",
    cell: ({ row }) => (
      <div>
        <Link href={`/orcamento/demandas/${row.original.id}`} className="font-medium text-primary hover:underline">
          {row.original.titulo}
        </Link>
        <span className="block text-xs text-muted-foreground">
          Solicitada em {row.original.dataSolicitacao} · prioridade {row.original.prioridade}
        </span>
      </div>
    ),
  },
  { accessorKey: "cliente", header: "Cliente" },
  { accessorKey: "modalidadeLabel", header: "Modalidade", filterFn: "equalsString" },
  { accessorKey: "projeto", header: "Projeto", filterFn: "equalsString" },
  { accessorKey: "prazo", header: "Prazo" },
  {
    accessorKey: "completudeLabel",
    header: "Completude",
    filterFn: "equalsString",
    meta: { align: "center" },
    cell: ({ row }) => (
      <Badge
        className={
          row.original.completa
            ? "bg-success-soft text-success-strong"
            : "bg-warning-soft text-warning-strong"
        }
      >
        {row.original.completudeLabel}
      </Badge>
    ),
  },
  {
    accessorKey: "statusLabel",
    header: "Status",
    filterFn: "equalsString",
    meta: { align: "center" },
    cell: ({ row }) => <StatusBadge status={row.original.status} label={row.original.statusLabel} />,
  },
];

export function DemandasTable({ rows }: { rows: DemandaRow[] }) {
  return (
    <DataTable
      data={rows}
      columns={columns}
      searchPlaceholder="Buscar orçamento, cliente ou projeto…"
      emptyText="Nenhum orçamento ainda."
      filters={[
        {
          columnId: "statusLabel",
          label: "Status",
          options: [...new Set(rows.map((row) => row.statusLabel))].map((value) => ({ value, label: value })),
        },
        {
          columnId: "modalidadeLabel",
          label: "Modalidade",
          options: [...new Set(rows.map((row) => row.modalidadeLabel))].map((value) => ({ value, label: value })),
        },
        {
          columnId: "completudeLabel",
          label: "Completude",
          options: [...new Set(rows.map((row) => row.completudeLabel))].map((value) => ({ value, label: value })),
        },
        {
          columnId: "projeto",
          label: "Projeto",
          options: [...new Set(rows.map((row) => row.projeto).filter((value) => value !== "—"))].map((value) => ({
            value,
            label: value,
          })),
        },
      ]}
      getMobileTitle={(row) => (
        <Link href={`/orcamento/demandas/${row.id}`} className="text-primary hover:underline">
          {row.titulo}
        </Link>
      )}
      getMobileDescription={(row) => `${row.cliente} · ${row.modalidadeLabel} · ${row.projeto}`}
      getMobileMeta={(row) => (
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={row.status} label={row.statusLabel} />
          <Badge
            className={
              row.completa
                ? "bg-success-soft text-success-strong"
                : "bg-warning-soft text-warning-strong"
            }
          >
            {row.completudeLabel}
          </Badge>
        </div>
      )}
    />
  );
}
