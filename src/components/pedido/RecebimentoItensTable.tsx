"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ItemRecebimentoCell, type RecebimentoLancamento } from "./ItemRecebimentoCell";

type Insumo = { id: number; especificacao: string | null; unidade: string | null; codigo_fabricante?: string | null };

export type RecebimentoItemRow = {
  id: number;
  pedidoId: number;
  pedidoNumero: string;
  pedidoTitulo: string;
  especificacao: string;
  quantidade: number;
  quantidadeRecebida?: number | null;
  compraFormalId?: number | null;
  unidade: string | null;
  insumoId: number | null;
  fornecedorSugerido: string | null;
  orcamentoPrevio: number | null;
  recebimentos?: RecebimentoLancamento[];
  projeto: string;
  status: string;
  statusLabel: string;
  podeReceber: boolean;
};

/** Código do fabricante do insumo vinculado: quem recebe confere o produto exato. */
function CodigoFabricanteDoItem({ insumos, insumoId }: { insumos: Insumo[]; insumoId: number | null }) {
  const codigo = insumoId == null ? null : insumos.find((insumo) => insumo.id === insumoId)?.codigo_fabricante?.trim();
  if (!codigo) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Código do fabricante: <span className="font-mono">{codigo}</span>
    </p>
  );
}

function colunas(insumos: Insumo[]): ColumnDef<RecebimentoItemRow, unknown>[] {
  return [
    {
      accessorKey: "pedidoNumero",
      header: "Nº",
      cell: ({ row }) => (
        <Link href={`/pedido/${row.original.pedidoId}`} className="font-mono text-xs text-muted-foreground hover:underline">
          {row.original.pedidoNumero}
        </Link>
      ),
    },
    {
      accessorKey: "especificacao",
      header: "Item",
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.especificacao}</p>
          <CodigoFabricanteDoItem insumos={insumos} insumoId={row.original.insumoId} />
          <p className="text-xs text-muted-foreground">{row.original.pedidoTitulo}</p>
        </div>
      ),
    },
    { accessorKey: "projeto", header: "Projeto" },
    {
      id: "qtd",
      header: "Qtd",
      meta: { align: "right" },
      cell: ({ row }) => (
        <div className="text-right tabular-nums">
          <span>{row.original.quantidade} {row.original.unidade ?? ""}</span>
          {Number(row.original.quantidadeRecebida ?? 0) > 0 && (
            <p className="text-[11px] font-medium text-warning-strong">
              recebido {row.original.quantidadeRecebida}
            </p>
          )}
        </div>
      ),
    },
    {
      accessorKey: "fornecedorSugerido",
      header: "Fornecedor",
      cell: ({ row }) => row.original.fornecedorSugerido ?? "—",
    },
    {
      accessorKey: "statusLabel",
      header: "Etapa",
      meta: { align: "center" },
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
      filterFn: "equalsString",
    },
    {
      id: "recebimento",
      header: "Recebimento",
      meta: { align: "right" },
      enableSorting: false,
      cell: ({ row }) => (
        <ItemRecebimentoCell
          item={{
            id: row.original.id,
            pedidoId: row.original.pedidoId,
            especificacao: row.original.especificacao,
            quantidade: row.original.quantidade,
            quantidadeRecebida: row.original.quantidadeRecebida,
            compraFormalId: row.original.compraFormalId,
            unidade: row.original.unidade,
            insumoId: row.original.insumoId,
            fornecedorSugerido: row.original.fornecedorSugerido,
            orcamentoPrevio: row.original.orcamentoPrevio,
          }}
          insumos={insumos}
          podeReceber={row.original.podeReceber}
          recebimentos={row.original.recebimentos}
        />
      ),
    },
  ];
}

export function RecebimentoItensTable({
  rows,
  insumos,
}: {
  rows: RecebimentoItemRow[];
  insumos: Insumo[];
}) {
  return (
    <DataTable
      data={rows}
      columns={colunas(insumos)}
      searchPlaceholder="Buscar item, pedido, projeto ou fornecedor..."
      emptyText="Nenhum item de pedido aguardando chegada."
      filters={[
        {
          columnId: "statusLabel",
          label: "Etapa",
          options: [...new Set(rows.map((row) => row.statusLabel))].map((value) => ({ value, label: value })),
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
        <span>
          <span className="font-mono text-xs text-muted-foreground/80">{row.pedidoNumero}</span> · {row.especificacao}
        </span>
      )}
      getMobileDescription={(row) => `${row.projeto} · ${row.quantidade} ${row.unidade ?? ""}`}
      getMobileMeta={(row) => (
        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge status={row.status} />
          <ItemRecebimentoCell
            item={{
              id: row.id,
              pedidoId: row.pedidoId,
              especificacao: row.especificacao,
              quantidade: row.quantidade,
              quantidadeRecebida: row.quantidadeRecebida,
              compraFormalId: row.compraFormalId,
              unidade: row.unidade,
              insumoId: row.insumoId,
              fornecedorSugerido: row.fornecedorSugerido,
              orcamentoPrevio: row.orcamentoPrevio,
            }}
            insumos={insumos}
            podeReceber={row.podeReceber}
            recebimentos={row.recebimentos}
          />
        </div>
      )}
    />
  );
}
