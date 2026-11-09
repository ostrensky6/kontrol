"use client";

import { useMemo, useState } from "react";

import { FiltroChips, gravarFiltroNaUrl } from "@/components/common/FiltroChips";
import { PedidosInternosTable, type PedidoInternoRow } from "./PedidosInternosTable";
import {
  ETAPAS_PEDIDO,
  atendeFiltroEtapa,
  type FiltroEtapa,
} from "@/lib/pedido/etapas";
import { cn } from "@/lib/utils";

/**
 * Lista de pedidos organizada pelas seis etapas do fluxo. Clicar numa etapa
 * mostra só os pedidos dela; os botões de baixo trocam entre em andamento,
 * concluídos, cancelados e todos.
 */
export function PedidosPorEtapa({
  rows,
  podeExcluir,
  filtroInicial,
}: {
  rows: PedidoInternoRow[];
  podeExcluir: boolean;
  filtroInicial: FiltroEtapa;
}) {
  const [filtro, setFiltro] = useState<FiltroEtapa>(filtroInicial);
  const contar = (f: FiltroEtapa) => rows.filter((row) => atendeFiltroEtapa(row.etapa, f)).length;
  const visiveis = useMemo(() => rows.filter((row) => atendeFiltroEtapa(row.etapa, filtro)), [rows, filtro]);

  function mudar(valor: FiltroEtapa) {
    setFiltro(valor);
    gravarFiltroNaUrl("etapa", valor, "andamento");
  }

  const rotuloFiltro =
    ETAPAS_PEDIDO.find((e) => e.id === filtro)?.rotulo ??
    { andamento: "em andamento", concluido: "concluídos", cancelado: "cancelados", todos: "todos" }[filtro as string];

  return (
    <div className="space-y-4">
      <nav aria-label="Etapas do pedido">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {ETAPAS_PEDIDO.map((etapa, i) => {
            const n = contar(etapa.id);
            const ativa = filtro === etapa.id;
            return (
              <li key={etapa.id}>
                <button
                  type="button"
                  aria-pressed={ativa}
                  onClick={() => mudar(ativa ? "andamento" : etapa.id)}
                  className={cn(
                    "flex h-full w-full flex-col rounded-lg border p-3 text-left transition",
                    ativa
                      ? "border-primary bg-primary/10 ring-1 ring-primary"
                      : "border-border bg-card hover:border-primary/50 hover:bg-primary/5",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Etapa {i + 1}
                    </span>
                    <span className={cn("text-xl font-semibold tabular-nums", n > 0 ? "text-foreground" : "text-muted-foreground")}>
                      {n}
                    </span>
                  </span>
                  <span className="text-sm font-medium text-foreground">{etapa.rotulo}</span>
                  <span className="mt-0.5 hidden text-xs leading-4 text-muted-foreground sm:block">{etapa.descricao}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <FiltroChips
          rotulo="Mostrar pedidos"
          valor={filtro}
          aoMudar={mudar}
          opcoes={[
            { valor: "andamento", rotulo: "Em andamento", contagem: contar("andamento") },
            { valor: "concluido", rotulo: "Concluídos", contagem: contar("concluido") },
            { valor: "cancelado", rotulo: "Cancelados", contagem: contar("cancelado") },
            { valor: "todos", rotulo: "Todos", contagem: rows.length },
          ]}
        />
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Mostrando {visiveis.length} {visiveis.length === 1 ? "pedido" : "pedidos"} · {rotuloFiltro}
        </p>
      </div>

      <PedidosInternosTable
        rows={visiveis}
        podeExcluir={podeExcluir}
        emptyText={rows.length ? "Nenhum pedido nesta etapa." : "Nenhum pedido ainda. Use “Novo pedido” para começar."}
      />
    </div>
  );
}
