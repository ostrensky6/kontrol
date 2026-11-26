"use client";

import { useMemo, useState } from "react";

import { FiltroChips, gravarFiltroNaUrl } from "@/components/common/FiltroChips";
import { ListaParcial } from "@/components/common/ListaParcial";
import { encerradosParciais, type Encerrados } from "@/lib/supabase/lista-recente";
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
 *
 * Os pedidos em andamento vêm sempre todos. Dos concluídos e cancelados a
 * página pode trazer só os mais recentes (`encerrados`): nesse caso os botões
 * deles ficam sem contagem, e a lista diz quantos existem e oferece todos.
 */
export function PedidosPorEtapa({
  rows,
  podeExcluir,
  filtroInicial,
  encerrados,
  todosEncerrados = false,
}: {
  rows: PedidoInternoRow[];
  podeExcluir: boolean;
  filtroInicial: FiltroEtapa;
  encerrados?: Encerrados;
  todosEncerrados?: boolean;
}) {
  const [filtro, setFiltro] = useState<FiltroEtapa>(filtroInicial);
  const contar = (f: FiltroEtapa) => rows.filter((row) => atendeFiltroEtapa(row.etapa, f)).length;
  // com a lista de encerrados cortada, a contagem da tela seria menor que a do banco
  const parcial = encerradosParciais(encerrados);
  const contarEncerrados = (f: FiltroEtapa) => (parcial ? undefined : contar(f));
  const mostraEncerrados = filtro === "concluido" || filtro === "cancelado" || filtro === "todos";
  const etapaNaUrl = filtro === "andamento" ? "" : `etapa=${filtro}`;
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
                    "flex h-full w-full flex-col rounded-lg border px-3 py-2 text-left transition sm:py-3",
                    ativa
                      ? "border-primary bg-primary/10 ring-1 ring-primary"
                      : "border-border bg-card hover:border-primary/50 hover:bg-primary/5",
                  )}
                >
                  {/* número da etapa numa bolinha, no lugar do texto "Etapa 1": a ordem
                      das seis etapas fica à vista e a caixa ganha definição (rodada 11) */}
                  <span className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                        ativa ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                      )}
                    >
                      <span className="sr-only">Etapa </span>
                      {i + 1}
                    </span>
                    <span className={cn("text-xl font-semibold leading-6 tabular-nums", n > 0 ? "text-foreground" : "text-muted-foreground")}>
                      {n}
                    </span>
                  </span>
                  <span className="mt-1 text-sm font-semibold leading-5 text-foreground">{etapa.rotulo}</span>
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
            { valor: "concluido", rotulo: "Concluídos", contagem: contarEncerrados("concluido") },
            { valor: "cancelado", rotulo: "Cancelados", contagem: contarEncerrados("cancelado") },
            { valor: "todos", rotulo: "Todos", contagem: contarEncerrados("todos") },
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

      {encerrados && mostraEncerrados && (
        <ListaParcial
          mostrados={encerrados.mostrados}
          total={encerrados.total}
          oQue="pedidos concluídos ou cancelados"
          hrefTodos={`/pedido?${[etapaNaUrl, "encerrados=todos"].filter(Boolean).join("&")}`}
          hrefRecentes={todosEncerrados ? `/pedido${etapaNaUrl ? `?${etapaNaUrl}` : ""}` : undefined}
        />
      )}
    </div>
  );
}
