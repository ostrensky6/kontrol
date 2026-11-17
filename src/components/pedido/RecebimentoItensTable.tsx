"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import { ScannerRecebimentoCompra, type ItemCompraRecebivel } from "@/components/compras/ScannerRecebimentoCompra";
import { ItemRecebimentoCell, type RecebimentoLancamento } from "./ItemRecebimentoCell";

type Insumo = { id: number; especificacao: string | null; unidade: string | null; codigo_fabricante?: string | null };

/**
 * Uma linha do que está para chegar (chegada única, auditoria de 16/11, item
 * 10). A fila é uma só: item de pedido e item de compra que não nasceu de
 * pedido (por exemplo, a nova compra de uma pendência) ficam na mesma tabela,
 * com a origem escrita.
 */
export type RecebimentoItemRow = {
  id: number;
  origem: "pedido" | "compra";
  /** "Nº 0504" ou "Compra #12" */
  origemRotulo: string;
  /** o pedido ou a compra de onde a linha vem */
  origemHref: string;
  /** título do pedido, ou o que é a compra ("Pendência da compra #9") */
  origemDetalhe: string;
  /** pedido da linha; nas linhas de compra, o número da compra */
  pedidoId: number;
  especificacao: string;
  quantidade: number;
  /** quantidade já na unidade de compra (frascos, caixas); sem ele vale quantidade + unidade */
  quantidadeRotulo?: string;
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
  /** item de pedido que espera a chegada sem compra ligada: não há chegada a registrar aqui */
  semCompra: boolean;
  /** item da compra que já pode chegar: recebe aqui, com o diálogo da compra */
  compraItem?: ItemCompraRecebivel | null;
};

type Local = { id: number; nome: string };

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

function quantidadeDaLinha(row: RecebimentoItemRow) {
  return row.quantidadeRotulo ?? `${row.quantidade} ${row.unidade ?? ""}`.trim();
}

/** A ação da linha: o mesmo "Registrar chegada" para pedido e para compra. */
function AcaoDaLinha({ row, locais }: { row: RecebimentoItemRow; locais: Local[] }) {
  if (row.origem === "compra") {
    return row.compraItem ? (
      <div data-testid="chegada-da-compra">
        <ScannerRecebimentoCompra item={row.compraItem} locais={locais} />
      </div>
    ) : (
      <span className="text-xs text-muted-foreground">Requer a permissão “Registrar chegada de compras”</span>
    );
  }
  return (
    <ItemRecebimentoCell
      item={{
        id: row.id,
        pedidoId: row.pedidoId,
        especificacao: row.especificacao,
        quantidade: row.quantidade,
        quantidadeRecebida: row.quantidadeRecebida,
        compraFormalId: row.compraFormalId,
        unidade: row.unidade,
      }}
      semCompra={row.semCompra}
      recebimentos={row.recebimentos}
      chegadaPelaCompra={row.compraItem ? { item: row.compraItem, locais } : null}
    />
  );
}

function colunas(insumos: Insumo[], locais: Local[]): ColumnDef<RecebimentoItemRow, unknown>[] {
  return [
    {
      accessorKey: "origemRotulo",
      header: "Origem",
      cell: ({ row }) => (
        <Link href={row.original.origemHref} className="whitespace-nowrap font-mono text-xs text-muted-foreground hover:underline">
          {row.original.origemRotulo}
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
          <p className="text-xs text-muted-foreground">{row.original.origemDetalhe}</p>
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
          <span>{quantidadeDaLinha(row.original)}</span>
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
      cell: ({ row }) => <AcaoDaLinha row={row.original} locais={locais} />,
    },
  ];
}

export function RecebimentoItensTable({
  rows,
  insumos,
  locais = [],
}: {
  rows: RecebimentoItemRow[];
  insumos: Insumo[];
  /** onde o lote pode ficar guardado (chegada pelo item da compra) */
  locais?: Local[];
}) {
  return (
    <DataTable
      data={rows}
      columns={colunas(insumos, locais)}
      searchPlaceholder="Buscar item, pedido, compra, projeto ou fornecedor..."
      emptyText="Nada aguardando chegada."
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
          <span className="font-mono text-xs text-muted-foreground/80">{row.origemRotulo}</span> · {row.especificacao}
        </span>
      )}
      getMobileDescription={(row) => `${row.projeto} · ${quantidadeDaLinha(row)}`}
      getMobileMeta={(row) => (
        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge status={row.status} />
          <AcaoDaLinha row={row} locais={locais} />
        </div>
      )}
    />
  );
}
