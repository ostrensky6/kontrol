import { notFound } from "next/navigation";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createClientUntyped } from "@/lib/supabase/server";
import { computarDemandaPlano } from "@/lib/costing/demanda";
import { gargalo, type Etapa } from "@/lib/costing/engine";
import { reservarEquipamentoDoPlano } from "@/lib/actions/planejamento";
import { comprarFaltasDoPlano } from "@/lib/actions/compras";
import { pode } from "@/lib/auth/permissao-efetiva";
import { FormComMensagem } from "@/components/pedido/FormComMensagem";
import { SubmitButton } from "@/components/common/SubmitButton";
import { PlanoAcoes } from "@/components/planejamento/PlanoAcoes";
import { PlanoContextoForm } from "@/components/planejamento/PlanoContextoForm";
import { PlanoItensEditor } from "@/components/planejamento/PlanoItensEditor";
import { ExcluirOuCancelarPlano } from "@/components/planejamento/PlanoGestao";
import {
  PlanejamentoConferenciaLotes,
  type PlanoConferenciaInsumo,
  type PlanoConferenciaRegistro,
} from "@/components/planejamento/PlanejamentoConferenciaLotes";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { HelpExample, HelpFormula, HelpLegend, HelpTip } from "@/components/common/HelpTip";
import { formatCurrency, formatDate, formatNumber as fmt } from "@/lib/formatters";
import { avaliarGestaoPlano, MENSAGEM_RESERVA_DESATUALIZADA } from "@/lib/planejamento/gestao";
import {
  loteSugeridoFefo,
  type LoteConferencia,
} from "@/lib/planejamento/conferencia-lotes";

export const dynamic = "force-dynamic";

const STATUS_RESERVA: Record<string, string> = {
  reservado: "reservado",
  parcial: "parcial",
  consumido: "retirado",
  liberado: "liberado",
  cancelado: "cancelado",
};

/** Reserva de lote em frascos é contada em frascos, não na unidade física (EST2-5). */
function unidadeReserva(
  lote: { modelo_quantidade?: string | null; conteudo_embalagem_snapshot?: number | null; unidade_fisica_snapshot?: string | null } | null | undefined,
  unidadeFisica: string | null | undefined,
) {
  if (lote?.modelo_quantidade === "EMBALAGEM_FECHADA") {
    const volume = lote.conteudo_embalagem_snapshot
      ? ` de ${fmt(lote.conteudo_embalagem_snapshot)} ${lote.unidade_fisica_snapshot ?? unidadeFisica ?? ""}`.trimEnd()
      : "";
    return `frasco(s)${volume}`;
  }
  return unidadeFisica ?? "";
}

function erroSchemaCache(error: { message?: string; code?: string } | null | undefined) {
  return Boolean(
    error &&
      (error.code === "PGRST204" ||
        error.message?.includes("schema cache") ||
        error.message?.includes("Could not find the")),
  );
}

async function consultarReservasPlano(supabase: Awaited<ReturnType<typeof createClientUntyped>>, planId: number) {
  const full = await supabase
    .from("reservas_estoque")
    .select("id, status, insumo_id, lote_id, quantidade, quantidade_consumida, lotes_estoque(codigo_lote, validade, validade_apos_abertura, modelo_quantidade, conteudo_embalagem_snapshot, unidade_fisica_snapshot)")
    .eq("planejamento_id", planId);

  if (!erroSchemaCache(full.error)) return full;

  return supabase
    .from("reservas_estoque")
    .select("id, status, insumo_id, quantidade")
    .eq("planejamento_id", planId);
}

export default async function PlanoDetalhe({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const planId = Number(id);
  const supabase = await createClient();
  const supabaseUntyped = await createClientUntyped();

  const { data: plano } = await supabase
    .from("planejamento")
    .select("*")
    .eq("id", planId)
    .single();
  if (!plano) notFound();

  const planoOperacional = plano as typeof plano & {
    data_inicio_prevista?: string | null;
    data_fim_prevista?: string | null;
    prioridade?: string | null;
    origem_planejamento?: string | null;
    planejado_por?: string | null;
    reservado_por?: string | null;
    validado_por?: string | null;
    validado_em?: string | null;
    reserva_desatualizada?: boolean | null;
  };

  const [
    { data: itens },
    { data: analises },
    { data: reservas },
    { data: projetos },
    { data: margemRealRows },
    { data: pedidosAtivos },
    podeGerir,
    podeExecutar,
    podeCriarPedido,
  ] = await Promise.all([
    supabase.from("planejamento_itens").select("id, codigo_analise, n_amostras, n_controles, repeticoes, perda_percentual").eq("planejamento_id", planId).order("id"),
    // Só análises ativas podem entrar em um plano novo; itens antigos continuam listados.
    supabase.from("analises").select("codigo, nome").eq("ativo", true).order("codigo"),
    consultarReservasPlano(supabaseUntyped, planId),
    supabase.from("projetos").select("id, nome").order("nome"),
    supabase.from("v_margem_real_planejamento").select("*").eq("planejamento_id", planId).limit(1),
    supabaseUntyped.from("pedidos_internos").select("id, status").eq("planejamento_id", planId).neq("status", "cancelado"),
    pode("planejamento.editar"),
    pode("planejamento.executar"),
    pode("pedido.criar"),
  ]);
  const margemReal = margemRealRows?.[0] ?? null;

  const codigosPlano = [...new Set((itens ?? []).map((item) => item.codigo_analise).filter(Boolean))];
  const { data: vinculosEquipamento } = codigosPlano.length > 0
    ? await supabaseUntyped
        .from("equipamento_analise")
        .select("codigo_analise, equipamento_id")
        .in("codigo_analise", codigosPlano)
    : { data: [] };
  const equipamentoIds = [...new Set((vinculosEquipamento ?? []).map((vinculo) => Number(vinculo.equipamento_id)).filter(Number.isFinite))];
  const { data: etapasPlano } = codigosPlano.length > 0
    ? await supabase.from("etapas").select("*").in("codigo_analise", codigosPlano)
    : { data: [] };
  const [{ data: unidadesEquipamento }, { data: reservasEquipamento }] = equipamentoIds.length > 0
    ? await Promise.all([
        supabaseUntyped
          .from("equipamento_unidades")
          .select("id, equipamento_id, codigo_patrimonio, status_operacional, ativo, equipamentos(nome)")
          .in("equipamento_id", equipamentoIds)
          .order("id"),
        supabaseUntyped
          .from("equipamento_reservas")
          .select("id, equipamento_unidade_id, planejamento_id, data_inicio, data_fim, status")
          .in("status", ["reservado", "em_uso"]),
      ])
    : [{ data: [] }, { data: [] }];

  const demanda = await computarDemandaPlano(supabase, planId);
  const demandaIds = demanda.map((d) => d.insumo_id);
  const [{ data: lotesConferencia }, { data: conferenciasPlanejamento }] = demandaIds.length > 0
    ? await Promise.all([
        supabase
          .from("lotes_estoque")
          .select("id, insumo_id, codigo_lote, validade, validade_apos_abertura, quantidade_atual, status")
          .in("insumo_id", demandaIds)
          .gt("quantidade_atual", 0),
        supabaseUntyped
          .from("planejamento_lote_conferencias")
          .select("id, insumo_id, lote_id, quantidade_conferida, status, justificativa, conferido_em")
          .eq("planejamento_id", planId)
          .order("conferido_em", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];

  const rs = (reservas ?? []) as Array<{
    id: number;
    status: string;
    insumo_id: number;
    lote_id: number | null;
    quantidade: number;
    quantidade_consumida?: number | null;
    lotes_estoque?: {
      codigo_lote: string | null;
      validade: string | null;
      validade_apos_abertura: string | null;
      modelo_quantidade?: string | null;
      conteudo_embalagem_snapshot?: number | null;
      unidade_fisica_snapshot?: string | null;
    } | null;
  }>;
  const reservasPorInsumo = new Map<number, typeof rs>();
  for (const reserva of rs) {
    const insumoId = Number(reserva.insumo_id);
    reservasPorInsumo.set(insumoId, [...(reservasPorInsumo.get(insumoId) ?? []), reserva]);
  }
  const status = rs.some((r) => r.status === "consumido")
    ? "Iniciado"
    : rs.some((r) => r.status === "reservado")
      ? "Reservado"
      : rs.length > 0
        ? "Liberado"
        : "Rascunho";
  const statusOperacional = (plano as unknown as { status_operacional?: string | null }).status_operacional;
  const statusLabel =
    statusOperacional === "concluido"
      ? "Concluído"
      : statusOperacional === "em_execucao"
        ? "Em execução"
        : statusOperacional === "cancelado"
          ? "Cancelado"
          : statusOperacional === "reservado"
            ? "Reservado"
            : status;
  const gestao = avaliarGestaoPlano({
    status: statusOperacional,
    reservas: rs,
    podeGerir,
    pedidosAtivos: (pedidosAtivos ?? []).map((pedido) => `#${pedido.id} (${String(pedido.status ?? "").replaceAll("_", " ")})`),
  });
  const reservaDesatualizada = statusOperacional === "reservado" && Boolean(planoOperacional.reserva_desatualizada);
  const temFalta = demanda.some((d) => d.falta > 0);
  const demandaTotal = demanda.reduce((sum, item) => sum + item.demanda, 0);
  const fisicoDisponivelTotal = demanda.reduce((sum, item) => sum + item.disponivel, 0);
  const faltaTotal = demanda.reduce((sum, item) => sum + item.falta, 0);
  const valorUsoEstimadoTotal = demanda.reduce((sum, item) => sum + item.custoEstimado, 0);
  const valorCompraEstimadoTotal = demanda.reduce((sum, item) => sum + item.valorCompraEstimado, 0);
  const reservadoTotal = rs
    .filter((r) => r.status === "reservado")
    .reduce((sum, item) => sum + Number(item.quantidade ?? 0), 0);
  const contextoCompleto = Boolean(
    plano.projeto_id
      && planoOperacional.data_inicio_prevista
      && planoOperacional.data_fim_prevista,
  );
  const baixaPendente = statusLabel === "Reservado";
  const inicioReservaPadrao = planoOperacional.data_inicio_prevista ? `${planoOperacional.data_inicio_prevista}T08:00` : "";
  const fimReservaPadrao = planoOperacional.data_fim_prevista ? `${planoOperacional.data_fim_prevista}T18:00` : "";
  const analisesPorEquipamento = new Map<number, string[]>();
  for (const vinculo of vinculosEquipamento ?? []) {
    const equipamentoId = Number(vinculo.equipamento_id);
    analisesPorEquipamento.set(equipamentoId, [...(analisesPorEquipamento.get(equipamentoId) ?? []), String(vinculo.codigo_analise)]);
  }
  const reservasPorUnidade = new Map<number, Array<{ id: number; planejamento_id: number | null; data_inicio: string; data_fim: string; status: string }>>();
  for (const reserva of reservasEquipamento ?? []) {
    const unidadeId = Number(reserva.equipamento_unidade_id);
    reservasPorUnidade.set(unidadeId, [...(reservasPorUnidade.get(unidadeId) ?? []), {
      id: Number(reserva.id),
      planejamento_id: reserva.planejamento_id == null ? null : Number(reserva.planejamento_id),
      data_inicio: String(reserva.data_inicio),
      data_fim: String(reserva.data_fim),
      status: String(reserva.status),
    }]);
  }
  const equipamentosCobertos = new Set<number>();
  for (const reserva of reservasEquipamento ?? []) {
    if (Number(reserva.planejamento_id) !== planId || !["reservado", "em_uso"].includes(String(reserva.status))) continue;
    const unidade = (unidadesEquipamento ?? []).find((item) => Number(item.id) === Number(reserva.equipamento_unidade_id));
    if (unidade?.ativo && !["em_manutencao", "calibracao_vencida", "inativo", "descartado"].includes(String(unidade.status_operacional))) {
      equipamentosCobertos.add(Number(unidade.equipamento_id));
    }
  }
  const temBloqueioEquipamentos = equipamentoIds.some((equipamentoId) => !equipamentosCobertos.has(equipamentoId));
  const capacidadePorAnalise = (itens ?? []).map((item) => {
    const g = gargalo(((etapasPlano ?? []).filter((etapa) => etapa.codigo_analise === item.codigo_analise)) as Etapa[]);
    const amostrasPlanejadas = (Number(item.n_amostras ?? 0) + Number(item.n_controles ?? 0))
      * Math.max(1, Number(item.repeticoes ?? 1))
      * (1 + Math.max(0, Number(item.perda_percentual ?? 0)) / 100);
    const capacidadeDia = Number(g.amostrasDia ?? 0);
    return {
      codigo: item.codigo_analise,
      amostrasPlanejadas,
      capacidadeDia,
      diasProjetados: capacidadeDia > 0 ? Math.ceil(amostrasPlanejadas / capacidadeDia) : null,
    };
  });
  const lotesPorInsumo = new Map<number, (LoteConferencia & { codigoLote: string | null })[]>();
  for (const lote of lotesConferencia ?? []) {
    const insumoId = Number(lote.insumo_id);
    if (!Number.isInteger(insumoId) || insumoId <= 0) continue;
    const linha = {
      id: Number(lote.id),
      insumoId,
      codigoLote: lote.codigo_lote ? String(lote.codigo_lote) : null,
      quantidadeAtual: Number(lote.quantidade_atual ?? 0),
      status: String(lote.status ?? ""),
      validade: lote.validade ? String(lote.validade) : null,
      validadeAposAbertura: lote.validade_apos_abertura ? String(lote.validade_apos_abertura) : null,
    };
    lotesPorInsumo.set(insumoId, [...(lotesPorInsumo.get(insumoId) ?? []), linha]);
  }
  const insumosConferencia: PlanoConferenciaInsumo[] = demanda.map((d) => {
    const loteReservado = (reservasPorInsumo.get(d.insumo_id) ?? []).find((reserva) =>
      reserva.status === "reservado" && reserva.lote_id != null,
    );
    const loteSugerido = loteSugeridoFefo(lotesPorInsumo.get(d.insumo_id) ?? []);
    const loteSugeridoCompleto = loteSugerido
      ? lotesPorInsumo.get(d.insumo_id)?.find((lote) => lote.id === loteSugerido.id) ?? null
      : null;
    const loteReferenciaId = loteReservado?.lote_id ?? loteSugerido?.id ?? null;

    return {
      insumoId: d.insumo_id,
      especificacao: d.especificacao,
      unidade: d.unidade,
      quantidadePrevista: d.demanda,
      loteSugeridoId: loteReferenciaId,
      loteSugeridoLabel: loteReservado?.lote_id
        ? `reservado #${loteReservado.lote_id}`
        : loteSugerido
        ? `FEFO #${loteSugerido.id}${loteSugeridoCompleto?.codigoLote ? ` · ${loteSugeridoCompleto.codigoLote}` : ""}`
        : null,
    };
  });
  const conferencias: PlanoConferenciaRegistro[] = (conferenciasPlanejamento ?? []).map((row) => ({
    id: Number(row.id),
    insumoId: Number(row.insumo_id),
    loteId: Number(row.lote_id),
    quantidadeConferida: Number(row.quantidade_conferida ?? 0),
    status: String(row.status ?? ""),
    justificativa: row.justificativa ? String(row.justificativa) : null,
  }));

  const inp = "rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-brand-700 dark:text-brand-300"; // §8.2: entrada em azul

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <Breadcrumbs items={[{ label: "Planejamento", href: "/planejamento" }, { label: plano.nome ?? `Plano #${planId}` }]} />
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight">{plano.nome}</h1>
              <HelpTip title="Planejamento de execução">
                <p>
                  Organiza a execução: projeto, período, análises, lotes reservados, faltas e
                  compras.
                </p>
                <p>
                  Pode nascer de um orçamento, mas é <b>independente</b> dele: o que vale para
                  reservar, comprar e dar baixa é o que está <b>neste plano</b>.
                </p>
              </HelpTip>
            </div>
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">
              {statusLabel}
            </span>
          </div>
          <div className="flex flex-wrap items-start gap-2" aria-label="Ações do plano" role="group">
            {gestao.podeEditar && (
              <a
                href="#editar"
                className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Editar
              </a>
            )}
            <ExcluirOuCancelarPlano
              planId={planId}
              nome={plano.nome ?? `Plano #${planId}`}
              gestao={{ acao: gestao.acao, bloqueado: gestao.acaoBloqueada, motivo: gestao.motivoAcao }}
              redirecionarPara="/planejamento"
            />
          </div>
        </div>
        {/* no celular fica logo abaixo da barra superior fixa (57px), em vez de passar por baixo dela */}
        <nav className="sticky top-[57px] z-10 mt-4 md:top-0 overflow-x-auto border-y border-border bg-background/95 py-2 backdrop-blur" aria-label="Etapas do planejamento">
          <div className="flex min-w-max gap-2">
            {[
              ["#contexto", "Resumo", statusLabel],
              ["#margem", "Margem", margemReal ? "calculada" : "sem orçamento"],
              ["#capacidade", "Capacidade", `${capacidadePorAnalise.length} análise(s)`],
              ["#analises", "Análises", `${itens?.length ?? 0} item(ns)`],
              ["#materiais", "Materiais", temFalta ? `${faltaTotal} em falta` : "disponível"],
              ["#acoes", "Próxima ação", statusLabel],
            ].map(([href, label, meta]) => (
              <a key={href} href={href} className="app-nav-level-3 rounded-md border border-primary/20 px-3 py-2 text-left text-xs text-brand-800 shadow-xs transition hover:border-primary/40 hover:text-brand-900 dark:text-brand-300">
                <span className="block font-semibold">{label}</span>
                <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground">{meta}</span>
              </a>
            ))}
          </div>
        </nav>
        {!contextoCompleto && (
          <p className="mt-3 flex items-center gap-1 rounded-lg border border-warning-strong/30 bg-warning-soft px-4 py-2 text-sm text-warning-strong">
            Informe projeto e período previsto antes de reservar insumos.
            <HelpTip title="Projeto e período">
              <p>
                A reserva de lotes e de equipamentos usa o <b>projeto e as datas</b> deste plano. Sem
                eles, não há como saber para quando separar o material.
              </p>
            </HelpTip>
          </p>
        )}
        {reservaDesatualizada && (
          <p role="status" className="mt-3 rounded-lg border border-warning-strong/30 bg-warning-soft px-4 py-2 text-sm font-medium text-warning-strong">
            {MENSAGEM_RESERVA_DESATUALIZADA}
          </p>
        )}
        {baixaPendente && !reservaDesatualizada && (
          <p className="mt-3 flex items-center gap-1 rounded-lg border border-warning-strong/30 bg-warning-soft px-4 py-2 text-sm text-warning-strong">
            Insumos reservados, ainda sem baixa.
            <HelpTip title="Reserva × baixa">
              <p>
                A <b>reserva</b> só separa os lotes. A <b>baixa</b>, saída definitiva do estoque,
                acontece ao clicar em <b>Iniciar</b>, quando a análise entra em execução.
              </p>
            </HelpTip>
          </p>
        )}
        {plano.data_alvo && (
          <p className="mt-1 text-sm text-muted-foreground">Data alvo: {formatDate(plano.data_alvo)}</p>
        )}

        {margemReal && (
          <section id="margem" className="mt-4 scroll-mt-24 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-1">
                  <h2 className="text-sm font-semibold">Margem prevista × realizada</h2>
                  <HelpTip title="Margem realizada (parcial)">
                    <p>
                      O realizado considera só os <b>insumos baixados</b> neste plano. Mão de obra,
                      equipamentos e overhead ainda não são apontados por execução.
                    </p>
                    <HelpFormula>margem parcial = receita orçada − insumos baixados</HelpFormula>
                    <HelpExample>Receita de R$ 10.000 e R$ 2.500 em insumos baixados → margem parcial de R$ 7.500 (75%).</HelpExample>
                  </HelpTip>
                </div>
              </div>
              <Link href={`/orcamento/${margemReal.orcamento_id}`} className="text-xs font-medium text-primary hover:underline">
                Abrir orçamento de origem
              </Link>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <IndicadorMargem titulo="Receita orçada" valor={Number(margemReal.receita_orcada ?? 0)} />
              <IndicadorMargem titulo="Custo técnico orçado" valor={Number(margemReal.custo_orcado ?? 0)} />
              <IndicadorMargem titulo="Insumos baixados (real)" valor={Number(margemReal.custo_real_insumos ?? 0)} />
              <IndicadorMargem
                titulo="Margem real parcial"
                valor={Number(margemReal.margem_real_parcial ?? 0)}
                detalhe={margemReal.margem_real_parcial_percentual == null ? "sem receita orçada" : `${Number(margemReal.margem_real_parcial_percentual).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da receita`}
                destaque
              />
            </div>
          </section>
        )}

        <section id="capacidade" className="mt-4 scroll-mt-24 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-1">
                <h2 className="text-sm font-semibold">Capacidade e equipamentos do plano</h2>
                <HelpTip title="Capacidade e equipamentos">
                  <p>
                    Os equipamentos vêm da ficha técnica de cada análise. O <b>prazo projetado</b>
                    divide as amostras planejadas pela capacidade por dia.
                  </p>
                  <HelpLegend
                    items={[
                      { tom: "info", rotulo: "disponível", texto: "pode ser reservado para o período (ou já está reservado neste plano)." },
                      { tom: "atencao", rotulo: "agenda ocupada", texto: "já reservado por outro plano." },
                      { tom: "critico", rotulo: "bloqueado", texto: "em manutenção, com calibração vencida ou inativo." },
                    ]}
                  />
                  <HelpExample>48 amostras planejadas e capacidade de 24/dia → 2 dias.</HelpExample>
                </HelpTip>
              </div>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              {codigosPlano.length} análise(s) · {unidadesEquipamento?.length ?? 0} unidade(s) candidata(s)
            </span>
          </div>
          {!contextoCompleto && (
            <p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning-strong">
              Defina projeto e período previsto para habilitar a reserva de equipamentos.
            </p>
          )}
          <div className="mt-3 space-y-3">
            {capacidadePorAnalise.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr><th className="px-3 py-2 text-left">Análise</th><th className="px-3 py-2 text-right">Amostras planejadas</th><th className="px-3 py-2 text-right">Capacidade/dia</th><th className="px-3 py-2 text-right">Prazo projetado</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {capacidadePorAnalise.map((capacidade, index) => (
                      <tr key={`${capacidade.codigo}-${index}`}>
                        <td className="px-3 py-2 font-medium">{capacidade.codigo}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(capacidade.amostrasPlanejadas)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${capacidade.capacidadeDia <= 0 ? "text-danger-strong" : ""}`}>{capacidade.capacidadeDia > 0 ? fmt(capacidade.capacidadeDia) : "não cadastrada"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{capacidade.diasProjetados == null ? "—" : `${capacidade.diasProjetados} dia(s)`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(unidadesEquipamento ?? []).map((unidade) => {
              const reservasAtivas = reservasPorUnidade.get(Number(unidade.id)) ?? [];
              const reservaDestePlano = reservasAtivas.find((reserva) => reserva.planejamento_id === planId);
              const bloqueada = !unidade.ativo || ["em_manutencao", "calibracao_vencida", "inativo", "descartado"].includes(String(unidade.status_operacional));
              const ocupadaPorOutro = reservasAtivas.some((reserva) => reserva.planejamento_id !== planId);
              const equipamento = Array.isArray(unidade.equipamentos) ? unidade.equipamentos[0] : unidade.equipamentos;
              return (
                <div key={unidade.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{equipamento?.nome ?? `Equipamento #${unidade.equipamento_id}`}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {unidade.codigo_patrimonio ?? `Unidade #${unidade.id}`} · análises: {(analisesPorEquipamento.get(Number(unidade.equipamento_id)) ?? []).join(", ") || "—"}
                      </p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${bloqueada ? "bg-danger-soft text-danger-strong" : ocupadaPorOutro ? "bg-warning-soft text-warning-strong" : "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300"}`}>
                      {bloqueada ? String(unidade.status_operacional).replaceAll("_", " ") : ocupadaPorOutro ? "agenda ocupada" : reservaDestePlano ? "reservado neste plano" : "disponível"}
                    </span>
                  </div>
                  {reservaDestePlano ? (
                    <p className="mt-3 text-xs text-muted-foreground">Reserva deste plano: {new Date(reservaDestePlano.data_inicio).toLocaleString("pt-BR")} → {new Date(reservaDestePlano.data_fim).toLocaleString("pt-BR")}</p>
                  ) : (
                    <FormComMensagem action={reservarEquipamentoDoPlano} className="mt-3 grid gap-2 md:grid-cols-4">
                      <input type="hidden" name="planejamento_id" value={planId} />
                      <input type="hidden" name="equipamento_unidade_id" value={unidade.id} />
                      <input name="data_inicio" type="datetime-local" defaultValue={inicioReservaPadrao} disabled={!contextoCompleto || bloqueada} className={`${inp} w-full`} />
                      <input name="data_fim" type="datetime-local" defaultValue={fimReservaPadrao} disabled={!contextoCompleto || bloqueada} className={`${inp} w-full`} />
                      <input name="observacao" placeholder="Observação (opcional)" disabled={!contextoCompleto || bloqueada} className={`${inp} w-full`} />
                      <SubmitButton disabled={!contextoCompleto || bloqueada || !podeExecutar} pendingLabel="Reservando…" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground">
                        Reservar unidade
                      </SubmitButton>
                    </FormComMensagem>
                  )}
                </div>
              );
            })}
            {equipamentoIds.length === 0 && (
              <p className="rounded-md bg-muted/50 px-3 py-3 text-sm text-muted-foreground">Nenhum equipamento está vinculado às análises deste plano. Vincule equipamentos na ficha técnica da análise para avaliar a capacidade operacional.</p>
            )}
          </div>
        </section>

        <section id="contexto" className="mt-6 scroll-mt-24 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-1">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Contexto operacional</h2>
                <HelpTip title="Contexto operacional">
                  <p>
                    Projeto, datas e responsável deste plano definem <b>para quando</b> reservar,
                    comprar e dar baixa. O orçamento de origem fica só como referência.
                  </p>
                </HelpTip>
              </div>
            </div>
            <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              <span>Planejado por: <b className="text-foreground">{planoOperacional.planejado_por ?? "—"}</b></span>
              <span>Reservado por: <b className="text-foreground">{planoOperacional.reservado_por ?? "—"}</b></span>
            </div>
          </div>

          <span id="editar" className="block scroll-mt-24" aria-hidden="true" />
          <PlanoContextoForm
            planId={planId}
            editavel={gestao.podeEditar}
            motivoSemEdicao={gestao.motivoSemEdicao}
            projetos={projetos ?? []}
            valores={{
              nome: plano.nome ?? "",
              projetoId: plano.projeto_id ?? null,
              prioridade: planoOperacional.prioridade ?? "normal",
              dataInicioPrevista: planoOperacional.data_inicio_prevista ?? "",
              dataFimPrevista: planoOperacional.data_fim_prevista ?? "",
              dataAlvo: plano.data_alvo ?? "",
              responsavel: plano.responsavel ?? "",
              observacao: plano.observacao ?? "",
            }}
          />
        </section>

        {/* itens do plano */}
        <section id="analises" className="mt-8 scroll-mt-24">
          <div className="flex items-center gap-1">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Análises do plano
            </h2>
            <HelpTip title="Quantidade planejada">
              <p>
                O consumo de insumos e o prazo usam as amostras mais os controles, multiplicados
                pelas <b>repetições</b> e acrescidos do <b>% de perda</b>.
              </p>
              <HelpExample>(10 amostras + 2 controles) × 2 repetições + 10% de perda = 26,4.</HelpExample>
            </HelpTip>
          </div>
          <PlanoItensEditor
            planId={planId}
            itens={(itens ?? []).map((item) => ({
              id: Number(item.id),
              codigo_analise: String(item.codigo_analise),
              n_amostras: item.n_amostras == null ? null : Number(item.n_amostras),
              n_controles: item.n_controles == null ? null : Number(item.n_controles),
              repeticoes: item.repeticoes == null ? null : Number(item.repeticoes),
              perda_percentual: item.perda_percentual == null ? null : Number(item.perda_percentual),
            }))}
            analises={(analises ?? []).map((a) => ({ codigo: a.codigo, nome: a.nome ?? null }))}
            editavel={gestao.podeEditar}
            motivoSemEdicao={gestao.motivoSemEdicao}
          />
        </section>

        {/* demanda */}
        <section id="materiais" className="mt-8 scroll-mt-24">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Insumos necessários {temFalta && <span className="text-warning-strong">· há faltas</span>}
              </h2>
              {temFalta && (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  Faltas viram pedido interno, não compra direta.
                  <HelpTip title="O que acontece com as faltas">
                    <p>
                      <b>Gerar pedido interno</b> cria um pedido com os itens em falta. Ele segue o
                      caminho normal: validação, compra e recebimento no estoque.
                    </p>
                    <p>A <b>Qtd. pedido</b> arredonda a falta para a embalagem ou a compra mínima do insumo.</p>
                  </HelpTip>
                </p>
              )}
            </div>
            {temFalta && podeCriarPedido && (
              <FormComMensagem action={comprarFaltasDoPlano} className="flex max-w-xs flex-col items-end gap-1">
                <input type="hidden" name="planejamento_id" value={planId} />
                <SubmitButton pendingLabel="Gerando…" className="app-action-compact bg-primary text-primary-foreground hover:bg-primary/90">
                  Gerar pedido interno
                </SubmitButton>
              </FormComMensagem>
            )}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs font-medium text-muted-foreground">Consumo previsto</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{fmt(demandaTotal)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatCurrency(valorUsoEstimadoTotal)} em uso previsto</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs font-medium text-muted-foreground">Físico disponível</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{fmt(fisicoDisponivelTotal)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Saldo livre agora, sem quarentena/vencidos</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs font-medium text-muted-foreground">Comprometido no plano</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{fmt(reservadoTotal)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Lotes já reservados para esta execução</p>
            </div>
            <div className={`rounded-lg border p-3 ${faltaTotal > 0 ? "border-warning-strong/30 bg-warning-soft" : "border-border bg-card"}`}>
              <p className="text-xs font-medium text-muted-foreground">Falta operacional</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${faltaTotal > 0 ? "text-warning-strong" : ""}`}>{fmt(faltaTotal)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatCurrency(valorCompraEstimadoTotal)} em pedido ajustado</p>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-transparent text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Insumo</th>
                  <th className="px-4 py-3 text-left">Un.</th>
                  <th className="px-4 py-3 text-right">Necessário</th>
                  <th className="px-4 py-3 text-right">Disponível</th>
                  <th className="px-4 py-3 text-left">Lote reservado</th>
                  <th className="px-4 py-3 text-right">Falta</th>
                  <th className="px-4 py-3 text-right">Qtd. pedido</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {demanda.map((d) => {
                  const reservasInsumo = reservasPorInsumo.get(d.insumo_id) ?? [];
                  const minimoCompra = d.quantidadeMinimaCompra ?? d.quantidadeEmbalagem;
                  return (
                    <tr key={d.insumo_id} className={d.falta > 0 ? "bg-warning-soft/60" : ""}>
                      <td className="px-4 py-2 max-w-sm truncate" title={d.especificacao}>{d.especificacao}</td>
                      <td className="px-4 py-2 text-muted-foreground">{d.unidade ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt(d.demanda)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{fmt(d.disponivel)}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {reservasInsumo.length > 0 ? (
                          <div className="space-y-1">
                            {reservasInsumo.map((reserva) => (
                              <div key={reserva.id}>
                                {reserva.lote_id ? (
                                  <Link href={`/estoque/lotes/${reserva.lote_id}`} className="font-medium text-primary hover:underline">
                                    #{reserva.lote_id}
                                  </Link>
                                ) : "sem lote"}
                                {" · "}
                                {fmt(reserva.quantidade)} {unidadeReserva(reserva.lotes_estoque, d.unidade)} · {STATUS_RESERVA[reserva.status] ?? reserva.status}
                              </div>
                            ))}
                          </div>
                        ) : "—"}
                      </td>
                      <td className={`px-4 py-2 text-right tabular-nums font-medium ${d.falta > 0 ? "text-warning-strong" : "text-muted-foreground/80"}`}>
                        {d.falta > 0 ? (
                          <div>
                            <span>{fmt(d.falta)}</span>
                            {d.quantidadeEmbalagem && d.quantidadeEmbalagem > 0 ? (
                              <p className="text-[11px] font-normal text-muted-foreground">
                                ≈ {Math.ceil(d.falta / d.quantidadeEmbalagem)} frasco(s) de {fmt(d.quantidadeEmbalagem)} {d.unidade ?? ""}
                              </p>
                            ) : null}
                          </div>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {d.quantidadeCompra > 0 ? (
                          <div>
                            <span className="font-medium">{fmt(d.quantidadeCompra)}</span>
                            {minimoCompra ? (
                              <p className="text-[11px] text-muted-foreground">
                                mín. {fmt(minimoCompra)} {d.unidade ?? ""}
                              </p>
                            ) : null}
                          </div>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {d.valorCompraEstimado > 0 ? (
                          <div>
                            <span className="font-medium">{formatCurrency(d.valorCompraEstimado)}</span>
                            <p className="text-[11px] text-muted-foreground">
                              {d.custoUnitario == null ? "sem custo un." : `${formatCurrency(d.custoUnitario)}/un.`}
                            </p>
                          </div>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
                {demanda.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground/80">
                      Adicione análises para calcular o consumo.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {baixaPendente && insumosConferencia.length > 0 && (
          <PlanejamentoConferenciaLotes
            planId={planId}
            insumos={insumosConferencia}
            conferencias={conferencias}
          />
        )}

        {/* ações */}
        <section id="acoes" className="mt-8 scroll-mt-24">
          <PlanoAcoes
            planId={planId}
            status={statusLabel}
            temFalta={temFalta}
            contextoCompleto={contextoCompleto}
            temBloqueioEquipamentos={temBloqueioEquipamentos}
            reservaDesatualizada={reservaDesatualizada}
            podeExecutar={podeExecutar}
            podeEditar={podeGerir}
          />
        </section>
      </main>
    </div>
  );
}

function IndicadorMargem({ titulo, valor, detalhe, destaque = false }: { titulo: string; valor: number; detalhe?: string; destaque?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${destaque ? "border-brand-300 bg-brand-50 dark:border-brand-800 dark:bg-brand-950/30" : "border-border bg-muted/30"}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(valor)}</p>
      {detalhe && <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p>}
    </div>
  );
}
