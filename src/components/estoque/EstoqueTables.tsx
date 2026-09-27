"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable, numericSort } from "@/components/common/DataTable";
import { Badge } from "@/components/ui/badge";
import { DarBaixaDialog } from "@/components/estoque/DarBaixaDialog";
import { LoteAcoes } from "@/components/estoque/LoteAcoes";
import { AjusteInventarioButton } from "@/components/estoque/ReceberLote";
import type { LoteBaixa, ModeloQuantidadeLote } from "@/lib/estoque/baixa";
import {
  FILTROS_SALDO,
  ROTULO_SALDO_EM_DIA,
  ROTULO_SITUACAO_SALDO,
  saldoAtendeFiltro,
  type SituacaoSaldo,
} from "@/lib/estoque/situacao-insumo";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { formatNumber as fmt } from "@/lib/formatters";

export type SaldoRow = {
  insumoId: number;
  especificacao: string;
  /** unidade do saldo: "frasco(s) de 100 mL" para insumo contado em frascos */
  unidade: string;
  /** unidade física do cadastro (mL, g…) */
  unidadeFisica?: string;
  /** insumo contado em frascos: a entrada avulsa é em frascos inteiros */
  embalagemFechada?: boolean;
  emMaos: number;
  reservado: number;
  disponivel: number;
  pontoReposicao: number;
  consumoMedioDiario: number;
  diasCobertura: number | null;
  pontoSugerido: number;
  /** todas as condições do insumo (vazio = em dia); o filtro Status casa por condição */
  situacoes: SituacaoSaldo[];
  /** texto da coluna Status, para busca e ordenação */
  statusLabel: string;
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

const SITUACAO_SALDO_CLASSE: Record<SituacaoSaldo, string> = {
  sem_estoque: "bg-secondary text-secondary-foreground",
  repor: "bg-warning-soft text-warning-strong",
  reposicao_pendente: "bg-warning-soft text-warning-strong",
};

/** Um selo por condição (sem estoque e repor podem aparecer juntos); nenhuma = "Em dia". */
function SaldoStatusBadge({ situacoes }: { situacoes: SituacaoSaldo[] }) {
  if (situacoes.length === 0) {
    return (
      <Badge className="bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300">
        {ROTULO_SALDO_EM_DIA}
      </Badge>
    );
  }
  return (
    <span className="inline-flex flex-wrap justify-center gap-1">
      {situacoes.map((situacao) => (
        <Badge key={situacao} className={SITUACAO_SALDO_CLASSE[situacao]}>
          {ROTULO_SITUACAO_SALDO[situacao]}
        </Badge>
      ))}
    </span>
  );
}

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

const saldoColumns = (podeMovimentar: boolean, entradaInicialInsumoId?: number): ColumnDef<SaldoRow, unknown>[] => [
  {
    accessorKey: "especificacao",
    header: "Reagente",
    meta: { className: "max-w-xs truncate" },
  },
  { accessorKey: "unidade", header: "Un." },
  {
    accessorKey: "emMaos",
    header: "Em mãos",
    sortingFn: numericSort,
    meta: { align: "right" },
    cell: ({ row }) => fmt(row.original.emMaos),
  },
  {
    accessorKey: "reservado",
    header: "Reservado",
    sortingFn: numericSort,
    meta: { align: "right" },
    cell: ({ row }) => fmt(row.original.reservado),
  },
  {
    accessorKey: "disponivel",
    header: "Disponível",
    sortingFn: numericSort,
    meta: { align: "right" },
    cell: ({ row }) => <span className="font-medium">{fmt(row.original.disponivel)}</span>,
  },
  {
    accessorKey: "pontoReposicao",
    header: "Ponto de reposição",
    sortingFn: numericSort,
    meta: { align: "right" },
    cell: ({ row }) => (row.original.pontoReposicao > 0 ? fmt(row.original.pontoReposicao) : "—"),
  },
  {
    accessorKey: "consumoMedioDiario",
    header: "Saídas/dia",
    sortingFn: numericSort,
    meta: { align: "right" },
    cell: ({ row }) => (row.original.consumoMedioDiario > 0 ? fmt(row.original.consumoMedioDiario) : "—"),
  },
  {
    accessorKey: "diasCobertura",
    header: "Cobertura",
    sortingFn: numericSort,
    meta: { align: "right" },
    cell: ({ row }) => (row.original.diasCobertura != null ? `${fmt(row.original.diasCobertura)} d` : "—"),
  },
  {
    accessorKey: "pontoSugerido",
    header: "Ponto sugerido",
    sortingFn: numericSort,
    meta: { align: "right" },
    cell: ({ row }) => (row.original.pontoSugerido > 0 ? fmt(row.original.pontoSugerido) : "—"),
  },
  {
    accessorKey: "statusLabel",
    header: "Status",
    meta: { align: "center" },
    // por condição: insumo sem estoque que também precisa repor aparece nos dois filtros
    filterFn: (row, _columnId, filtro) => saldoAtendeFiltro(row.original.situacoes, filtro),
    cell: ({ row }) => <SaldoStatusBadge situacoes={row.original.situacoes} />,
  },
  {
    id: "acoes",
    header: "Ações",
    enableSorting: false,
    enableGlobalFilter: false,
    meta: { align: "right" },
    cell: ({ row }) => (
      <SaldoAcoes row={row.original} podeMovimentar={podeMovimentar} entradaInicialInsumoId={entradaInicialInsumoId} />
    ),
  },
];

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
        unidade={row.unidade === "—" ? null : row.unidade}
        abertoInicial={row.insumoId === entradaInicialInsumoId}
        embalagemFechada={row.lotesBaixa.some((lote) => lote.modeloQuantidade === "EMBALAGEM_FECHADA")}
        emFrascos={row.embalagemFechada}
      />
      <DarBaixaDialog
        lotes={row.lotesBaixa}
        unidade={row.unidadeFisica ?? (row.unidade === "—" ? "" : row.unidade)}
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
  { accessorKey: "especificacao", header: "Reagente", meta: { className: "max-w-xs truncate" } },
  {
    accessorKey: "codigoLote",
    header: "Lote",
    cell: ({ row }) => (
      <Link
        href={`/estoque/lotes/${row.original.id}`}
        className="font-medium text-brand-700 hover:underline dark:text-brand-400"
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
  janelaDias = 90,
}: {
  rows: SaldoRow[];
  /** permissão "estoque.movimentar": mostra + Entrada e Dar baixa */
  podeMovimentar: boolean;
  entradaInicialInsumoId?: number;
  janelaDias?: number;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Saldo por insumo</h2>
        <HelpTip title="Como ler o saldo">
          <p>
            Insumo contado em frascos mostra o saldo em <b>frascos</b> (ex.: frasco(s) de 100 mL).
          </p>
          <p>
            <b>Em mãos</b> soma os lotes guardados. <b>Disponível</b> é o
            que sobra depois das reservas dos planos, sem contar vencidos.
          </p>
          <p>
            <b>Saídas/dia</b> é a média do que saiu do almoxarifado para o laboratório nos últimos {janelaDias} dias. Cobertura é quantos dias o disponível dura nesse ritmo.
            O <b>ponto sugerido</b> é o maior entre o ponto cadastrado e as saídas previstas durante o prazo
            da compra (tramitação na universidade + entrega do fornecedor), mais o estoque de segurança.
            O insumo vira <b>Repor</b> quando o disponível mais o que já está a caminho fica abaixo dele.
          </p>
          <p>
            <b>Reposição aguardando aprovação</b>: o que falta já foi pedido, mas o pedido ainda espera
            aprovação. Um insumo pode ter mais de um status (ex.: sem estoque e repor).
          </p>
          <HelpExample>
            10 em mãos, 4 reservados → 6 disponíveis. Consumo de 0,5/dia → cobertura de 12 dias.
          </HelpExample>
        </HelpTip>
      </div>
      <DataTable
        data={rows}
        columns={saldoColumns(podeMovimentar, entradaInicialInsumoId)}
        searchPlaceholder="Buscar reagente..."
        emptyText="Nenhum saldo encontrado."
        filters={[
          {
            columnId: "statusLabel",
            label: "Status",
            options: [...FILTROS_SALDO],
          },
        ]}
        getMobileTitle={(row) => row.especificacao}
        getMobileDescription={(row) =>
          `${fmt(row.disponivel)} ${row.unidade} disponível · cobertura ${row.diasCobertura != null ? `${fmt(row.diasCobertura)} d` : "—"} · ponto sugerido ${row.pontoSugerido ? fmt(row.pontoSugerido) : "—"}`
        }
        getMobileMeta={(row) => <SaldoStatusBadge situacoes={row.situacoes} />}
        getMobileActions={
          podeMovimentar
            ? (row) => <SaldoAcoes row={row} podeMovimentar={podeMovimentar} entradaInicialInsumoId={entradaInicialInsumoId} />
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
      searchPlaceholder="Buscar reagente ou lote..."
      emptyText="Nenhum lote em estoque. Use + Entrada na tabela acima para receber."
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
