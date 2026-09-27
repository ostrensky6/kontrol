import Link from "next/link";
import { ArrowRight, Bell, ClipboardList, PackageSearch, ShoppingCart, TestTube2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ExecutiveCharts } from "@/components/dashboard/ExecutiveCharts";
import { AguardandoVoce } from "@/components/dashboard/AguardandoVoce";
import { montarPendencias } from "@/components/dashboard/aguardando";
import { formatCompactCurrency, formatDate, formatNumber } from "@/lib/formatters";
import { minhasPermissoes, temNaLista } from "@/lib/auth/permissao-efetiva";
import type { PermissaoUsuario } from "@/lib/auth/permissions";
import { rotuloTipoNotificacao } from "@/lib/notifications/links";
import { statusInfo } from "@/components/app/status";
import { HelpLegend, HelpTip } from "@/components/common/HelpTip";
import { PageShell } from "@/components/app/PageShell";
import { PageHeader } from "@/components/app/PageHeader";
import { SectionCard } from "@/components/app/SectionCard";
import { StatCard, type Tone } from "@/components/app/StatCard";
import { EmptyState } from "@/components/app/EmptyState";

export const dynamic = "force-dynamic";

type EstoqueSaldo = {
  insumo_id: number;
  especificacao: string | null;
  disponivel: number | null;
};

type AlertaEstoque = {
  tipo: string;
  insumo_id: number;
  especificacao: string | null;
  validade: string | null;
  valor: number | null;
};

/** Mesma fonte e fórmula de Suprimentos (EST-7): v_previsao_suprimentos. */
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

function AcaoRapida({
  href,
  titulo,
  desc,
  icon: Icon,
}: {
  href: string;
  titulo: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Link
      href={href}
      className="group flex min-w-52 flex-1 items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-xs transition-colors hover:bg-muted/50"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{titulo}</span>
        <span className="block truncate text-xs text-muted-foreground">{desc}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

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

function JornadaCard({
  titulo,
  subtitulo,
  ajuda,
  passos,
}: {
  titulo: string;
  subtitulo: string;
  ajuda?: React.ReactNode;
  passos: Array<{ titulo: string; desc: string; href: string }>;
}) {
  return (
    <SectionCard
      title={titulo}
      description={
        ajuda ? (
          <span className="flex items-center gap-1">
            {subtitulo}
            <HelpTip title={`Jornada de ${titulo.toLowerCase()}`}>{ajuda}</HelpTip>
          </span>
        ) : (
          subtitulo
        )
      }
      contentClassName="grid gap-2"
    >
      {passos.map((p, i) => (
        <Link
          key={p.href}
          href={p.href}
          className="group flex gap-3 rounded-md border border-border/70 p-3 transition-colors hover:bg-muted/50"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
            {i + 1}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground group-hover:text-primary">
              {p.titulo}
            </span>
            <span className="block text-xs leading-snug text-muted-foreground">{p.desc}</span>
          </span>
        </Link>
      ))}
    </SectionCard>
  );
}

function ListaProblemas({
  titulo,
  href,
  vazio: textoVazio,
  itens,
}: {
  titulo: string;
  href: string;
  vazio: string;
  itens: Array<{ titulo: string; meta: string }>;
}) {
  return (
    <SectionCard
      title={titulo}
      actions={
        <Link href={href} aria-label={`Ver todos: ${titulo}`} className="text-xs font-semibold text-primary hover:underline">
          Ver todos
        </Link>
      }
      contentClassName="p-3 sm:p-3"
    >
      {itens.length > 0 ? (
        <ul className="space-y-2">
          {itens.map((item, i) => (
            <li key={`${item.titulo}-${i}`} className="rounded-md bg-muted/50 px-3 py-2">
              <div className="truncate text-sm font-medium text-foreground" title={item.titulo}>
                {item.titulo}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{item.meta}</div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Tudo em dia" description={textoVazio} className="py-4" />
      )}
    </SectionCard>
  );
}

export default async function Home() {
  const supabase = await createClient();
  const efetivas = await minhasPermissoes();
  const pode = (chave: PermissaoUsuario) => temNaLista(efetivas, chave);

  // A página mostra só o que a pessoa pode abrir (a caixinha manda).
  const verEstoque = pode("estoque.ver");
  const verCompras = pode("compras.ver");
  const verOrcamentos = pode("orcamentos.visualizar");
  const verPlanejamento = pode("planejamento.ver");
  const verSuprimentos = verEstoque || verCompras;

  const [
    { data: aguardandoRaw },
    { data: previsaoRaw },
    { data: alertasRaw },
    { data: saldoRaw },
    { data: pedidosRaw },
    { data: dashboardRaw },
    { data: notificacoesRaw },
  ] = await Promise.all([
    supabase.rpc("aguardando_voce"),
    verSuprimentos
      ? supabase
          .from("v_previsao_suprimentos")
          .select("insumo_id, especificacao, unidade, unidade_saldo, disponivel, qtd_sugerida_compra, qtd_pedida_aberta, categoria_compra")
          .gt("qtd_sugerida_compra", 0)
          .order("qtd_sugerida_compra", { ascending: false })
      : vazio,
    verEstoque ? supabase.from("v_alertas_estoque").select("tipo, insumo_id, especificacao, validade, valor") : vazio,
    verEstoque ? supabase.from("v_estoque_saldo").select("insumo_id, especificacao, disponivel") : vazio,
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

  const pendencias = montarPendencias(aguardandoRaw);
  const previsao = ((previsaoRaw ?? []) as Previsao[]).filter((p) => Number(p.qtd_sugerida_compra ?? 0) > 0);
  const alertas = (alertasRaw ?? []) as AlertaEstoque[];
  const saldo = (saldoRaw ?? []) as EstoqueSaldo[];
  const pedidos = (pedidosRaw ?? []) as PedidoCompra[];
  const dashboard = dashboardRaw as DashboardExecutivo | null;
  const notificacoes = (notificacoesRaw ?? []) as Notificacao[];

  const comprarAgora = previsao
    .map((p) => ({
      titulo: p.especificacao ?? `Insumo #${p.insumo_id}`,
      meta: `disp. ${formatNumber(p.disponivel)} · já pedido ${formatNumber(p.qtd_pedida_aberta)} · sugerido ${formatNumber(p.qtd_sugerida_compra)} ${p.unidade_saldo ?? p.unidade ?? ""}`.trim(),
      peso: (p.categoria_compra === "critico" ? 1e9 : 0) + Number(p.qtd_sugerida_compra ?? 0),
    }))
    .sort((a, b) => b.peso - a.peso);
  const vencidos = alertas.filter((a) => a.tipo === "vencido" || a.tipo === "sem_validade");
  const vencendo = alertas.filter((a) => a.tipo === "vencimento");
  const semDisponivel = saldo.filter((s) => (s.disponivel ?? 0) <= 0);

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
  if (verSuprimentos) {
    indicadores.push({
      href: verCompras ? "/suprimentos#compras" : "/estoque/controle",
      label: "Comprar agora",
      value: comprarAgora.length,
      detail: "insumos com compra sugerida pela previsão",
      tone: comprarAgora.length ? "warning" : "neutral",
    });
  }
  if (verEstoque) {
    indicadores.push(
      {
        href: "/estoque/controle",
        label: "Vencidos",
        value: vencidos.length,
        detail: vencendo.length
          ? `vencidos ou sem validade · ${vencendo.length} vencendo em breve`
          : "vencidos ou críticos sem validade",
        tone: vencidos.length ? "danger" : vencendo.length ? "warning" : "neutral",
      },
      {
        href: "/estoque",
        label: "Sem disponível",
        value: semDisponivel.length,
        detail: saldo.length ? `de ${saldo.length} insumos monitorados` : "nenhum insumo monitorado",
        tone: semDisponivel.length ? "danger" : "neutral",
      },
    );
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

  const acoesRapidas = [
    pode("orcamentos.criar_editar") && { href: "/orcamento/demandas/nova", titulo: "Novo orçamento", desc: "Montar análises e preço", icon: TestTube2 },
    verPlanejamento && { href: "/planejamento", titulo: "Planejar campanha", desc: "Reservas e consumo", icon: ClipboardList },
    verEstoque && { href: "/estoque", titulo: "Revisar estoque", desc: "Saldos, lotes e validade", icon: PackageSearch },
    verCompras && { href: "/compras", titulo: "Abrir compras", desc: "Reposição e recebimento", icon: ShoppingCart },
    { href: "/notificacoes", titulo: "Notificações", desc: "Avisos para você", icon: Bell },
  ].filter(Boolean) as Array<{ href: string; titulo: string; desc: string; icon: React.ComponentType<{ className?: string }> }>;

  const passosOrcamento = [
    pode("orcamentos.criar_editar") && { href: "/orcamento/demandas/nova", titulo: "Novo orçamento", desc: "Cliente, amostras e análises em um só formulário." },
    verOrcamentos && { href: "/orcamento/demandas", titulo: "Orçamentos em andamento", desc: "Custos, revisão e emissão da proposta final." },
    pode("analises.ver") && { href: "/analises", titulo: "Análises", desc: "Revise capacidade, tempos, equipamentos e materiais por protocolo." },
    verOrcamentos && { href: "/orcamento/historico", titulo: "Histórico", desc: "Propostas emitidas, aprovadas ou encerradas." },
  ].filter(Boolean) as Array<{ href: string; titulo: string; desc: string }>;
  const passosEstoque = [
    verPlanejamento && { href: "/planejamento", titulo: "Planejamento", desc: "Calcule consumo por campanha e reserve material antes da execução." },
    verEstoque && { href: "/estoque", titulo: "Estoque e lotes", desc: "Veja saldo, validade, quarentena, bloqueios e rastreabilidade." },
    verCompras && { href: "/compras", titulo: "Compras", desc: "Transforme alertas em solicitação, aprovação, envio e recebimento." },
  ].filter(Boolean) as Array<{ href: string; titulo: string; desc: string }>;

  const baseControle = (
    [
      ["Cadastros", "/cadastros", "Insumos, equipamentos, técnicos, fornecedores, locais e parâmetros.", pode("cadastros.ver")],
      ["Qualidade", "/cadastros/qualidade", "O que falta nos cadastros e distorce custo ou compra.", pode("cadastros.ver")],
      ["Auditoria", "/auditoria", "Quem alterou o quê, e quando.", pode("auditoria.visualizar")],
      ["Usuários", "/usuarios", "Categorias, permissões e acessos.", efetivas.admin],
    ] as Array<[string, string, string, boolean]>
  ).filter(([, , , visivel]) => visivel);

  const semModulos =
    !verSuprimentos && !verOrcamentos && !verPlanejamento && passosOrcamento.length === 0 && baseControle.length === 0;

  return (
    <PageShell>
      <PageHeader
        title="Painel de decisão operacional"
        description="O que espera por você e o que precisa de compra, aceite, baixa ou revisão hoje."
        help={
          <HelpTip title="Painel de decisão">
            <p>
              Mostra só as áreas que o seu usuário pode abrir. Em <b>Aguardando você</b> ficam as
              etapas que dependem da sua ação; cada indicador leva à lista que o explica.
            </p>
            <HelpLegend
              items={[
                { tom: "critico", rotulo: "Crítico", texto: "vencido ou sem saldo disponível." },
                { tom: "atencao", rotulo: "Atenção", texto: "compra sugerida ou lote vencendo." },
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

      <section className="flex flex-wrap gap-3" aria-label="Ações rápidas">
        {acoesRapidas.map((acao) => (
          <AcaoRapida key={acao.href} {...acao} />
        ))}
      </section>

      {semModulos && (
        <EmptyState
          title="Nenhuma área liberada para o seu usuário"
          description="Peça ao administrador para liberar as áreas de que você precisa em Usuários. Os avisos para você continuam em Notificações."
        />
      )}

      {(gastos !== null || funil !== null) && (
        <SectionCard
          title="Dashboard executivo"
          description={
            funil !== null && gastos !== null
              ? "Gasto por mês e funil de orçamentos."
              : funil !== null
                ? "Funil de orçamentos."
                : "Gasto por mês."
          }
        >
          <ExecutiveCharts gastos={gastos} funil={funil} />
        </SectionCard>
      )}

      {(passosOrcamento.length > 0 || passosEstoque.length > 0) && (
        <section className="grid gap-4 lg:grid-cols-2" aria-label="Jornadas">
          {passosOrcamento.length > 0 && (
            <JornadaCard
              titulo="Orçamento"
              subtitulo="Do pedido do cliente à proposta emitida."
              ajuda={
                <p>
                  O preço sai das análises escolhidas: <b>custos diretos</b> (reagentes, equipamento e
                  pessoal), overhead e fatores comerciais. Tudo fica registrado na proposta.
                </p>
              }
              passos={passosOrcamento}
            />
          )}
          {passosEstoque.length > 0 && (
            <JornadaCard
              titulo="Estoque"
              subtitulo="Do planejamento à reposição."
              ajuda={
                <p>
                  O plano calcula quanto de cada insumo será usado e <b>reserva os lotes</b>. A baixa
                  segue o lote que vence primeiro, e a falta de saldo gera pedido de compra.
                </p>
              }
              passos={passosEstoque}
            />
          )}
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" aria-label="Pendências">
        {verSuprimentos && (
          <ListaProblemas
            titulo="Prioridade de compra"
            href={verCompras ? "/suprimentos#compras" : "/estoque/controle"}
            vazio="Nenhum insumo com compra sugerida pela previsão."
            itens={comprarAgora.slice(0, 5)}
          />
        )}
        {verEstoque && (
          <ListaProblemas
            titulo="Validade e uso"
            href="/estoque/controle"
            vazio="Nenhum lote vencido ou vencendo dentro da janela."
            itens={[...vencidos, ...vencendo].slice(0, 5).map((a) => ({
              titulo: a.especificacao ?? `Insumo #${a.insumo_id}`,
              meta: `${a.tipo === "vencido" ? "vencido" : a.tipo === "sem_validade" ? "sem validade cadastrada" : "vence em breve"}${a.validade ? ` · ${formatDate(a.validade)}` : ""} · saldo ${formatNumber(a.valor)}`,
            }))}
          />
        )}
        {verCompras && (
          <ListaProblemas
            titulo="Compras em andamento"
            href="/compras"
            vazio="Nenhum pedido aberto no ciclo de compras."
            itens={pedidos.slice(0, 5).map((p) => ({
              titulo: `Compra #${p.id}`,
              meta: `${statusInfo(p.status).label}${p.data_solicitacao ? ` · ${formatDate(p.data_solicitacao)}` : ""}${p.projeto ? ` · ${p.projeto}` : ""}`,
            }))}
          />
        )}
        <ListaProblemas
          titulo="Notificações"
          href="/notificacoes"
          vazio="Nenhuma notificação para você."
          itens={notificacoes.map((n) => ({
            titulo: n.titulo,
            meta: `${rotuloTipoNotificacao(n.tipo)}${n.corpo ? ` · ${n.corpo}` : ""}`,
          }))}
        />
      </section>

      {baseControle.length > 0 && (
        <SectionCard
          title="Base de controle"
          description="Cadastros, qualidade dos dados, auditoria e usuários."
          contentClassName="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          {baseControle.map(([titulo, href, desc]) => (
            <Link
              key={href}
              href={href}
              className="rounded-md border border-border/70 bg-muted/40 p-3 transition-colors hover:bg-muted/70"
            >
              <span className="block text-sm font-semibold text-foreground">{titulo}</span>
              <span className="mt-1 block text-xs leading-snug text-muted-foreground">{desc}</span>
            </Link>
          ))}
        </SectionCard>
      )}
    </PageShell>
  );
}
