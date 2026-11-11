import Link from "next/link";
import { createClient, createClientUntyped } from "@/lib/supabase/server";
import { ExecutiveCharts } from "@/components/dashboard/ExecutiveCharts";
import { AguardandoVoce } from "@/components/dashboard/AguardandoVoce";
import { carregarPendencias } from "@/lib/pendencias/carregar";
import { formatCompactCurrency, formatNumber } from "@/lib/formatters";
import { minhasPermissoes, temNaLista } from "@/lib/auth/permissao-efetiva";
import type { PermissaoUsuario } from "@/lib/auth/permissions";
import { papelAtual } from "@/lib/auth/roles";
import { rotuloTipoNotificacao } from "@/lib/notifications/links";
import { HelpLegend, HelpTip } from "@/components/common/HelpTip";
import { PageShell } from "@/components/app/PageShell";
import { PageHeader } from "@/components/app/PageHeader";
import { SectionCard } from "@/components/app/SectionCard";
import { StatCard, type Tone } from "@/components/app/StatCard";
import { EmptyState } from "@/components/app/EmptyState";
import { HREF_SITUACAO_ESTOQUE } from "@/components/estoque/CartaoSituacaoEstoque";
import { textoResumoAlertas } from "@/lib/cadastros/painel-decisao";
import { hojeIso } from "@/lib/estoque/baixa";
import { contarSituacaoEstoque } from "@/lib/estoque/situacao-dados";
import { noGlossario } from "@/lib/glossario";

export const dynamic = "force-dynamic";

/** Mesma fonte e fórmula de Suprimentos (EST-7): v_previsao_suprimentos. Só para quem vê Compras sem ver Estoque. */
type Previsao = {
  insumo_id: number;
  especificacao: string | null;
  unidade: string | null;
  unidade_saldo?: string | null;
  disponivel: number | null;
  qtd_sugerida_compra: number | null;
  qtd_pedida_aberta: number | null;
  categoria_compra: string | null;
};

type PedidoCompra = {
  id: number;
  status: string;
  data_solicitacao: string | null;
  projeto: string | null;
};

type DashboardExecutivo = {
  orcamentos_rascunho: number | null;
  orcamentos_enviados: number | null;
  orcamentos_aprovados: number | null;
  orcamentos_perdidos: number | null;
  compras_abertas_valor: number | null;
  gasto_por_projeto_mes: unknown;
};

type Notificacao = {
  id: number;
  tipo: string;
  titulo: string;
  corpo: string | null;
};

const vazio = { data: null, count: null };

/** Indicador clicável: leva à lista que explica o número. */
function Indicador({
  href,
  label,
  value,
  detail,
  tone,
}: {
  href: string;
  label: string;
  value: React.ReactNode;
  detail: string;
  tone: Tone;
}) {
  return (
    <Link
      href={href}
      aria-label={`${label}: ${typeof value === "string" || typeof value === "number" ? value : ""}. ${detail}`}
      className="block rounded-lg transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <StatCard label={label} value={value} detail={detail} tone={tone} className="h-full" />
    </Link>
  );
}

/** Tom de cada tipo de linha em "Precisa de atenção hoje": vermelho só para o que bloqueia. */
const TOM_ATENCAO = {
  critico: "border-danger-strong/30 bg-danger-soft text-danger-strong",
  atencao: "border-warning-strong/30 bg-warning-soft text-warning-strong",
} as const;

type LinhaAtencao = {
  chave: string;
  selo: string;
  tom: keyof typeof TOM_ATENCAO;
  titulo: string;
  meta: string;
  href: string;
};

/** Quantas linhas a lista mostra: a página inicial precisa caber em uma tela. */
const LIMITE_ATENCAO = 8;

export default async function Home() {
  const supabase = await createClient();
  const [efetivas, papel] = await Promise.all([minhasPermissoes(), papelAtual()]);
  const pode = (chave: PermissaoUsuario) => temNaLista(efetivas, chave);

  // A página mostra só o que a pessoa pode abrir (a caixinha manda).
  const verEstoque = pode("estoque.ver");
  const verCompras = pode("compras.ver");
  const verOrcamentos = pode("orcamentos.visualizar");
  const verPlanejamento = pode("planejamento.ver");
  const verSuprimentos = verEstoque || verCompras;

  const [
    pendencias,
    situacaoEstoque,
    { data: previsaoRaw },
    { data: pedidosRaw },
    { data: dashboardRaw },
    { data: notificacoesRaw },
  ] = await Promise.all([
    // a função do banco mais lotes em quarentena, disputas, códigos e manutenção vencida (F8)
    carregarPendencias(),
    // D1: o Início mostra a contagem do painel único de situação, com as regras dele
    verEstoque ? createClientUntyped().then((semTipo) => contarSituacaoEstoque(semTipo, hojeIso())) : null,
    // quem vê Compras sem ver Estoque não abre o painel: fica com a sugestão de compra
    verCompras && !verEstoque
      ? supabase
          .from("v_previsao_suprimentos")
          .select("insumo_id, especificacao, unidade, unidade_saldo, disponivel, qtd_sugerida_compra, qtd_pedida_aberta, categoria_compra")
          .gt("qtd_sugerida_compra", 0)
          .order("qtd_sugerida_compra", { ascending: false })
      : vazio,
    verCompras
      ? supabase
          .from("pedidos_compra")
          .select("id, status, data_solicitacao, projeto")
          .in("status", ["solicitado", "aprovado", "enviado", "em_transito"])
          .order("criado_em", { ascending: false })
      : vazio,
    verOrcamentos || verCompras
      ? supabase
          .from("v_dashboard_executivo")
          .select("orcamentos_rascunho, orcamentos_enviados, orcamentos_aprovados, orcamentos_perdidos, compras_abertas_valor, gasto_por_projeto_mes")
          .maybeSingle()
      : vazio,
    supabase
      .from("v_minhas_notificacoes")
      .select("id, tipo, titulo, corpo")
      .eq("status", "nao_lida")
      .order("criado_em", { ascending: false })
      .limit(5),
  ]);

  const previsao = ((previsaoRaw ?? []) as Previsao[]).filter((p) => Number(p.qtd_sugerida_compra ?? 0) > 0);
  const pedidos = (pedidosRaw ?? []) as PedidoCompra[];
  const dashboard = dashboardRaw as DashboardExecutivo | null;
  // avisos gravados pelo banco ainda trazem palavras antigas: o glossário (10.5) vale aqui também
  const notificacoes = ((notificacoesRaw ?? []) as Notificacao[]).map((n) => ({ ...n, titulo: noGlossario(n.titulo), corpo: noGlossario(n.corpo) }));

  const comprarAgora = previsao
    .map((p) => ({
      titulo: p.especificacao ?? `Insumo #${p.insumo_id}`,
      meta: `disp. ${formatNumber(p.disponivel)} · já pedido ${formatNumber(p.qtd_pedida_aberta)} · sugerido ${formatNumber(p.qtd_sugerida_compra)} ${p.unidade_saldo ?? p.unidade ?? ""}`.trim(),
      peso: (p.categoria_compra === "critico" ? 1e9 : 0) + Number(p.qtd_sugerida_compra ?? 0),
    }))
    .sort((a, b) => b.peso - a.peso);

  const gastos =
    verCompras && Array.isArray(dashboard?.gasto_por_projeto_mes)
      ? (dashboard.gasto_por_projeto_mes as Array<{ mes: string; projeto: string; gasto: number }>)
      : verCompras
        ? []
        : null;
  const funil = verOrcamentos
    ? [
        { status: "Rascunho", total: Number(dashboard?.orcamentos_rascunho ?? 0) },
        { status: "Enviado", total: Number(dashboard?.orcamentos_enviados ?? 0) },
        { status: "Aprovado", total: Number(dashboard?.orcamentos_aprovados ?? 0) },
        { status: "Perdido", total: Number(dashboard?.orcamentos_perdidos ?? 0) },
      ]
    : null;

  // No máximo 5 indicadores, sem repetição, cada um levando à sua lista.
  const indicadores: Array<{ href: string; label: string; value: React.ReactNode; detail: string; tone: Tone }> = [];
  if (situacaoEstoque) {
    // um número só para o estoque, o mesmo do painel; leitura incompleta aparece como "sem dado"
    const resumo = situacaoEstoque.resumo;
    indicadores.push({
      href: HREF_SITUACAO_ESTOQUE,
      label: "Situação do estoque",
      value: resumo ? resumo.urgentes + resumo.atencao : "sem dado",
      detail: resumo ? `${textoResumoAlertas(resumo)} · abre o painel` : "a leitura do estoque não respondeu por inteiro",
      tone: !resumo ? "neutral" : resumo.urgentes ? "danger" : resumo.atencao ? "warning" : "neutral",
    });
  } else if (verCompras) {
    indicadores.push({
      href: "/compras",
      label: "Repor",
      value: comprarAgora.length,
      detail: "insumos com compra sugerida pela previsão",
      tone: comprarAgora.length ? "warning" : "neutral",
    });
  }
  if (verCompras) {
    indicadores.push({
      href: "/compras",
      label: "Compras abertas",
      value: pedidos.length,
      detail: `${formatCompactCurrency(dashboard?.compras_abertas_valor)} estimados em andamento`,
      tone: pedidos.length ? "info" : "neutral",
    });
  }
  if (verOrcamentos) {
    const enviados = Number(dashboard?.orcamentos_enviados ?? 0);
    indicadores.push({
      href: "/orcamento/emitidos",
      label: "Propostas com o cliente",
      value: enviados,
      detail: "enviadas aguardando resposta",
      tone: enviados ? "info" : "neutral",
    });
  }

  // Uma lista só, do mais grave para o menos grave. Cada assunto aparece uma vez:
  // o número fica no indicador e os itens ficam aqui (D12 da revisão de 11/11).
  // Com Estoque, as linhas são as do painel de situação e abrem a ficha ou o lote (D1).
  const atencao: LinhaAtencao[] = situacaoEstoque
    ? situacaoEstoque.linhas.map((linha) => ({
        chave: linha.chave,
        selo: linha.tom === "vermelho" ? "Urgente" : "Atenção",
        tom: linha.tom === "vermelho" ? "critico" : "atencao",
        titulo: linha.titulo,
        meta: `${linha.quadro} · ${linha.detalhe}`,
        href: linha.href,
      }))
    : comprarAgora.map((c, i) => ({
        chave: `comprar-${i}-${c.titulo}`,
        selo: "Repor",
        tom: "atencao",
        titulo: c.titulo,
        meta: c.meta,
        href: "/compras",
      }));
  const hrefListaCompleta = situacaoEstoque ? HREF_SITUACAO_ESTOQUE : "/compras";

  // Gráficos só para quem decide, e só o gráfico que tem dado (8.1 da revisão).
  const decide = efetivas.admin || papel === "gestor" || papel === "supervisor";
  const gastosComDado = decide && gastos && gastos.length > 0 ? gastos : null;
  const funilComDado = decide && funil && funil.some((f) => f.total > 0) ? funil : null;

  // Sem os atalhos, o aviso de "nenhuma área" olha as mesmas áreas que eles cobriam.
  const semModulos =
    !verSuprimentos &&
    !verOrcamentos &&
    !verPlanejamento &&
    !efetivas.admin &&
    !pode("pedido.ver") &&
    !pode("analises.ver") &&
    !pode("cadastros.ver") &&
    !pode("auditoria.visualizar");

  return (
    <PageShell>
      <PageHeader
        title="Início"
        help={
          <HelpTip title="Início">
            <p>O que espera por você e o que precisa de compra, baixa ou revisão hoje.</p>
            <p>
              Mostra só as áreas que o seu usuário pode abrir. Em <b>Aguardando você</b> ficam as
              etapas que dependem da sua ação; cada número leva à lista que o explica.
            </p>
            <HelpLegend
              items={[
                { tom: "critico", rotulo: "Urgente", texto: "zero no sistema, lote vencido, risco de falta ou compra atrasada." },
                { tom: "atencao", rotulo: "Atenção", texto: "abaixo do mínimo, lote vencendo ou aberto fora da ordem." },
                { tom: "info", rotulo: "Em andamento", texto: "compras abertas ou propostas com o cliente." },
              ]}
            />
          </HelpTip>
        }
      />

      <AguardandoVoce pendencias={pendencias} />

      {indicadores.length > 0 && (
        <section aria-label="Indicadores" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {indicadores.slice(0, 5).map((indicador) => (
            <Indicador key={indicador.label} {...indicador} />
          ))}
        </section>
      )}

      {semModulos && (
        <EmptyState
          title="Nenhuma área liberada para o seu usuário"
          description="Peça ao administrador para liberar as áreas de que você precisa em Usuários. Os avisos para você continuam em Notificações."
        />
      )}

      <div className={notificacoes.length > 0 && verSuprimentos ? "grid gap-4 lg:grid-cols-3" : "grid gap-4"}>
        {verSuprimentos && (
          <SectionCard
            title="Precisa de atenção hoje"
            className={notificacoes.length > 0 ? "lg:col-span-2" : undefined}
            contentClassName="p-3 sm:p-3"
          >
            {atencao.length > 0 ? (
              <>
                <ul aria-label="Precisa de atenção hoje" className="divide-y divide-border/60">
                  {atencao.slice(0, LIMITE_ATENCAO).map((linha) => (
                    <li key={linha.chave}>
                      <Link
                        href={linha.href}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-2 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        <span
                          className={`w-28 shrink-0 rounded-full border px-2 py-0.5 text-center text-xs font-medium ${TOM_ATENCAO[linha.tom]}`}
                        >
                          {linha.selo}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={linha.titulo}>
                          {linha.titulo}
                        </span>
                        <span className="text-xs text-muted-foreground">{linha.meta}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {atencao.length > LIMITE_ATENCAO && (
                  <p className="px-2 pt-2 text-xs text-muted-foreground">
                    E mais {atencao.length - LIMITE_ATENCAO}.{" "}
                    <Link href={hrefListaCompleta} className="font-medium text-primary hover:underline">
                      Ver a lista completa
                    </Link>
                  </p>
                )}
              </>
            ) : (
              <p className="px-2 py-1 text-sm text-muted-foreground">
                {situacaoEstoque && !situacaoEstoque.resumo
                  ? "Sem dado: a leitura do estoque não respondeu por inteiro. Abra a Situação do estoque para conferir."
                  : situacaoEstoque
                    ? "Nada urgente nem de atenção no estoque agora."
                    : "Nenhuma compra sugerida agora."}
              </p>
            )}
          </SectionCard>
        )}

        {notificacoes.length > 0 && (
          <SectionCard
            title="Notificações"
            actions={
              <Link href="/notificacoes" className="text-xs font-semibold text-primary hover:underline">
                Ver todas
              </Link>
            }
            contentClassName="p-3 sm:p-3"
          >
            <ul className="space-y-2">
              {notificacoes.map((n) => (
                <li key={n.id} className="rounded-md bg-muted/50 px-3 py-2">
                  <div className="truncate text-sm font-medium text-foreground" title={n.titulo}>
                    {n.titulo}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {rotuloTipoNotificacao(n.tipo)}
                    {n.corpo ? ` · ${n.corpo}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>

      {(gastosComDado !== null || funilComDado !== null) && (
        <SectionCard title="Dashboard executivo">
          <ExecutiveCharts gastos={gastosComDado} funil={funilComDado} />
        </SectionCard>
      )}
    </PageShell>
  );
}
