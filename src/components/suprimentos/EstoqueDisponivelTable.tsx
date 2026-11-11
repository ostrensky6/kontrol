"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable, numericSort } from "@/components/common/DataTable";
import { FiltroCartoes, gravarFiltroNaUrl } from "@/components/common/FiltroChips";
import { hrefFichaInsumo } from "@/lib/estoque/ficha-insumo-rota";
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

/** A caminho é fato (comprado ou autorizado); o que espera aprovação fica à parte. */
function ACaminho({ linha }: { linha: LinhaEstoqueDisponivel }) {
  if (linha.aCaminho === null) {
    return <span className="text-xs text-muted-foreground" title="A previsão deste insumo não foi lida">sem dado</span>;
  }
  const esperando = linha.aguardandoAprovacao ?? 0;
  return (
    <div className="flex flex-col items-end gap-0.5">
      {linha.aCaminho > 0 ? <Quantidade valor={linha.aCaminho} /> : <span className="tabular-nums text-muted-foreground">0</span>}
      {esperando > 0 && (
        <span className="text-xs text-warning-strong">+{formatNumber(esperando)} aguardando aprovação</span>
      )}
    </div>
  );
}

const colunas: ColumnDef<LinhaEstoqueDisponivel, unknown>[] = [
  {
    accessorKey: "especificacao",
    header: "Insumo",
    cell: ({ row }) => (
      <div className="min-w-48">
        {/* F5: o nome abre a ficha do insumo */}
        <Link
          href={hrefFichaInsumo(row.original.insumoId) ?? "/estoque"}
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          {row.original.especificacao}
        </Link>
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
    cell: ({ row }) => <ACaminho linha={row.original} />,
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
        getMobileHref={(linha) => hrefFichaInsumo(linha.insumoId)}
        getMobileDescription={(linha) =>
          `Disponível ${formatNumber(linha.disponivel)} ${linha.unidade}` +
          (linha.reservado > 0 ? ` · reservado ${formatNumber(linha.reservado)}` : "") +
          (linha.aCaminho === null ? " · a caminho: sem dado" : linha.aCaminho > 0 ? ` · a caminho ${formatNumber(linha.aCaminho)}` : "") +
          ((linha.aguardandoAprovacao ?? 0) > 0 ? ` · ${formatNumber(linha.aguardandoAprovacao ?? 0)} aguardando aprovação` : "") +
          (linha.validade ? ` · validade ${formatDate(linha.validade)}` : "")
        }
        getMobileMeta={(linha) => <Situacao linha={linha} />}
      />
    </div>
  );
}
