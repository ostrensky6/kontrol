"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/common/DataTable";
import { Badge } from "@/components/ui/badge";

export type AuditoriaRow = {
  id: number;
  quando: string;
  usuario: string;
  tabela: string;
  tabelaLabel: string;
  registro: string;
  acao: string;
  acaoLabel: string;
  alteracao: string;
};

const columns: ColumnDef<AuditoriaRow, unknown>[] = [
  { accessorKey: "quando", header: "Quando" },
  { accessorKey: "usuario", header: "Usuário" },
  {
    accessorKey: "tabelaLabel",
    header: "Tabela",
    filterFn: "equalsString",
    cell: ({ row }) => (
      <span>
        {row.original.tabelaLabel} <span className="text-muted-foreground">{row.original.registro}</span>
      </span>
    ),
  },
  {
    accessorKey: "acaoLabel",
    header: "Ação",
    filterFn: "equalsString",
    meta: { align: "center" },
    cell: ({ row }) => <AcaoBadge acao={row.original.acao} label={row.original.acaoLabel} />,
  },
  { accessorKey: "alteracao", header: "Alteração" },
];

function AcaoBadge({ acao, label }: { acao: string; label: string }) {
  const className =
    acao === "insert"
      ? "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300"
      : acao === "update"
        ? "bg-info-soft text-info-strong"
        : acao === "delete"
          ? "bg-danger-soft text-danger-strong"
          : "bg-secondary text-secondary-foreground";
  return <Badge className={className}>{label}</Badge>;
}

export function AuditoriaTable({ rows }: { rows: AuditoriaRow[] }) {
  return (
    <DataTable
      data={rows}
      columns={columns}
      searchPlaceholder="Buscar na auditoria..."
      emptyText="Nenhum evento de auditoria ainda."
      filters={[
        {
          columnId: "tabelaLabel",
          label: "Tabela",
          options: [...new Set(rows.map((row) => row.tabelaLabel))].map((value) => ({ value, label: value })),
        },
        {
          columnId: "acaoLabel",
          label: "Ação",
          options: [...new Set(rows.map((row) => row.acaoLabel))].map((value) => ({ value, label: value })),
        },
      ]}
      getMobileTitle={(row) => `${row.tabelaLabel} ${row.registro}`}
      getMobileDescription={(row) => `${row.quando} · ${row.usuario} · ${row.alteracao}`}
      getMobileMeta={(row) => <AcaoBadge acao={row.acao} label={row.acaoLabel} />}
    />
  );
}
