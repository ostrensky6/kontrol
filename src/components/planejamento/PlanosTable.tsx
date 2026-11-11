"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/common/DataTable";
import { Badge } from "@/components/ui/badge";
import { PlanoLinhaAcoes, type AcaoGestaoPlano } from "./PlanoGestao";

export type PlanoRow = {
  id: number;
  nome: string;
  projeto: string;
  dataAlvo: string;
  periodo: string;
  prioridade: string;
  responsavel: string;
  itens: number;
  status: string;
  statusLabel: string;
  editavel: boolean;
  gestao: AcaoGestaoPlano;
};

function Acoes({ row, mobile = false }: { row: PlanoRow; mobile?: boolean }) {
  return (
    <PlanoLinhaAcoes
      planId={row.id}
      nome={row.nome}
      editavel={row.editavel}
      gestao={row.gestao}
      alinhamento={mobile ? "justify-start" : "justify-end"}
    />
  );
}

const columns: ColumnDef<PlanoRow, unknown>[] = [
  {
    accessorKey: "nome",
    header: "Plano",
    cell: ({ row }) => (
      <Link href={`/planejamento/${row.original.id}`} className="font-medium text-primary hover:underline">
        {row.original.nome}
      </Link>
    ),
  },
  { accessorKey: "projeto", header: "Projeto" },
  { accessorKey: "periodo", header: "Período previsto" },
  { accessorKey: "responsavel", header: "Responsável" },
  {
    accessorKey: "prioridade",
    header: "Prioridade",
    cell: ({ row }) => <PrioridadeBadge prioridade={row.original.prioridade} />,
    filterFn: "equalsString",
  },
  {
    accessorKey: "itens",
    header: "Análises",
    meta: { align: "right" },
  },
  {
    accessorKey: "statusLabel",
    header: "Situação",
    meta: { align: "center" },
    cell: ({ row }) => <StatusBadge status={row.original.status} label={row.original.statusLabel} />,
    filterFn: "equalsString",
  },
  {
    id: "acoes",
    header: "Ações",
    meta: { align: "right" },
    enableSorting: false,
    cell: ({ row }) => <Acoes row={row.original} />,
  },
];

function StatusBadge({ status, label }: { status: string; label: string }) {
  const variantClass =
    status === "iniciado"
      ? "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300"
      : status === "concluido"
        ? "bg-leaf-100 text-leaf-800 dark:bg-leaf-950/50 dark:text-leaf-300"
      : status === "reservado"
        ? "bg-info-soft text-info-strong"
        : status === "liberado"
          ? "bg-secondary text-secondary-foreground"
          : "bg-warning-soft text-warning-strong";

  return <Badge className={variantClass}>{label}</Badge>;
}

function PrioridadeBadge({ prioridade }: { prioridade: string }) {
  const label = {
    baixa: "Baixa",
    normal: "Normal",
    alta: "Alta",
    urgente: "Urgente",
  }[prioridade] ?? prioridade;
  const cls =
    prioridade === "urgente"
      ? "bg-danger-soft text-danger-strong"
      : prioridade === "alta"
        ? "bg-warning-soft text-warning-strong"
        : prioridade === "baixa"
          ? "bg-secondary text-secondary-foreground"
          : "bg-info-soft text-info-strong";

  return <Badge className={cls}>{label}</Badge>;
}

export function PlanosTable({ rows }: { rows: PlanoRow[] }) {
  return (
    <DataTable
      data={rows}
      columns={columns}
      searchPlaceholder="Buscar plano, projeto ou status..."
      emptyText="Nenhum plano ainda. Crie o primeiro em Novo plano."
      filters={[
        {
          columnId: "statusLabel",
          label: "Situação",
          options: [
            { value: "Rascunho", label: "Rascunho" },
            { value: "Reservado", label: "Reservado" },
            { value: "Iniciado", label: "Iniciado" },
            { value: "Em execução", label: "Em execução" },
            { value: "Concluído", label: "Concluído" },
            { value: "Liberado", label: "Liberado" },
            { value: "Cancelado", label: "Cancelado" },
          ],
        },
        {
          columnId: "prioridade",
          label: "Prioridade",
          options: [
            { value: "urgente", label: "Urgente" },
            { value: "alta", label: "Alta" },
            { value: "normal", label: "Normal" },
            { value: "baixa", label: "Baixa" },
          ],
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
        <Link href={`/planejamento/${row.id}`} className="text-primary hover:underline">
          {row.nome}
        </Link>
      )}
      getMobileDescription={(row) => (
        <>
          {`${row.projeto} · ${row.periodo} · ${row.itens} análise(s)`}
          <div className="mt-2">
            <Acoes row={row} mobile />
          </div>
        </>
      )}
      getMobileMeta={(row) => <StatusBadge status={row.status} label={row.statusLabel} />}
    />
  );
}
