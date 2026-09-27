"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/common/DataTable";
import { Badge } from "@/components/ui/badge";

export type CompraRow = {
  id: number;
  pedido: string;
  fornecedor: string;
  projeto: string;
  solicitante: string;
  status: string;
  statusLabel: string;
};

const columns: ColumnDef<CompraRow, unknown>[] = [
  {
    accessorKey: "pedido",
    header: "Compra",
    cell: ({ row }) => (
      <Link href={`/compras/${row.original.id}`} className="font-medium text-primary hover:underline">
        {row.original.pedido}
      </Link>
    ),
  },
  { accessorKey: "fornecedor", header: "Fornecedor" },
  { accessorKey: "projeto", header: "Projeto" },
  { accessorKey: "solicitante", header: "Solicitante" },
  {
    accessorKey: "statusLabel",
    header: "Status",
    meta: { align: "center" },
    cell: ({ row }) => <StatusBadge status={row.original.status} label={row.original.statusLabel} />,
    filterFn: "equalsString",
  },
];

function StatusBadge({ status, label }: { status: string; label: string }) {
  const variantClass =
    status === "solicitado"
      ? "bg-warning-soft text-warning-strong"
      : status === "aprovado"
        ? "bg-info-soft text-info-strong"
        : status === "enviado"
          ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300"
          : status === "recebido"
            ? "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300"
            : "bg-secondary text-secondary-foreground";

  return <Badge className={variantClass}>{label}</Badge>;
}

export function ComprasTable({ rows }: { rows: CompraRow[] }) {
  return (
    <DataTable
      data={rows}
      columns={columns}
      searchPlaceholder="Buscar compra, fornecedor ou projeto..."
      emptyText="Nenhuma compra ainda."
      filters={[
        {
          columnId: "statusLabel",
          label: "Status",
          options: [
            { value: "Solicitado", label: "Solicitado" },
            { value: "Aprovado", label: "Aprovado" },
            { value: "Enviado", label: "Enviado" },
            { value: "Recebido", label: "Recebido" },
            { value: "Cancelado", label: "Cancelado" },
          ],
        },
        {
          columnId: "fornecedor",
          label: "Fornecedor",
          options: [...new Set(rows.map((row) => row.fornecedor).filter((value) => value !== "—"))].map((value) => ({
            value,
            label: value,
          })),
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
        <Link href={`/compras/${row.id}`} className="text-primary hover:underline">
          {row.pedido}
        </Link>
      )}
      getMobileDescription={(row) => `${row.fornecedor} · ${row.projeto} · ${row.solicitante}`}
      getMobileMeta={(row) => <StatusBadge status={row.status} label={row.statusLabel} />}
    />
  );
}
