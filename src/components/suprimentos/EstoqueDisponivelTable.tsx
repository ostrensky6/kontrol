"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable, numericSort } from "@/components/common/DataTable";
import { FiltroCartoes, gravarFiltroNaUrl } from "@/components/common/FiltroChips";
import { formatDate, formatNumber } from "@/lib/formatters";
import {
  FILTRO_ESTOQUE_PADRAO,
  FILTROS_ESTOQUE_DISPONIVEL,
  linhaAtendeFiltro,
  type FiltroEstoqueDisponivel,
  type LinhaEstoqueDisponivel,
} from "@/lib/suprimentos/estoque-disponivel";
import { cn } from "@/lib/utils";

const TOM_SITUACAO: Record<LinhaEstoqueDisponivel["tom"], string> = {
  red: "bg-danger-soft text-danger-strong",
  amber: "bg-warning-soft text-warning-strong",
  slate: "bg-success-soft text-success-strong",
};

const TOM_FILTRO: Partial<Record<FiltroEstoqueDisponivel, "red" | "amber">> = {
  atencao: "amber",
  reposicao: "amber",
  sem_disponivel: "red",
  vencido_vencendo: "amber",
};

function Quantidade({ valor, unidade, forte = false }: { valor: number; unidade?: string; forte?: boolean }) {
  return (
    <span className={cn("tabular-nums", forte && "font-semibold text-foreground")}>
      {formatNumber(valor)}
      {unidade ? <span className="ml-1 text-xs font-normal text-muted-foreground">{unidade}</span> : null}
    </span>
  );
}

function Situacao({ linha }: { linha: LinhaEstoqueDisponivel }) {
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold", TOM_SITUACAO[linha.tom])}>
        {linha.situacao}
      </span>
      {linha.sugerido > 0 && (
        <span className="text-xs text-muted-foreground">
          pedir ~{formatNumber(linha.sugerido)} {linha.unidade}
        </span>
      )}
    </div>
  );
}

function Validade({ linha }: { linha: LinhaEstoqueDisponivel }) {
  if (!linha.validade) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "tabular-nums",
        linha.validadeEstado === "vencido" && "font-semibold text-danger-strong",
        linha.validadeEstado === "vencendo" && "font-medium text-warning-strong",
      )}
    >
      {formatDate(linha.validade)}
      {linha.validadeEstado === "vencido" ? " · vencido" : ""}
    </span>
  );
}

const colunas: ColumnDef<LinhaEstoqueDisponivel, unknown>[] = [
  {
    accessorKey: "especificacao",
    header: "Insumo",
    cell: ({ row }) => (
      <div className="min-w-48">
        <p className="font-medium text-foreground">{row.original.especificacao}</p>
        {row.original.tipo && <p className="text-xs text-muted-foreground">{row.original.tipo}</p>}
      </div>
    ),
  },
  {
    accessorKey: "disponivel",
    header: "Disponível",
    sortingFn: numericSort,
    meta: { align: "right" },
    cell: ({ row }) => <Quantidade valor={row.original.disponivel} unidade={row.original.unidade} forte />,
  },
  {
    accessorKey: "reservado",
    header: "Reservado",
    sortingFn: numericSort,
    meta: { align: "right" },
    cell: ({ row }) => (row.original.reservado > 0 ? <Quantidade valor={row.original.reservado} /> : <span className="text-muted-foreground">—</span>),
  },
  {
    accessorKey: "aCaminho",
    header: "A caminho",
    sortingFn: numericSort,
    meta: { align: "right" },
    cell: ({ row }) => (row.original.aCaminho > 0 ? <Quantidade valor={row.original.aCaminho} /> : <span className="text-muted-foreground">—</span>),
  },
  {
    accessorKey: "minimo",
    header: "Mínimo",
    sortingFn: numericSort,
    meta: { align: "right" },
    cell: ({ row }) => (row.original.minimo > 0 ? <Quantidade valor={row.original.minimo} /> : <span className="text-muted-foreground">—</span>),
  },
  {
    accessorKey: "validade",
    header: "Validade mais próxima",
    cell: ({ row }) => <Validade linha={row.original} />,
  },
  {
    accessorKey: "situacao",
    header: "Situação",
    cell: ({ row }) => <Situacao linha={row.original} />,
  },
];

export function EstoqueDisponivelTable({
  linhas,
  filtroInicial,
}: {
  linhas: LinhaEstoqueDisponivel[];
  filtroInicial: FiltroEstoqueDisponivel;
}) {
  const [filtro, setFiltro] = useState<FiltroEstoqueDisponivel>(filtroInicial);
  const opcoes = useMemo(
    () =>
      FILTROS_ESTOQUE_DISPONIVEL.map((f) => ({
        valor: f.valor,
        rotulo: f.rotulo,
        descricao: f.descricao,
        contagem: linhas.filter((linha) => linhaAtendeFiltro(linha, f.valor)).length,
        tom: TOM_FILTRO[f.valor] ?? ("neutro" as const),
      })),
    [linhas],
  );
  const visiveis = useMemo(() => linhas.filter((linha) => linhaAtendeFiltro(linha, filtro)), [linhas, filtro]);

  function mudar(valor: FiltroEstoqueDisponivel) {
    setFiltro(valor);
    gravarFiltroNaUrl("situacao", valor, FILTRO_ESTOQUE_PADRAO);
  }

  return (
    <div className="space-y-3">
      <FiltroCartoes opcoes={opcoes} valor={filtro} aoMudar={mudar} rotulo="Filtrar por situação" />
      <DataTable
        data={visiveis}
        columns={colunas}
        searchPlaceholder="Buscar insumo..."
        emptyTitle={
          linhas.length === 0
            ? "Nenhum insumo ativo"
            : filtro === "atencao"
              ? "Nenhum insumo precisa de atenção"
              : "Nenhum insumo nesta situação"
        }
        emptyText={
          linhas.length === 0
            ? "Cadastre insumos em Cadastros para acompanhar o estoque."
            : filtro === "atencao"
              ? "Estoque em dia. Para ver a lista inteira, escolha Todos."
              : "Escolha outra situação acima."
        }
        getMobileTitle={(linha) => linha.especificacao}
        getMobileDescription={(linha) =>
          `Disponível ${formatNumber(linha.disponivel)} ${linha.unidade}` +
          (linha.reservado > 0 ? ` · reservado ${formatNumber(linha.reservado)}` : "") +
          (linha.aCaminho > 0 ? ` · a caminho ${formatNumber(linha.aCaminho)}` : "") +
          (linha.validade ? ` · validade ${formatDate(linha.validade)}` : "")
        }
        getMobileMeta={(linha) => <Situacao linha={linha} />}
      />
    </div>
  );
}
