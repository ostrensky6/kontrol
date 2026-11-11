"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Archive, Bell, CalendarClock, Check, Search } from "lucide-react";

import { FiltroChips, gravarFiltroNaUrl } from "@/components/common/FiltroChips";
import { HelpTip } from "@/components/common/HelpTip";
import { DarBaixaDialog } from "@/components/estoque/DarBaixaDialog";
import { LotesTable } from "@/components/estoque/EstoqueTables";
import { GerarPedidoInsumoButton } from "@/components/pedido/GerarPedidoInsumoButton";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { arquivarNotificacao, marcarNotificacaoLida } from "@/lib/actions/notificacoes";
import type { InsumoControle, LoteControle } from "@/lib/estoque/controle-dados";
import {
  FILTROS_AVISO,
  FILTROS_CRITICIDADE,
  FILTROS_LOTE_CONTROLE,
  FILTROS_SITUACAO_CONTROLE,
  FILTRO_SITUACAO_CONTROLE_PADRAO,
  filtrarInsumosDoControle,
  loteAtendeControle,
  type AvisoInsumo,
  type FiltroAviso,
  type FiltroCriticidade,
  type FiltroLoteControle,
  type FiltroSituacaoControle,
} from "@/lib/estoque/controle-estoque";
import { hrefFichaInsumo } from "@/lib/estoque/ficha-insumo-rota";
import { META_SINAL, ROTULO_ESTOQUE_OK } from "@/lib/estoque/situacao-insumo";
import { formatDate, formatNumber } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const POR_VEZ = 10;

const TOM_SELO = {
  red: "border-danger-strong/30 bg-danger-soft text-danger-strong",
  amber: "border-warning-strong/30 bg-warning-soft text-warning-strong",
  ok: "border-success-strong/30 bg-success-soft text-success-strong",
} as const;

/**
 * Visão por insumo da Situação do estoque: cada insumo com os seus sinais, os
 * avisos do sistema e as ações (tratar o aviso, dar baixa, pedir reposição).
 * Era a visão "por insumo" do Controle de Estoque; voltou na organização de
 * 11/11/2026 com as palavras do glossário. Abre em "Precisa de atenção".
 */
export function ControlePorInsumo({
  insumos,
  avisosLidos,
  situacaoInicial,
  podeBaixar,
  podeCriarPedido,
}: {
  insumos: InsumoControle[];
  /** false = a leitura dos avisos falhou: o filtro de avisos fica desligado */
  avisosLidos: boolean;
  situacaoInicial: FiltroSituacaoControle;
  /** permissão "estoque.movimentar" */
  podeBaixar: boolean;
  /** permissão "pedido.criar" */
  podeCriarPedido: boolean;
}) {
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState<FiltroSituacaoControle>(situacaoInicial);
  const [criticidade, setCriticidade] = useState<FiltroCriticidade>("todos");
  const [avisos, setAvisos] = useState<FiltroAviso>("todos");
  const [mostrando, setMostrando] = useState(POR_VEZ);

  const filtrados = useMemo(
    () => filtrarInsumosDoControle(insumos, { busca, situacao, criticidade, avisos: avisosLidos ? avisos : "todos" }),
    [insumos, busca, situacao, criticidade, avisos, avisosLidos],
  );
  const visiveis = filtrados.slice(0, mostrando);
  const filtrando = Boolean(busca) || situacao !== FILTRO_SITUACAO_CONTROLE_PADRAO || criticidade !== "todos" || avisos !== "todos";

  function mudarSituacao(valor: FiltroSituacaoControle) {
    setSituacao(valor);
    setMostrando(POR_VEZ);
    gravarFiltroNaUrl("alerta", valor, FILTRO_SITUACAO_CONTROLE_PADRAO);
  }

  function limpar() {
    setBusca("");
    setCriticidade("todos");
    setAvisos("todos");
    mudarSituacao(FILTRO_SITUACAO_CONTROLE_PADRAO);
  }

  return (
    <section
      id="controle-por-insumo"
      aria-labelledby="controle-por-insumo-titulo"
      className="scroll-mt-24 rounded-lg border border-border bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-1">
          <h2 id="controle-por-insumo-titulo" className="text-base font-semibold">
            Tratar por insumo
          </h2>
          <HelpTip title="Tratar por insumo">
            <p>
              Cada insumo aparece com todos os seus sinais (sem estoque, repor, vencido…) e com os avisos que o
              sistema gerou para ele.
            </p>
            <p>
              <b>Tratar alerta</b> marca o aviso como lido para você. <b>Arquivar</b> tira o aviso da sua lista.
              Nenhum dos dois muda o estoque: para isso use <b>Dar baixa</b> ou <b>Pedir reposição</b>.
            </p>
          </HelpTip>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="controle-contagem" role="status">
          {filtrados.length} de {insumos.length} insumos
        </p>
      </div>

      <div className="grid gap-3 border-b border-border px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Buscar insumo
          <span className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setMostrando(POR_VEZ);
              }}
              placeholder="Nome ou número"
              className="pl-8"
            />
          </span>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Situação
          <Select value={situacao} onChange={(e) => mudarSituacao(e.target.value as FiltroSituacaoControle)}>
            {FILTROS_SITUACAO_CONTROLE.map((opcao) => (
              <option key={opcao.valor} value={opcao.valor}>
                {opcao.rotulo}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Criticidade
          <Select
            value={criticidade}
            onChange={(e) => {
              setCriticidade(e.target.value as FiltroCriticidade);
              setMostrando(POR_VEZ);
            }}
          >
            {FILTROS_CRITICIDADE.map((opcao) => (
              <option key={opcao.valor} value={opcao.valor}>
                {opcao.rotulo}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Avisos do sistema
          <Select
            value={avisosLidos ? avisos : "todos"}
            disabled={!avisosLidos}
            onChange={(e) => {
              setAvisos(e.target.value as FiltroAviso);
              setMostrando(POR_VEZ);
            }}
          >
            {FILTROS_AVISO.map((opcao) => (
              <option key={opcao.valor} value={opcao.valor}>
                {opcao.rotulo}
              </option>
            ))}
          </Select>
          {!avisosLidos && <span className="text-warning-strong">sem dado: os avisos não foram lidos agora</span>}
        </label>
      </div>

      {filtrados.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          {insumos.length === 0
            ? "Nenhum insumo ativo."
            : situacao === "atencao" && !busca && criticidade === "todos" && avisos === "todos"
              ? "Nenhum insumo precisa de atenção agora. Para ver a lista inteira, escolha Todos em Situação."
              : "Nenhum insumo com estes filtros."}
        </p>
      ) : (
        <ul aria-label="Insumos" className="divide-y divide-border">
          {visiveis.map((insumo) => (
            <li key={insumo.insumoId}>
              <CartaoInsumo insumo={insumo} podeBaixar={podeBaixar} podeCriarPedido={podeCriarPedido} />
            </li>
          ))}
        </ul>
      )}

      {(filtrados.length > mostrando || filtrando) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-sm">
          {filtrados.length > mostrando ? (
            <button
              type="button"
              onClick={() => setMostrando((n) => n + POR_VEZ)}
              className="font-medium text-primary hover:underline"
            >
              Mostrar mais {Math.min(POR_VEZ, filtrados.length - mostrando)} (de {filtrados.length})
            </button>
          ) : (
            <span />
          )}
          {filtrando && (
            <button type="button" onClick={limpar} className="font-medium text-primary hover:underline">
              Limpar filtros da lista
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function CartaoInsumo({
  insumo,
  podeBaixar,
  podeCriarPedido,
}: {
  insumo: InsumoControle;
  podeBaixar: boolean;
  podeCriarPedido: boolean;
}) {
  const ficha = hrefFichaInsumo(insumo.insumoId) ?? "/estoque";
  const pct = insumo.minimo > 0 ? Math.min(100, (insumo.disponivel / insumo.minimo) * 100) : insumo.disponivel > 0 ? 100 : 0;
  return (
    <article aria-label={insumo.especificacao} className="grid gap-4 px-4 py-4 lg:grid-cols-[1.4fr_1fr_1.6fr]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          {insumo.sinais.length > 0 ? (
            insumo.sinais.map((sinal) => (
              <span key={sinal} className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", TOM_SELO[META_SINAL[sinal].tom])}>
                {META_SINAL[sinal].rotulo}
              </span>
            ))
          ) : (
            <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", TOM_SELO.ok)}>{ROTULO_ESTOQUE_OK}</span>
          )}
          {insumo.categoriaCompra === "critico" && (
            <span className="rounded-full border border-danger-strong/30 px-2 py-0.5 text-xs font-semibold text-danger-strong">
              Crítico
            </span>
          )}
        </div>
        <h3 className="mt-2 truncate text-sm font-semibold" title={insumo.especificacao}>
          <Link href={ficha} className="hover:text-primary hover:underline">
            {insumo.especificacao}
          </Link>
        </h3>
        <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
          <span>
            Em mãos: {formatNumber(insumo.emMaos)} {insumo.unidade}
          </span>
          <span>
            Reservado: {formatNumber(insumo.reservado)} {insumo.unidade}
          </span>
        </p>
      </div>

      <div className="flex flex-col justify-center">
        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-foreground">
            Disponível: {formatNumber(insumo.disponivel)} {insumo.unidade}
          </span>
          {insumo.minimo > 0 && (
            <span className="text-muted-foreground">
              Mínimo: {formatNumber(insumo.minimo)} {insumo.unidade}
            </span>
          )}
        </div>
        <div className="h-2 w-full rounded-full bg-muted" aria-hidden="true">
          <div
            className={cn(
              "h-full rounded-full",
              insumo.sinais.includes("sem_disponivel")
                ? "bg-danger-strong"
                : insumo.sinais.includes("reposicao")
                  ? "bg-warning-strong"
                  : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        {insumo.sugerido > 0 && (
          <p className="mt-1.5 text-xs font-medium text-warning-strong">
            Pedir cerca de {formatNumber(insumo.sugerido)} {insumo.unidade}
          </p>
        )}
        {insumo.validades.map((v, i) => (
          <p key={`${v.tipo}-${v.validade ?? "sem-data"}-${i}`} className="mt-1 flex items-center gap-1.5 text-xs font-medium text-danger-strong">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            {v.tipo === "vencido" ? "Lote vencido em" : "Lote vence em"} {v.validade ? formatDate(v.validade) : "data não informada"}
          </p>
        ))}
      </div>

      <div className="flex flex-col justify-between gap-3">
        {insumo.avisos.length > 0 ? (
          <ul aria-label={`Avisos de ${insumo.especificacao}`} className="space-y-1.5">
            {insumo.avisos.map((aviso) => (
              <li key={aviso.id}>
                <AvisoDoInsumo aviso={aviso} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Sem aviso do sistema para este insumo.</p>
        )}
        <div className="flex flex-wrap items-start justify-end gap-2">
          <Link
            href={ficha}
            className="inline-flex min-h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted/50"
          >
            Abrir a ficha
          </Link>
          {podeBaixar && (
            <DarBaixaDialog
              lotes={insumo.lotesBaixa}
              unidade={insumo.unidadeFisica || insumo.unidade}
              especificacao={insumo.especificacao}
              mostrarIndisponivel={false}
            />
          )}
          {podeCriarPedido && insumo.sugerido > 0 && <GerarPedidoInsumoButton insumoId={insumo.insumoId} />}
        </div>
      </div>
    </article>
  );
}

/** Um aviso do sistema, com "Tratar alerta" (marca como lido) e "Arquivar". */
function AvisoDoInsumo({ aviso }: { aviso: AvisoInsumo }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const pendenteDeTratar = aviso.status === "nao_lida";

  function executar(acao: (dados: FormData) => Promise<void>) {
    const dados = new FormData();
    dados.set("notificacao_id", String(aviso.id));
    setErro(null);
    iniciar(async () => {
      try {
        await acao(dados);
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível gravar agora.");
      }
    });
  }

  return (
    <div className="rounded-md border border-border bg-muted/40 p-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1 font-semibold text-foreground">
          <Bell className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate" title={aviso.titulo}>
            {aviso.titulo}
          </span>
        </span>
        <span className="shrink-0 text-muted-foreground">{aviso.criadoEm ? formatDate(aviso.criadoEm) : ""}</span>
      </div>
      {aviso.corpo && <p className="mt-0.5 line-clamp-2 text-muted-foreground">{aviso.corpo}</p>}
      <div className="mt-1.5 flex flex-wrap items-center justify-end gap-3">
        <span
          className={cn(
            "mr-auto rounded-full px-2 py-0.5 font-medium",
            pendenteDeTratar ? "bg-warning-soft text-warning-strong" : "bg-success-soft text-success-strong",
          )}
        >
          {pendenteDeTratar ? "Pendente" : "Tratado"}
        </span>
        {pendenteDeTratar && (
          <button
            type="button"
            disabled={pendente}
            onClick={() => executar(marcarNotificacaoLida)}
            className="inline-flex min-h-8 items-center gap-1 font-semibold text-success-strong hover:underline disabled:opacity-60"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" /> Tratar alerta
          </button>
        )}
        <button
          type="button"
          disabled={pendente}
          onClick={() => executar(arquivarNotificacao)}
          className="inline-flex min-h-8 items-center gap-1 font-semibold text-muted-foreground hover:text-foreground hover:underline disabled:opacity-60"
        >
          <Archive className="h-3.5 w-3.5" aria-hidden="true" /> Arquivar
        </button>
      </div>
      {erro && (
        <p role="alert" className="mt-1 text-danger-strong">
          {erro}
        </p>
      )}
    </div>
  );
}

/**
 * Visão por lote da Situação do estoque: os lotes com saldo, filtrados pela
 * validade, com as ações de cada lote (dar baixa, bloquear, descartar). Usa a
 * mesma tabela de Estoque → Saldo e lotes; abre em "Precisa de atenção".
 */
export function ControlePorLote({
  lotes,
  podeAceitar,
  podeGerir,
  podeCorrigir,
  podeBaixar,
  responsavelPadrao,
}: {
  lotes: LoteControle[];
  podeAceitar: boolean;
  podeGerir: boolean;
  podeCorrigir: boolean;
  podeBaixar: boolean;
  responsavelPadrao: string;
}) {
  const [filtro, setFiltro] = useState<FiltroLoteControle>("atencao");
  const opcoes = useMemo(
    () =>
      FILTROS_LOTE_CONTROLE.map((opcao) => ({
        valor: opcao.valor,
        rotulo: opcao.rotulo,
        contagem: lotes.filter((lote) => loteAtendeControle(lote, opcao.valor)).length,
        tom: opcao.valor === "vencido" ? ("red" as const) : opcao.valor === "todos" ? ("neutro" as const) : ("amber" as const),
      })),
    [lotes],
  );
  const filtrados = useMemo(() => lotes.filter((lote) => loteAtendeControle(lote, filtro)), [lotes, filtro]);

  return (
    <section aria-labelledby="controle-por-lote-titulo" className="space-y-3">
      <div className="flex items-center gap-1">
        <h2 id="controle-por-lote-titulo" className="text-base font-semibold">
          Lotes que pedem atenção
        </h2>
        <HelpTip title="Lotes que pedem atenção">
          <p>
            Lotes com saldo, pela validade: <b>vencido</b>, <b>vence em breve</b> (dentro da janela de aviso) ou{" "}
            <b>sem validade</b> informada.
          </p>
          <p>
            As ações de cada lote (dar baixa, bloquear, descartar) ficam registradas com quem fez e quando. Clique
            no número do lote para ver a etiqueta e o histórico.
          </p>
        </HelpTip>
      </div>
      <FiltroChips opcoes={opcoes} valor={filtro} aoMudar={setFiltro} rotulo="Filtrar lotes pela validade" />
      {filtrados.length === 0 && filtro === "atencao" ? (
        <p className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-sm">
          Nenhum lote vencido, vencendo ou sem validade agora. Para ver todos os lotes, escolha Todos.
        </p>
      ) : (
        <LotesTable
          rows={filtrados}
          podeAceitar={podeAceitar}
          podeGerir={podeGerir}
          podeCorrigir={podeCorrigir}
          podeBaixar={podeBaixar}
          responsavelPadrao={responsavelPadrao}
        />
      )}
    </section>
  );
}
