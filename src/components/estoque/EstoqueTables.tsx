"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable, numericSort } from "@/components/common/DataTable";
import { Badge } from "@/components/ui/badge";
import { DarBaixaDialog } from "@/components/estoque/DarBaixaDialog";
import { LoteAcoes } from "@/components/estoque/LoteAcoes";
import { AjusteInventarioButton } from "@/components/estoque/ReceberLote";
import type { LoteBaixa, ModeloQuantidadeLote } from "@/lib/estoque/baixa";
import { EstoqueDisponivelTable } from "@/components/suprimentos/EstoqueDisponivelTable";
import type { FiltroEstoqueDisponivel, LinhaEstoqueDisponivel } from "@/lib/suprimentos/estoque-disponivel";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { formatNumber as fmt } from "@/lib/formatters";

/**
 * Linha do Saldo por insumo: a mesma linha da visão geral de Suprimentos
 * (montarEstoqueDisponivel, D1), mais o que a entrada e a baixa precisam.
 */
export type SaldoRow = LinhaEstoqueDisponivel & {
  /** unidade física do cadastro (mL, g…) */
  unidadeFisica: string;
  /** insumo contado em frascos: a entrada avulsa é em frascos inteiros */
  embalagemFechada: boolean;
  /** lotes do insumo candidatos à baixa (o diálogo escolhe por FEFO) */
  lotesBaixa: LoteBaixa[];
};

export type LoteRow = {
  id: number;
  especificacao: string;
  unidade: string;
  codigoLote: string;
  validade: string;
  /** validade efetiva em aaaa-mm-dd (null = sem validade) */
  validadeIso: string | null;
  quantidadeAtual: number;
  reservado: number;
  modeloQuantidade: ModeloQuantidadeLote;
  status: string;
  statusLabel: string;
  vencido: boolean;
  critico: boolean;
  estornoDiretoPermitido: boolean;
  /** quem registrou a chegada não aceita o próprio lote */
  aceiteBloqueadoMotivo?: string | null;
};

function LoteStatusBadge({ status, label }: { status: string; label: string }) {
  const className =
    status === "quarentena"
      ? "bg-warning-soft text-warning-strong"
      : status === "aceito"
        ? "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300"
        : status === "em_uso"
          ? "bg-info-soft text-info-strong"
          : status === "bloqueado"
            ? "bg-danger-soft text-danger-strong"
            : "bg-secondary text-secondary-foreground";

  return <Badge className={className}>{label}</Badge>;
}

const colunaAcoesSaldo = (entradaInicialInsumoId?: number): ColumnDef<SaldoRow, unknown> => ({
  id: "acoes",
  header: "Ações",
  enableSorting: false,
  enableGlobalFilter: false,
  meta: { align: "right" },
  cell: ({ row }) => <SaldoAcoes row={row.original} podeMovimentar entradaInicialInsumoId={entradaInicialInsumoId} />,
});

function SaldoAcoes({
  row,
  podeMovimentar,
  entradaInicialInsumoId,
}: {
  row: SaldoRow;
  /** permissão "estoque.movimentar": entrada e baixa */
  podeMovimentar: boolean;
  entradaInicialInsumoId?: number;
}) {
  if (!podeMovimentar) return null;
  return (
    <span className="inline-flex flex-wrap items-start justify-end gap-1">
      <AjusteInventarioButton
        insumoId={row.insumoId}
        especificacao={row.especificacao}
        unidade={row.unidade || null}
        abertoInicial={row.insumoId === entradaInicialInsumoId}
        embalagemFechada={row.lotesBaixa.some((lote) => lote.modeloQuantidade === "EMBALAGEM_FECHADA")}
        emFrascos={row.embalagemFechada}
      />
      <DarBaixaDialog
        lotes={row.lotesBaixa}
        unidade={row.unidadeFisica || row.unidade}
        especificacao={row.especificacao}
      />
    </span>
  );
}

type PermissoesLote = {
  podeAceitar: boolean;
  podeGerir: boolean;
  podeCorrigir?: boolean;
  podeBaixar?: boolean;
  /** quem está logado: sugestão do responsável no aceite do lote */
  responsavelPadrao?: string;
};

function LoteAcoesLinha({ row, podeAceitar, podeGerir, podeCorrigir, podeBaixar, responsavelPadrao }: { row: LoteRow } & PermissoesLote) {
  return (
    <LoteAcoes
      compacto
      loteId={row.id}
      codigoLote={row.codigoLote}
      status={row.status}
      quantidadeAtual={row.quantidadeAtual}
      unidade={row.unidade}
      critico={row.critico}
      validade={row.validadeIso}
      vencido={row.vencido}
      reservado={row.reservado}
      modeloQuantidade={row.modeloQuantidade}
      estornoDiretoPermitido={row.estornoDiretoPermitido}
      aceiteBloqueadoMotivo={row.aceiteBloqueadoMotivo ?? null}
      podeAceitar={podeAceitar}
      podeGerir={podeGerir}
      podeCorrigir={podeCorrigir}
      podeBaixar={podeBaixar}
      responsavelPadrao={responsavelPadrao}
    />
  );
}

const lotesColumns = (permissoes: PermissoesLote): ColumnDef<LoteRow, unknown>[] => [
  { accessorKey: "especificacao", header: "Insumo", meta: { className: "max-w-xs truncate" } },
  {
    accessorKey: "codigoLote",
    header: "Lote",
    cell: ({ row }) => (
      <Link
        href={`/estoque/lotes/${row.original.id}`}
        className="font-medium text-brand-700 hover:underline dark:text-brand-300"
      >
        {row.original.codigoLote}
      </Link>
    ),
  },
  {
    accessorKey: "validade",
    header: "Validade",
    cell: ({ row }) => (
      <span className={row.original.vencido ? "font-medium text-destructive" : undefined}>
        {row.original.validade}
        {row.original.vencido ? " !" : ""}
      </span>
    ),
  },
  {
    accessorKey: "quantidadeAtual",
    header: "Saldo",
    sortingFn: numericSort,
    meta: { align: "right" },
    cell: ({ row }) => `${fmt(row.original.quantidadeAtual)} ${row.original.unidade}`,
  },
  {
    accessorKey: "statusLabel",
    header: "Estado",
    meta: { align: "center" },
    filterFn: "equalsString",
    cell: ({ row }) => <LoteStatusBadge status={row.original.status} label={row.original.statusLabel} />,
  },
  {
    id: "acoes",
    header: "Ações",
    enableSorting: false,
    enableGlobalFilter: false,
    meta: { align: "right" },
    cell: ({ row }) => <LoteAcoesLinha row={row.original} {...permissoes} />,
  },
];

export function SaldoTable({
  rows,
  podeMovimentar,
  entradaInicialInsumoId,
  filtroInicial = "todos",
}: {
  rows: SaldoRow[];
  /** permissão "estoque.movimentar": mostra + Entrada e Dar baixa */
  podeMovimentar: boolean;
  entradaInicialInsumoId?: number;
  filtroInicial?: FiltroEstoqueDisponivel;
}) {
  const colunaAcoes = useMemo(
    () => (podeMovimentar ? colunaAcoesSaldo(entradaInicialInsumoId) : undefined),
    [podeMovimentar, entradaInicialInsumoId],
  );
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <h2 className="text-sm font-semibold text-muted-foreground">Saldo por insumo</h2>
        <HelpTip title="Como ler o saldo">
          <p>
            <b>Disponível</b> é o que pode ser usado agora: os lotes guardados menos o que está reservado para
            os planos, sem contar vencidos. <b>A caminho</b> é o que já foi comprado ou autorizado e ainda não
            chegou; o que espera aprovação aparece à parte.
          </p>
          <p>
            <b>Situação</b> segue as mesmas regras da visão geral de Suprimentos e da ficha do insumo. Clique no
            nome para ver em mãos, cobertura, prazo de compra, lotes e consumo.
          </p>
          <HelpExample>10 em mãos, 4 reservados → 6 disponíveis.</HelpExample>
        </HelpTip>
      </div>
      <EstoqueDisponivelTable
        linhas={rows}
        filtroInicial={filtroInicial}
        filtroPadrao="todos"
        comValidade={false}
        colunaAcoes={colunaAcoes}
        acoesNoCelular={
          podeMovimentar
            ? (row) => <SaldoAcoes row={row} podeMovimentar entradaInicialInsumoId={entradaInicialInsumoId} />
            : undefined
        }
      />
    </div>
  );
}

export function LotesTable({
  rows,
  ...permissoes
}: {
  rows: LoteRow[];
} & PermissoesLote) {
  return (
    <DataTable
      data={rows}
      columns={lotesColumns(permissoes)}
      searchPlaceholder="Buscar insumo ou lote..."
      emptyText="Nenhum lote em estoque. Use + Entrada em Saldo por insumo para receber."
      filters={[
        {
          columnId: "statusLabel",
          label: "Estado",
          options: [
            { value: "Disponível", label: "Disponível" },
            { value: "Em uso", label: "Em uso" },
            { value: "Bloqueado", label: "Bloqueado" },
          ],
        },
      ]}
      getMobileTitle={(row) => row.especificacao}
      getMobileDescription={(row) =>
        `Lote ${row.codigoLote} · validade ${row.validade} · ${fmt(row.quantidadeAtual)} ${row.unidade}`
      }
      getMobileMeta={(row) => <LoteStatusBadge status={row.status} label={row.statusLabel} />}
      getMobileHref={(row) => `/estoque/lotes/${row.id}`}
      getMobileActions={(row) => <LoteAcoesLinha row={row} {...permissoes} />}
    />
  );
}
