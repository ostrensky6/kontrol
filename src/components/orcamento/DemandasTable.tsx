"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/common/DataTable";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/app/StatusBadge";
import { formatCurrency as brl } from "@/lib/formatters";
import { FASES, type FaseOrcamento } from "@/lib/orcamento/fase-orcamento";

/** Tom do selo de cada fase (dicionário de status do app). */
const TOM_FASE: Record<FaseOrcamento, string> = {
  em_elaboracao: "em_elaboracao",
  revisao: "em_revisao",
  emitida: "emitido",
  aprovada: "aprovada",
  recusada: "recusada",
  cancelada: "cancelada",
};

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
  fase: FaseOrcamento;
  faseLabel: string;
  /** Valor da proposta que vale; sem ela, a soma dos módulos (estimativa). */
  valor: number | null;
  valorEstimado: boolean;
  completudeLabel: string;
  completa: boolean;
};

function Valor({ row }: { row: DemandaRow }) {
  if (row.valor == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="font-semibold tabular-nums">{brl(row.valor)}</span>
      {row.valorEstimado && <span className="block text-[11px] text-muted-foreground">estimativa</span>}
    </span>
  );
}

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
    accessorKey: "valor",
    header: "Valor",
    meta: { align: "right" },
    cell: ({ row }) => <Valor row={row.original} />,
  },
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
    accessorKey: "faseLabel",
    header: "Fase",
    filterFn: "equalsString",
    meta: { align: "center" },
    cell: ({ row }) => (
      <StatusBadge status={TOM_FASE[row.original.fase]} label={row.original.faseLabel} className="whitespace-nowrap" />
    ),
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
          columnId: "faseLabel",
          label: "Fase",
          options: FASES.filter((f) => rows.some((row) => row.fase === f.id)).map((f) => ({ value: f.item, label: f.item })),
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
      getMobileDescription={(row) =>
        [row.cliente, row.modalidadeLabel, row.projeto !== "—" ? row.projeto : null].filter(Boolean).join(" · ")
      }
      getMobileMeta={(row) => (
        <StatusBadge status={TOM_FASE[row.fase]} label={row.faseLabel} className="whitespace-nowrap" />
      )}
      getMobileActions={(row) => (
        <>
          <span className="text-sm">
            {row.valor != null ? (
              <>
                <span className="font-semibold tabular-nums">{brl(row.valor)}</span>
                {row.valorEstimado && <span className="ml-1 text-xs text-muted-foreground">estimativa</span>}
              </>
            ) : (
              <span className="text-muted-foreground">Sem valor ainda</span>
            )}
          </span>
          <Badge
            className={
              row.completa
                ? "ml-auto bg-success-soft text-success-strong"
                : "ml-auto bg-warning-soft text-warning-strong"
            }
          >
            {row.completudeLabel}
          </Badge>
        </>
      )}
    />
  );
}
