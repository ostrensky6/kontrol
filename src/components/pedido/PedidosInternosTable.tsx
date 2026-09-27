"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/common/DataTable";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { HelpTip } from "@/components/common/HelpTip";
import { excluirPedidoInterno } from "@/lib/actions/pedidos-internos";
import { FormComMensagem } from "./FormComMensagem";
import { StatusBadge } from "@/components/app/StatusBadge";
import { PedidoItensQuickView, type PedidoItemView } from "./PedidoItensQuickView";

export type PedidoInternoRow = {
  id: number;
  numero: string;
  titulo: string;
  tipoDemanda: string;
  projeto: string;
  coordenador: string;
  solicitante: string;
  necessidade: string;
  urgencia: string;
  itens: number;
  itensDetalhe: PedidoItemView[];
  total: string;
  status: string;
  statusLabel: string;
  proximaAcao: string;
  responsavelAtual: string;
  documentos: string;
  modalidade: string;
  compraFormal: string;
  recebimento: string;
  pendencias: string;
};

function ExcluirPedido({ row }: { row: PedidoInternoRow }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          aria-label={`Excluir ${row.numero}`}
          className="inline-flex items-center gap-1 rounded-md border border-danger-strong/30 px-2 py-1 text-xs font-medium text-danger-strong hover:bg-danger-soft"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Excluir
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-1">
            <DialogTitle>Excluir rascunho {row.numero}?</DialogTitle>
            <HelpTip title="Excluir ou cancelar?">
              <p>
                Excluir só vale para <b>rascunhos</b> que ainda não entraram no fluxo. Pedidos em
                andamento devem ser <b>cancelados</b>, com motivo, para manter o histórico.
              </p>
            </HelpTip>
          </div>
          <DialogDescription>O rascunho será apagado e não poderá ser recuperado.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <button
              type="button"
              className="rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Cancelar
            </button>
          </DialogClose>
          <FormComMensagem action={excluirPedidoInterno} className="flex flex-col items-end gap-1">
            <input type="hidden" name="pedido_interno_id" value={row.id} />
            <button
              type="submit"
              className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90"
            >
              Excluir rascunho
            </button>
          </FormComMensagem>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildColumns(podeExcluir: boolean): ColumnDef<PedidoInternoRow, unknown>[] {
  const cols: ColumnDef<PedidoInternoRow, unknown>[] = [
    {
      accessorKey: "numero",
      header: "Nº",
      cell: ({ row }) => (
        <Link href={`/pedido/${row.original.id}`} className="font-mono text-xs text-muted-foreground hover:underline">
          {row.original.numero}
        </Link>
      ),
    },
    {
      accessorKey: "titulo",
      header: "Pedido",
      cell: ({ row }) => (
        <Link href={`/pedido/${row.original.id}`} className="font-medium text-primary hover:underline">
          {row.original.titulo}
        </Link>
      ),
    },
    { accessorKey: "projeto", header: "Projeto" },
    { accessorKey: "coordenador", header: "Coordenador" },
    { accessorKey: "solicitante", header: "Solicitante" },
    { accessorKey: "necessidade", header: "Necessidade" },
    { accessorKey: "urgencia", header: "Urgência" },
    {
      accessorKey: "itens",
      header: "Itens",
      meta: { align: "center" },
      cell: ({ row }) => (
        <PedidoItensQuickView
          numero={row.original.numero}
          titulo={row.original.titulo}
          itens={row.original.itensDetalhe}
        />
      ),
    },
    { accessorKey: "total", header: "Prévio", meta: { align: "right" } },
    { accessorKey: "documentos", header: "Docs", meta: { align: "center" } },
    { accessorKey: "modalidade", header: "Modalidade" },
    { accessorKey: "compraFormal", header: "Compra" },
    { accessorKey: "recebimento", header: "Recebimento" },
    {
      accessorKey: "statusLabel",
      header: "Status",
      meta: { align: "center" },
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
      filterFn: "equalsString",
    },
    { accessorKey: "proximaAcao", header: "Próxima ação" },
    { accessorKey: "responsavelAtual", header: "Responsável" },
    { accessorKey: "pendencias", header: "Pendências" },
  ];
  if (podeExcluir) {
    cols.push({
      id: "acoes",
      header: "Ações",
      meta: { align: "right" },
      enableSorting: false,
      cell: ({ row }) => (row.original.status === "rascunho" ? <ExcluirPedido row={row.original} /> : null),
    });
  }
  return cols;
}

export function PedidosInternosTable({
  rows,
  emptyText = "Nenhum pedido interno ainda.",
  podeExcluir = false,
}: {
  rows: PedidoInternoRow[];
  emptyText?: string;
  podeExcluir?: boolean;
}) {
  return (
    <DataTable
      data={rows}
      columns={buildColumns(podeExcluir)}
      searchPlaceholder="Buscar pedido, projeto, solicitante ou status..."
      emptyText={emptyText}
      filters={[
        {
          columnId: "statusLabel",
          label: "Status",
          options: [...new Set(rows.map((row) => row.statusLabel))].map((value) => ({
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
        {
          columnId: "modalidade",
          label: "Modalidade",
          options: [...new Set(rows.map((row) => row.modalidade).filter((value) => value !== "—"))].map((value) => ({
            value,
            label: value,
          })),
        },
      ]}
      getMobileTitle={(row) => (
        <Link href={`/pedido/${row.id}`} className="text-primary hover:underline">
          <span className="font-mono text-xs text-muted-foreground/80">{row.numero}</span> · {row.titulo}
        </Link>
      )}
      getMobileDescription={(row) => `${row.projeto} · ${row.coordenador} · ${row.proximaAcao}`}
      getMobileMeta={(row) => (
        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge status={row.status} />
          <PedidoItensQuickView numero={row.numero} titulo={row.titulo} itens={row.itensDetalhe} />
          {podeExcluir && <ExcluirPedido row={row} />}
        </div>
      )}
    />
  );
}
