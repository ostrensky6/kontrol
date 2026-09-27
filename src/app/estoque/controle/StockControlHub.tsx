"use client";

import { useActionState, useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  Archive,
  Bell,
  Boxes,
  CalendarClock,
  Check,
  ExternalLink,
  Search,
  ShieldAlert,
  ShoppingCart,
  TrendingDown,
  XCircle,
  Layers,
  BarChart3,
  ListFilter,
  Info,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatNumber, formatDate } from "@/lib/formatters";
import { arquivarNotificacao, marcarNotificacaoLida } from "@/lib/actions/notificacoes";
import { gerarPedidoReposicaoInsumo } from "@/lib/actions/pedidos-internos";
import type { FormState } from "@/lib/actions/cadastros";
import { LoteAcoes } from "@/components/estoque/LoteAcoes";
import { DarBaixaDialog } from "@/components/estoque/DarBaixaDialog";
import type { LoteBaixa, ModeloQuantidadeLote } from "@/lib/estoque/baixa";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

type Notificacao = {
  id: number;
  tipo: string;
  titulo: string;
  corpo: string | null;
  entidade_tipo: string | null;
  entidade_id: number | null;
  papel_destino: string | null;
  canal: string;
  status: string;
  criado_em: string;
};

type EstoqueSaldo = {
  insumo_id: number | null;
  especificacao: string | null;
  unidade: string | null;
  /** 0127: "frasco(s) de 100 mL" para insumo contado em frascos. */
  unidade_saldo?: string | null;
  em_maos: number | null;
  em_quarentena: number | null;
  reservado: number | null;
  disponivel: number | null;
  ponto_reposicao: number | null;
  estoque_seguranca: number | null;
  categoria_compra: string | null;
};

type AlertaEstoque = {
  tipo: string | null;
  insumo_id: number | null;
  especificacao: string | null;
  validade: string | null;
  valor: number | null;
  referencia: number | null;
};

type LoteDbRow = {
  id: number;
  insumoId: number;
  estornoDiretoPermitido?: boolean;
  codigoLote: string;
  validade: string;
  validadeIso: string | null;
  quantidadeAtual: number;
  reservado: number;
  modeloQuantidade: ModeloQuantidadeLote;
  status: string;
  statusLabel: string;
  especificacao: string;
  unidade: string;
  vencido: boolean;
  critico: boolean;
};

type AlertTone = "red" | "amber" | "blue" | "emerald" | "slate";

type StockControlHubProps = {
  initialNotifications: Notificacao[];
  saldo: EstoqueSaldo[];
  alertas: AlertaEstoque[];
  lotes: LoteDbRow[];
  podeAceitar: boolean;
  podeGerir: boolean;
  podeCorrigir?: boolean;
  podeBaixar?: boolean;
};

export function StockControlHub({
  initialNotifications,
  saldo,
  alertas,
  lotes,
  podeAceitar,
  podeGerir,
  podeCorrigir,
  podeBaixar,
}: StockControlHubProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAlertType, setSelectedAlertType] = useState<string>("todos");
  const [selectedCriticidade, setSelectedCriticidade] = useState<string>("todos");
  const [selectedStatus, setSelectedStatus] = useState<string>("todos");
  const [viewMode, setViewMode] = useState<"insumo" | "lote" | "grafica">("insumo");
  const [isPending, startTransition] = useTransition();

  // Lotes com saldo por insumo, para o "Dar baixa" do cartão (FEFO no diálogo).
  const lotesBaixaPorInsumo = useMemo(() => {
    const mapa = new Map<number, LoteBaixa[]>();
    for (const lote of lotes) {
      if (!(lote.quantidadeAtual > 0)) continue;
      const lista = mapa.get(lote.insumoId) ?? [];
      lista.push({
        id: lote.id,
        codigoLote: lote.codigoLote,
        validade: lote.validadeIso,
        quantidadeAtual: lote.quantidadeAtual,
        reservado: lote.reservado,
        modeloQuantidade: lote.modeloQuantidade,
        status: lote.status,
      });
      mapa.set(lote.insumoId, lista);
    }
    return mapa;
  }, [lotes]);

  // Mapear notificações por insumo_id ou por texto correspondente
  const getNotificationsForInsumo = useCallback((insumoId: number | null, especificacao: string | null) => {
    return initialNotifications.filter((n) => {
      if (insumoId != null && n.entidade_tipo === "insumo" && n.entidade_id === insumoId) return true;
      if (especificacao && n.titulo.toLowerCase().includes(especificacao.toLowerCase())) return true;
      return false;
    });
  }, [initialNotifications]);

  // Enriquecer dados dos insumos com status de estoque e alertas correspondentes
  const items = useMemo(() => {
    return saldo.map((s) => {
      const itemAlerts = alertas.filter((a) => a.insumo_id === s.insumo_id);
      const itemNotifications = getNotificationsForInsumo(s.insumo_id, s.especificacao);

      let status = "ok";
      let statusLabel = "Estoque OK";
      let tone: AlertTone = "slate";
      const badges: { label: string; tone: AlertTone }[] = [];

      const disponivel = s.disponivel ?? 0;
      const pontoReposicao = s.ponto_reposicao ?? 0;
      const emQuarentena = s.em_quarentena ?? 0;

      const temVencido = itemAlerts.some((a) => a.tipo === "vencido");
      const temSemValidade = itemAlerts.some((a) => a.tipo === "sem_validade");
      const temVencendo = itemAlerts.some((a) => a.tipo === "vencimento");

      if (temVencido) badges.push({ label: "Lote vencido", tone: "red" });
      if (temSemValidade) badges.push({ label: "Sem validade", tone: "red" });
      if (disponivel <= 0) badges.push({ label: "Sem estoque", tone: "red" });
      if (disponivel <= pontoReposicao && pontoReposicao > 0) badges.push({ label: "Reposição", tone: "amber" });
      if (temVencendo) badges.push({ label: "Vence em breve", tone: "amber" });
      if (emQuarentena > 0) badges.push({ label: "Quarentena", tone: "emerald" });

      if (temVencido) {
        status = "vencido";
        statusLabel = "Lote Vencido";
        tone = "red";
      } else if (temSemValidade) {
        status = "sem_validade";
        statusLabel = "Sem Validade";
        tone = "red";
      } else if (disponivel <= 0) {
        status = "sem_disponivel";
        statusLabel = "Sem Estoque";
        tone = "red";
      } else if (disponivel <= pontoReposicao && pontoReposicao > 0) {
        status = "reposicao";
        statusLabel = "Reposição";
        tone = "amber";
      } else if (temVencendo) {
        status = "vencendo";
        statusLabel = "Vence em breve";
        tone = "amber";
      } else if (emQuarentena > 0) {
        status = "quarentena";
        statusLabel = "Em Quarentena";
        tone = "emerald";
      }

      return {
        ...s,
        // Saldo, reserva e ponto vêm na unidade do saldo (frascos no modelo atual).
        unidade: s.unidade_saldo ?? s.unidade,
        status,
        statusLabel,
        tone,
        badges: badges.length ? badges : [{ label: statusLabel, tone: "slate" }],
        alerts: itemAlerts,
        notifications: itemNotifications,
      };
    });
  }, [saldo, alertas, getNotificationsForInsumo]);

  // Filtragem dos itens de Insumo
  const filteredInsumos = useMemo(() => {
    return items.filter((item) => {
      if (
        searchTerm &&
        !item.especificacao?.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !(item.insumo_id != null && item.insumo_id.toString().includes(searchTerm))
      ) {
        return false;
      }

      if (selectedAlertType !== "todos") {
        if (selectedAlertType === "reposicao" && item.status !== "reposicao") return false;
        if (selectedAlertType === "vencido_vencendo" && item.status !== "vencido" && item.status !== "vencendo") return false;
        if (selectedAlertType === "quarentena" && item.status !== "quarentena") return false;
        if (selectedAlertType === "sem_disponivel" && item.status !== "sem_disponivel") return false;
        if (selectedAlertType === "ok" && item.status !== "ok") return false;
      }

      if (selectedCriticidade !== "todos") {
        if (item.categoria_compra !== selectedCriticidade) return false;
      }

      if (selectedStatus !== "todos") {
        if (selectedStatus === "pendentes" && !item.notifications.some((n) => n.status === "nao_lida")) return false;
        if (selectedStatus === "tratadas" && item.notifications.length > 0 && !item.notifications.every((n) => n.status === "lida")) return false;
        if (selectedStatus === "sem_notificacao" && item.notifications.length > 0) return false;
      }

      return true;
    });
  }, [items, searchTerm, selectedAlertType, selectedCriticidade, selectedStatus]);

  // Filtragem dos Lotes
  const filteredLotes = useMemo(() => {
    return lotes.filter((lote) => {
      // Busca por nome do insumo do lote ou código do lote
      if (
        searchTerm &&
        !lote.especificacao?.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !lote.codigoLote?.toLowerCase().includes(searchTerm.toLowerCase())
      ) {
        return false;
      }

      // Filtro de situação física do lote
      if (selectedAlertType !== "todos") {
        if (selectedAlertType === "quarentena" && lote.status !== "quarentena") return false;
        if (selectedAlertType === "vencido_vencendo" && !lote.vencido) return false;
      }

      return true;
    });
  }, [lotes, searchTerm, selectedAlertType]);

  // Contagem para gráficos e KPIs baseados em TODOS os itens
  const totalInsumos = items.length;
  const countSemEstoque = items.filter((i) => i.status === "sem_disponivel").length;
  const countRepor = items.filter((i) => i.status === "reposicao").length;
  const countVencidos = items.filter((i) => i.status === "vencido" || i.status === "sem_validade").length;
  const countVencendo = items.filter((i) => i.status === "vencendo").length;
  const countQuarentena = items.filter((i) => i.status === "quarentena").length;
  const countOk = items.filter((i) => i.status === "ok").length;
  const saudePct = totalInsumos > 0 ? Math.round((countOk / totalInsumos) * 100) : 0;

  const chartData = [
    { name: "Sem Estoque", value: countSemEstoque, color: "#ef4444" },
    { name: "Vencido/Sem Val.", value: countVencidos, color: "#f87171" },
    { name: "Reposição", value: countRepor, color: "#f59e0b" },
    { name: "Vencendo", value: countVencendo, color: "#fbbf24" },
    { name: "Quarentena", value: countQuarentena, color: "#10b981" },
    { name: "Estoque OK", value: countOk, color: "#3b82f6" },
  ].filter((d) => d.value > 0);

  const TONE_CLASSES: Record<AlertTone, string> = {
    red: "border-danger-strong/30 bg-danger-soft text-danger-strong",
    amber: "border-warning-strong/30 bg-warning-soft text-warning-strong",
    blue: "border-info-strong/30 bg-info-soft text-info-strong",
    emerald: "border-success-strong/30 bg-success-soft text-success-strong",
    slate: "border-border bg-muted/50 text-foreground",
  };

  return (
    <div className="grid gap-5">
      {/* 1. Visão Geral / KPIs Visuais */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Sem Estoque</p>
            <span className="rounded-md bg-danger-soft p-1 text-danger-strong">
              <XCircle className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold tracking-tight text-danger-strong">{countSemEstoque}</p>
          <p className="mt-1 text-xs text-muted-foreground">sem saldo disponível</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Reposição</p>
            <span className="rounded-md bg-warning-soft p-1 text-warning-strong">
              <TrendingDown className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold tracking-tight text-warning-strong">{countRepor}</p>
          <p className="mt-1 text-xs text-muted-foreground">abaixo do ponto</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Validade</p>
            <span className="rounded-md bg-warning-soft p-1 text-warning-strong">
              <CalendarClock className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold tracking-tight text-warning-strong">{countVencidos + countVencendo}</p>
          <p className="mt-1 text-xs text-muted-foreground">{countVencidos} lotes vencidos</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Quarentena</p>
            <span className="rounded-md bg-success-soft p-1 text-success-strong">
              <Boxes className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold tracking-tight text-success-strong">{countQuarentena}</p>
          <p className="mt-1 text-xs text-muted-foreground">lotes aguardando aceite</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Saúde do Estoque</p>
              <HelpTip title="Saúde do estoque">
                <p>
                  Percentual de insumos <b>sem nenhum alerta</b>. Cada insumo conta uma vez, na
                  situação mais grave: vencido, sem estoque, repor, vence em breve ou quarentena.
                </p>
                <HelpExample>40 insumos, 30 sem alerta → saúde de 75%.</HelpExample>
              </HelpTip>
            </div>
            <span className="rounded-md bg-info-soft p-1 text-info-strong">
              <ShieldAlert className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold tracking-tight text-info-strong">{saudePct}%</p>
          <p className="mt-1 text-xs text-muted-foreground">dos itens sem alertas</p>
        </div>
      </section>

      {/* 2. Filtros e Visualizações */}
      <section className="grid gap-4 lg:grid-cols-[2.2fr_0.8fr]">
        {/* Barra de Filtros / Seleções */}
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <ListFilter className="h-4 w-4 text-muted-foreground/80" /> Seleções do Estoque
              </h2>
              {/* Toggles de Visualização */}
              <div className="inline-flex rounded-md shadow-sm" role="group">
                <button
                  onClick={() => setViewMode("insumo")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-l-md border ${
                    viewMode === "insumo"
                      ? "bg-brand-50 border-brand-200 text-brand-700 dark:bg-brand-950/20 dark:border-brand-900 dark:text-brand-300"
                      : "bg-card border-border text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <span className="flex items-center gap-1"><Boxes className="h-3.5 w-3.5" /> Por Insumo</span>
                </button>
                <button
                  onClick={() => setViewMode("lote")}
                  className={`px-3 py-1.5 text-xs font-medium border-t border-b ${
                    viewMode === "lote"
                      ? "bg-brand-50 border-brand-200 text-brand-700 dark:bg-brand-950/20 dark:border-brand-900 dark:text-brand-300"
                      : "bg-card border-border text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <span className="flex items-center gap-1"><Layers className="h-3.5 w-3.5" /> Por Lote</span>
                </button>
                <button
                  onClick={() => setViewMode("grafica")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-r-md border ${
                    viewMode === "grafica"
                      ? "bg-brand-50 border-brand-200 text-brand-700 dark:bg-brand-950/20 dark:border-brand-900 dark:text-brand-300"
                      : "bg-card border-border text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <span className="flex items-center gap-1"><BarChart3 className="h-3.5 w-3.5" /> Visão Gráfica</span>
                </button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4 2xl:grid-cols-5">
              {/* Busca */}
              <div className="relative">
                <label className="block text-xs font-medium text-muted-foreground mb-1">Buscar Insumo</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground/80" />
                  <input
                    type="text"
                    placeholder={viewMode === "lote" ? "Insumo ou lote..." : "Insumo ou ID..."}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full rounded-md border border-border bg-card pl-8 pr-3 py-1.5 text-sm outline-none focus:border-brand-500"
                  />
                </div>
              </div>

              {/* Alerta de Estoque */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Estado Físico / Alerta</label>
                <select
                  value={selectedAlertType}
                  onChange={(e) => setSelectedAlertType(e.target.value)}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500"
                  disabled={viewMode === "grafica"}
                >
                  <option value="todos">Todos</option>
                  <option value="sem_disponivel">Sem Estoque</option>
                  <option value="reposicao">Abaixo do Ponto (Repor)</option>
                  <option value="vencido_vencendo">Vencido/Vencendo</option>
                  <option value="quarentena">Em Quarentena</option>
                  <option value="ok" disabled={viewMode === "lote"}>Estoque OK</option>
                </select>
              </div>

              {/* Criticidade */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Criticidade</label>
                <select
                  value={selectedCriticidade}
                  onChange={(e) => setSelectedCriticidade(e.target.value)}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500"
                  disabled={viewMode === "lote" || viewMode === "grafica"}
                >
                  <option value="todos">Todas</option>
                  <option value="critico">Crítico</option>
                  <option value="normal">Normal</option>
                </select>
              </div>

              {/* Status Notificações */}
              <div>
                <div className="mb-1 flex items-center gap-1">
                  <label className="block text-xs font-medium text-muted-foreground">Estado Administrativo</label>
                  <HelpTip title="Estado administrativo">
                    <p>
                      Filtra pelos avisos do sistema ligados ao insumo. <b>Pendentes</b> ainda não foram
                      tratados; tratadas já foram marcadas em “Tratar alerta”.
                    </p>
                  </HelpTip>
                </div>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500"
                  disabled={viewMode === "lote" || viewMode === "grafica"}
                >
                  <option value="todos">Todos</option>
                  <option value="pendentes">Não Tratadas (Pendentes)</option>
                  <option value="tratadas">Tratadas / Lidas</option>
                  <option value="sem_notificacao">Sem Log In-App</option>
                </select>
              </div>
            </div>
          </div>

          <div className="mt-4 flex justify-between items-center text-xs text-muted-foreground">
            <span>
              {viewMode === "lote"
                ? `Mostrando ${filteredLotes.length} de ${lotes.length} lotes filtrados`
                : `Mostrando ${filteredInsumos.length} de ${totalInsumos} insumos filtrados`}
            </span>
            {(searchTerm || selectedAlertType !== "todos" || selectedCriticidade !== "todos" || selectedStatus !== "todos") && (
              <button
                onClick={() => {
                  setSearchTerm("");
                  setSelectedAlertType("todos");
                  setSelectedCriticidade("todos");
                  setSelectedStatus("todos");
                }}
                className="text-brand-600 hover:text-brand-700 font-semibold"
              >
                Limpar filtros
              </button>
            )}
          </div>
        </div>

        {/* Mini gráfico */}
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase text-muted-foreground">Alertas Ativos</h3>
            <p className="text-[10px] text-muted-foreground/80">Total de eventos operacionais críticos</p>
          </div>
          <div className="h-24 mt-2">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 2, right: 2, left: -32, bottom: 2 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.2} />
                  <XAxis dataKey="name" fontSize={8} tickLine={false} axisLine={false} />
                  <YAxis fontSize={8} tickLine={false} axisLine={false} />
                  <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                    {chartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground/80">
                Nenhum alerta ativo
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 3. Renderização Principal Baseada no ViewMode */}
      <section className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
        {/* CABEÇALHO DO MÓDULO */}
        <div className="border-b border-border/70 px-5 py-4 bg-muted/50 flex justify-between items-center">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {viewMode === "insumo" && "Visão Consolidada de Insumos"}
              {viewMode === "lote" && "Listagem Detalhada por Lote"}
              {viewMode === "grafica" && "Relatórios de Estoque"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {viewMode === "insumo" && "Saldos do insumo consolidado, ideais para análise de compras e reposições."}
              {viewMode === "lote" && "Lotes individuais ativos, validades e ações físicas de movimentação."}
              {viewMode === "grafica" && "Análise macro do estoque por faixas, alertas e status físico."}
            </p>
          </div>
          <span className="text-xs text-muted-foreground/80">
            {viewMode === "insumo" && `${filteredInsumos.length} reagentes`}
            {viewMode === "lote" && `${filteredLotes.length} lotes`}
          </span>
        </div>

        {/* VISÃO 1: POR INSUMO */}
        {viewMode === "insumo" && (
          filteredInsumos.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Nenhum insumo ou alerta localizado com os filtros selecionados.
            </div>
          ) : (
            <div className="divide-y divide-border/70">
              {filteredInsumos.map((item, idx) => {
                const disponivel = item.disponivel ?? 0;
                const emMaos = item.em_maos ?? 0;
                const ponto = item.ponto_reposicao ?? 0;
                const pctMin = pontoPct(disponivel, ponto);

                return (
                  <article key={item.insumo_id ?? idx} className="p-5 hover:bg-muted/40 transition-colors">
                    <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr_1.5fr]">
                      {/* Nome do Insumo e Detalhes */}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-mono text-muted-foreground/80 bg-muted px-1.5 py-0.5 rounded">
                            #{item.insumo_id ?? "—"}
                          </span>
                          {item.badges.slice(0, 3).map((badge) => (
                            <span key={badge.label} className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${TONE_CLASSES[badge.tone as AlertTone]}`}>
                              {badge.label}
                            </span>
                          ))}
                          {item.categoria_compra === "critico" && (
                            <span className="rounded-md border border-danger-strong/30 bg-danger-soft text-danger-strong px-2 py-0.5 text-[10px] font-bold">
                              Crítico
                            </span>
                          )}
                        </div>
                        <h3 className="mt-2 text-base font-semibold text-foreground truncate" title={item.especificacao ?? ""}>
                          {item.especificacao ?? "Insumo sem nome"}
                        </h3>
                        <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-4">
                          <span>Em mãos: {formatNumber(emMaos)} {item.unidade}</span>
                          <span>Reservado: {formatNumber(item.reservado)} {item.unidade}</span>
                        </div>
                      </div>

                      {/* Progresso do Saldo */}
                      <div className="flex flex-col justify-center">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-muted-foreground font-medium">Disponível: {formatNumber(disponivel)} {item.unidade}</span>
                          {ponto > 0 && (
                            <span className="text-muted-foreground/80">Ponto: {formatNumber(ponto)} {item.unidade}</span>
                          )}
                        </div>
                        <div className="h-2 w-full rounded-full bg-muted relative">
                          <div
                            className={`h-full rounded-full ${
                              item.status === "sem_disponivel"
                                ? "bg-danger-strong"
                                : item.status === "reposicao"
                                  ? "bg-warning-strong"
                                  : "bg-brand-600"
                            }`}
                            style={{ width: `${Math.min(100, pctMin)}%` }}
                          />
                        </div>
                        {ponto > 0 && disponivel <= ponto && (
                          <p className="mt-1.5 text-[11px] text-warning-strong font-medium flex items-center gap-1">
                            <TrendingDown className="h-3 w-3" /> Reposição sugerida: {formatNumber(ponto - disponivel)} {item.unidade}
                          </p>
                        )}
                      </div>

                      {/* Logs e Ações */}
                      <div className="flex flex-col justify-between gap-3">
                        <div className="space-y-1.5">
                          {item.notifications.length > 0 ? (
                            item.notifications.map((n) => (
                              <div key={n.id} className="rounded-md border border-border/70 bg-muted/50 p-2 text-xs">
                                <div className="flex justify-between items-start gap-2">
                                  <span className="font-semibold text-foreground flex items-center gap-1">
                                    <Bell className="h-3 w-3 text-muted-foreground/80" /> {n.titulo}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground/80 shrink-0">
                                    {formatDate(n.criado_em)}
                                  </span>
                                </div>
                                {n.corpo && <p className="text-muted-foreground mt-0.5 line-clamp-1">{n.corpo}</p>}
                                
                                <div className="mt-2 flex justify-end gap-2">
                                  {n.status === "nao_lida" && (
                                    <form
                                      onSubmit={(e) => {
                                        e.preventDefault();
                                        const formData = new FormData();
                                        formData.append("notificacao_id", n.id.toString());
                                        startTransition(async () => {
                                          await marcarNotificacaoLida(formData);
                                        });
                                      }}
                                    >
                                      <button type="submit" disabled={isPending} className="inline-flex items-center gap-0.5 text-[10px] text-success-strong font-semibold hover:text-success-strong">
                                        <Check className="h-3 w-3" /> Tratar Alerta
                                      </button>
                                    </form>
                                  )}
                                  <form
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      const formData = new FormData();
                                      formData.append("notificacao_id", n.id.toString());
                                      startTransition(async () => {
                                        await arquivarNotificacao(formData);
                                      });
                                    }}
                                  >
                                    <button type="submit" disabled={isPending} className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground font-semibold hover:text-foreground">
                                      <Archive className="h-3 w-3" /> Arquivar
                                    </button>
                                  </form>
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-muted-foreground/80 italic">Sem notificações ativas.</p>
                          )}

                          {item.alerts.filter((a) => a.tipo === "vencido" || a.tipo === "vencimento").map((a) => (
                            <div key={`${item.insumo_id ?? item.especificacao}-${a.tipo}-${a.validade ?? "sem-data"}`} className="text-xs text-danger-strong font-semibold flex items-center gap-1.5">
                              <CalendarClock className="h-3.5 w-3.5" />
                              {a.tipo === "vencido" ? "Vencido em:" : "Vence em:"} {a.validade ? formatDate(a.validade) : "sem data"}
                            </div>
                          ))}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 justify-end mt-auto">
                          <Link
                            href={`/cadastros/insumos?focus=${item.insumo_id ?? ""}`}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground shadow-sm hover:bg-muted/50"
                          >
                            <ExternalLink className="h-3.5 w-3.5" /> Ficha
                          </Link>
                          <DarBaixaDialog
                            lotes={lotesBaixaPorInsumo.get(Number(item.insumo_id)) ?? []}
                            unidade={item.unidade ?? ""}
                            especificacao={item.especificacao ?? undefined}
                            triggerClassName="inline-flex items-center gap-1 rounded-md border border-danger-strong/30 bg-card px-2.5 py-1.5 text-xs font-semibold text-danger-strong shadow-sm hover:bg-danger-soft"
                          />
                          {ponto > 0 && disponivel <= ponto && (
                            <GerarPedidoInsumoButton insumoId={item.insumo_id} />
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )
        )}

        {/* VISÃO 2: POR LOTE */}
        {viewMode === "lote" && (
          filteredLotes.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Nenhum lote localizado com os filtros selecionados.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-muted-foreground">
                <thead className="bg-muted/50 text-xs uppercase text-foreground">
                  <tr>
                    <th scope="col" className="px-6 py-3">Insumo / Especificação</th>
                    <th scope="col" className="px-6 py-3">Código do Lote</th>
                    <th scope="col" className="px-6 py-3">Status</th>
                    <th scope="col" className="px-6 py-3">Quantidade</th>
                    <th scope="col" className="px-6 py-3">Validade</th>
                    <th scope="col" className="px-6 py-3 text-right">Ações Operacionais (Auditoria)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {filteredLotes.map((lote) => (
                    <tr key={lote.id} className="bg-card hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4 font-semibold text-foreground">
                        {lote.especificacao}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs">
                        <Link href={`/estoque/lotes/${lote.id}`} className="text-primary hover:underline">
                          {lote.codigoLote}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                          lote.status === "quarentena"
                            ? "bg-info-soft text-info-strong"
                            : lote.status === "bloqueado"
                              ? "bg-danger-soft text-danger-strong"
                              : "bg-success-soft text-success-strong"
                        }`}>
                          {lote.statusLabel}
                        </span>
                      </td>
                      <td className="px-6 py-4 tabular-nums">
                        {formatNumber(lote.quantidadeAtual)} {lote.unidade}
                      </td>
                      <td className={`px-6 py-4 text-xs font-semibold ${lote.vencido ? "text-danger-strong" : ""}`}>
                        {formatDate(lote.validade)}
                        {lote.vencido && " (Vencido)"}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <LoteAcoes
                          loteId={lote.id}
                          codigoLote={lote.codigoLote}
                          status={lote.status}
                          quantidadeAtual={lote.quantidadeAtual}
                          unidade={lote.unidade}
                          critico={lote.critico}
                          validade={lote.validadeIso}
                          vencido={lote.vencido}
                          reservado={lote.reservado}
                          modeloQuantidade={lote.modeloQuantidade}
                          estornoDiretoPermitido={lote.estornoDiretoPermitido}
                          podeAceitar={podeAceitar}
                          podeGerir={podeGerir}
                          podeCorrigir={podeCorrigir}
                          podeBaixar={podeBaixar}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* VISÃO 3: VISÃO GRÁFICA */}
        {viewMode === "grafica" && (
          <div className="grid gap-5 p-5 md:grid-cols-2">
            {/* Gráfico 1: Situação Geral */}
            <div className="rounded-lg border border-border/70 bg-muted/50 p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Situação Física dos Insumos</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={85}
                      paddingAngle={3}
                    >
                      {chartData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [value, "Insumos"]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                {chartData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                    <span className="text-muted-foreground truncate">{d.name}:</span>
                    <span className="font-bold tabular-nums ml-auto">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Quadro de Resumo de Cobertura */}
            <div className="rounded-lg border border-border/70 bg-muted/50 p-5 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-2">
                  <Info className="h-4 w-4 text-muted-foreground/80" /> Notas Operacionais de Controle
                </h3>
                <ul className="space-y-3 text-xs text-muted-foreground mt-4 leading-relaxed">
                  <li className="flex items-start gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-danger-strong mt-1.5 shrink-0" />
                    <span><b>{countSemEstoque} insumos sem saldo disponível</b>: abra pedidos de reposição.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-warning-strong mt-1.5 shrink-0" />
                    <span><b>{countRepor} insumos abaixo do ponto de reposição</b>: podem faltar para os planos.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-success-strong mt-1.5 shrink-0" />
                    <span><b>{countQuarentena} insumos com lotes aguardando aceite</b>: libere em <i>Por Lote</i>.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-info-strong mt-1.5 shrink-0" />
                    <span><b>{countOk} insumos sem alertas</b>.</span>
                  </li>
                </ul>
              </div>

              <div className="mt-6 pt-4 border-t border-border/60">
                <div className="flex justify-between items-center text-xs font-semibold text-foreground mb-1">
                  <span>Taxa de Saúde de Estoque:</span>
                  <span>{saudePct}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-brand-600"
                    style={{ width: `${saudePct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function pontoPct(disponivel: number, ponto: number) {
  if (ponto <= 0) return disponivel > 0 ? 100 : 0;
  return (disponivel / ponto) * 100;
}

function GerarPedidoInsumoButton({ insumoId }: { insumoId: number | null }) {
  const [state, action, pending] = useActionState<FormState & { pedidoId?: number }, FormData>(
    gerarPedidoReposicaoInsumo,
    { ok: false },
  );

  if (!insumoId) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={action} {...formularioSemPerda(state)}>
        <input type="hidden" name="insumo_id" value={insumoId} />
        <button
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-500 disabled:opacity-60"
        >
          <ShoppingCart className="h-3.5 w-3.5" />
          {pending ? "Abrindo..." : "Abrir pedido"}
        </button>
      </form>
      {state.message && (
        <p className={`max-w-52 text-right text-[10px] ${state.ok ? "text-brand-700 dark:text-brand-300" : "text-danger-strong"}`}>
          {state.message}
          {state.ok && state.pedidoId ? (
            <>
              {" "}
              <Link href={`/pedido/${state.pedidoId}`} className="font-semibold underline">
                Ver pedido
              </Link>
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}
