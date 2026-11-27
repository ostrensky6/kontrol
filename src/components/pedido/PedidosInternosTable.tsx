"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/common/DataTable";
import { ApagarPedido } from "./ApagarPedido";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Etiqueta } from "@/components/common/Etiqueta";
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

/** Apagar vale em qualquer etapa (Antonio, 27/11/2026); o banco só recusa material já recebido (0186). */
function podeExcluirPedido(row: PedidoInternoRow, podeExcluir: boolean) {
  return podeExcluir && typeof row.status === "string" && row.status.length > 0;
}

function ExcluirPedido({ row }: { row: PedidoInternoRow }) {
  return <ApagarPedido pedidoId={row.id} numero={row.numero} titulo={row.titulo} status={row.status} />;
}

const URGENTE = new Set(["Alta", "Crítica"]);

function buildColumns(podeExcluir: boolean, temExcluivel: boolean): ColumnDef<PedidoInternoRow, unknown>[] {
  const cols: ColumnDef<PedidoInternoRow, unknown>[] = [
    {
      accessorKey: "numero",
      header: "Nº",
      cell: ({ row }) => (
        <Link href={`/pedido/${row.original.id}`} className="whitespace-nowrap text-sm tabular-nums text-muted-foreground hover:text-primary hover:underline">
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
        <div className="min-w-40">
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
        <div className="min-w-40 space-y-1">
          <EtapaProgresso etapa={row.original.etapa} />
          {/* ponto colorido e nome: status longo quebra a linha sem virar um bloco pesado */}
          <StatusBadge status={row.original.status} label={row.original.statusLabel} variante="ponto" />
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
        <div className="min-w-36">
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
        <div className="space-y-1">
          <p className="whitespace-nowrap tabular-nums">{row.original.necessidade}</p>
          {URGENTE.has(row.original.urgencia) && (
            <Etiqueta tom="perigo">Urgência {row.original.urgencia.toLowerCase()}</Etiqueta>
          )}
        </div>
      ),
    },
    // só para os filtros (não aparecem como coluna)
    { accessorKey: "projeto", header: "Projeto" },
    { accessorKey: "modalidade", header: "Modalidade" },
  ];
  // a coluna só existe quando alguma linha tem o que fazer nela (um rascunho
  // que dá para excluir): sem isso ficava uma coluna "Ações" vazia
  if (podeExcluir && temExcluivel) {
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
  emptyText = "Nenhum pedido ainda.",
  podeExcluir = false,
}: {
  rows: PedidoInternoRow[];
  emptyText?: string;
  podeExcluir?: boolean;
}) {
  return (
    <DataTable
      data={rows}
      columns={buildColumns(podeExcluir, rows.some((row) => podeExcluirPedido(row, podeExcluir)))}
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
          <span className="text-sm tabular-nums text-muted-foreground">{row.numero}</span> · {row.titulo}
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
