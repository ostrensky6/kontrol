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
import { EtapaProgresso } from "./EtapaProgresso";
import { posicaoEtapa, type EtapaPedidoId } from "@/lib/pedido/etapas";

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
  /** 0172: mês do ciclo de compras ("—" antes da aprovação da coordenação) */
  ciclo?: string;
  itens: number;
  itensDetalhe: PedidoItemView[];
  total: string;
  status: string;
  statusLabel: string;
  /** etapa do fluxo (solicitação → pagamento), para a barra de etapas */
  etapa: EtapaPedidoId;
  proximaAcao: string;
  responsavelAtual: string;
  documentos: string;
  modalidade: string;
  compraFormal: string;
  pedidoCompraId: number | null;
  recebimento: string;
  pendencias: string;
};

function podeExcluirPedido(row: PedidoInternoRow, podeExcluir: boolean) {
  return podeExcluir && row.status === "rascunho" && row.pedidoCompraId === null;
}

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
              className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir rascunho
            </button>
          </FormComMensagem>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const URGENTE = new Set(["Alta", "Crítica"]);

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
      // a busca também encontra projeto, solicitante e coordenador
      id: "titulo",
      accessorFn: (row) => `${row.titulo} ${row.projeto} ${row.solicitante} ${row.coordenador}`,
      header: "Pedido",
      cell: ({ row }) => (
        <div className="min-w-52">
          <Link href={`/pedido/${row.original.id}`} className="font-medium text-primary hover:underline">
            {row.original.titulo}
          </Link>
          <p className="text-xs text-muted-foreground">
            {[row.original.projeto !== "—" ? row.original.projeto : "Sem projeto", row.original.solicitante !== "—" ? row.original.solicitante : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      ),
    },
    {
      id: "etapa",
      accessorFn: (row) => `${row.statusLabel} ${row.ciclo ?? ""}`,
      header: "Etapa",
      // ordena pela posição no fluxo, não pelo nome do status
      sortingFn: (a, b) => posicaoEtapa(a.original.etapa) - posicaoEtapa(b.original.etapa),
      cell: ({ row }) => (
        <div className="min-w-44 space-y-1">
          <EtapaProgresso etapa={row.original.etapa} />
          <StatusBadge status={row.original.status} label={row.original.statusLabel} />
          {row.original.ciclo && row.original.ciclo !== "—" && (
            <p className="text-xs text-muted-foreground">Ciclo {row.original.ciclo}</p>
          )}
          {row.original.recebimento !== "—" && row.original.etapa !== "solicitacao" && (
            <p className="text-xs text-muted-foreground">Chegou {row.original.recebimento.replace("/", " de ")} itens</p>
          )}
        </div>
      ),
    },
    {
      id: "proximaAcao",
      accessorFn: (row) => `${row.proximaAcao} ${row.responsavelAtual}`,
      header: "Próximo passo",
      cell: ({ row }) => (
        <div className="min-w-44">
          <p className="font-medium text-foreground">{row.original.proximaAcao}</p>
          {row.original.responsavelAtual !== "—" && (
            <p className="text-xs text-muted-foreground">com {row.original.responsavelAtual}</p>
          )}
          {row.original.pendencias !== "—" && (
            <p className="text-xs text-warning-strong">Falta: {row.original.pendencias}</p>
          )}
        </div>
      ),
    },
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
    { accessorKey: "total", header: "Valor prévio", meta: { align: "right" } },
    {
      id: "necessidade",
      accessorFn: (row) => `${row.necessidade} ${row.urgencia}`,
      header: "Precisa até",
      cell: ({ row }) => (
        <div className="whitespace-nowrap">
          <p className="tabular-nums">{row.original.necessidade}</p>
          {URGENTE.has(row.original.urgencia) && (
            <span className="inline-flex rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger-strong">
              Urgência {row.original.urgencia.toLowerCase()}
            </span>
          )}
        </div>
      ),
    },
    // só para os filtros (não aparecem como coluna)
    { accessorKey: "projeto", header: "Projeto" },
    { accessorKey: "modalidade", header: "Modalidade" },
  ];
  if (podeExcluir) {
    cols.push({
      id: "acoes",
      header: "Ações",
      meta: { align: "right" },
      enableSorting: false,
      cell: ({ row }) => (podeExcluirPedido(row.original, podeExcluir) ? <ExcluirPedido row={row.original} /> : null),
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
      searchPlaceholder="Buscar pedido, projeto ou solicitante..."
      emptyText={emptyText}
      colunasOcultas={["projeto", "modalidade"]}
      filters={[
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
      getMobileDescription={(row) => (
        <span className="block space-y-1">
          <EtapaProgresso etapa={row.etapa} />
          <span className="block font-medium text-foreground">{row.statusLabel}</span>
          <span className="block">
            {row.proximaAcao}
            {row.responsavelAtual !== "—" ? ` · com ${row.responsavelAtual}` : ""}
          </span>
          <span className="block text-xs">{row.projeto !== "—" ? row.projeto : "Sem projeto"}</span>
        </span>
      )}
      getMobileMeta={(row) => (
        <div className="flex flex-col items-end gap-1.5">
          <PedidoItensQuickView numero={row.numero} titulo={row.titulo} itens={row.itensDetalhe} />
          {podeExcluirPedido(row, podeExcluir) && <ExcluirPedido row={row} />}
        </div>
      )}
    />
  );
}
