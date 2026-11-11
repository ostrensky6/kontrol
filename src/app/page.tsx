import Link from "next/link";
import { createClient, createClientUntyped } from "@/lib/supabase/server";
import { ExecutiveCharts } from "@/components/dashboard/ExecutiveCharts";
import { AguardandoVoce } from "@/components/dashboard/AguardandoVoce";
import { TabelaAtencaoHoje } from "@/components/dashboard/TabelaAtencaoHoje";
import { carregarPendencias } from "@/lib/pendencias/carregar";
import { formatCompactCurrency, formatNumber } from "@/lib/formatters";
import { minhasPermissoes, temNaLista } from "@/lib/auth/permissao-efetiva";
import type { PermissaoUsuario } from "@/lib/auth/permissions";
import { papelAtual } from "@/lib/auth/roles";
import { HelpLegend, HelpTip } from "@/components/common/HelpTip";
import { PageShell } from "@/components/app/PageShell";
import { PageHeader } from "@/components/app/PageHeader";
import { SectionCard } from "@/components/app/SectionCard";
import { StatCard, type Tone } from "@/components/app/StatCard";
import { EmptyState } from "@/components/app/EmptyState";
import { HREF_SITUACAO_ESTOQUE } from "@/components/estoque/CartaoSituacaoEstoque";
import {
  comprasDoInicio,
  linhasDeAvisos,
  linhasDeCompras,
  linhasDeSugestao,
  linhasDoEstoque,
  ordenarAtencaoHoje,
  type OrigemAtencao,
  type PedidoCompraInicioDb,
} from "@/lib/inicio/atencao-hoje";
import { lerACaminho } from "@/lib/suprimentos/a-caminho";
import { hojeIso } from "@/lib/estoque/baixa";
import { contarSinaisEstoque } from "@/lib/estoque/controle-dados";
import { hrefListaPorInsumo, numerosDoEstoque } from "@/lib/estoque/controle-estoque";
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
  entidade_tipo: string | null;
  entidade_id: number | null;
  criado_em: string | null;
};

/** Avisos não lidos que entram na tabela; o resto fica em Notificações. */
const LIMITE_AVISOS = 50;

const vazio = { data: null, count: null };
const semErro = { data: null, error: null };

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
      <StatCard label={label} value={value} detail={detail} tone={tone} className="h-full" labelInteiro />
    </Link>
  );
}

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

  const hoje = hojeIso();
  const semTipo = verEstoque || verCompras ? await createClientUntyped() : null;
  const [
    pendencias,
    situacaoEstoque,
    sinaisEstoque,
    { data: previsaoRaw },
    { data: pedidosRaw, error: erroPedidos },
    aCaminho,
    { data: dashboardRaw },
    { data: notificacoesRaw, error: erroNotificacoes },
  ] = await Promise.all([
    // a função do banco mais lotes em quarentena, disputas, códigos e manutenção vencida (F8)
    carregarPendencias(),
    // D1: o Início mostra a contagem do painel único de situação, com as regras dele
    semTipo && verEstoque ? contarSituacaoEstoque(semTipo, hoje) : null,
    // os números do estoque saem da mesma conta dos números do topo da Situação do estoque
    semTipo && verEstoque ? contarSinaisEstoque(semTipo, hoje) : null,
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
          .select("id, status, data_solicitacao, data_prevista_entrega, projeto, fornecedores(nome)")
          .in("status", ["solicitado", "aprovado", "enviado", "em_transito"])
          .order("criado_em", { ascending: false })
      : semErro,
    // prazo dos itens que ainda faltam chegar: a mesma leitura do quadro "A caminho"
    semTipo && verCompras ? lerACaminho(semTipo, hoje) : null,
    verOrcamentos || verCompras
      ? supabase
          .from("v_dashboard_executivo")
          .select("orcamentos_rascunho, orcamentos_enviados, orcamentos_aprovados, orcamentos_perdidos, compras_abertas_valor, gasto_por_projeto_mes")
          .maybeSingle()
      : vazio,
    supabase
      .from("v_minhas_notificacoes")
      .select("id, tipo, titulo, corpo, entidade_tipo, entidade_id, criado_em")
      .eq("status", "nao_lida")
      .order("criado_em", { ascending: false })
      .limit(LIMITE_AVISOS),
  ]);

  const previsao = ((previsaoRaw ?? []) as Previsao[]).filter((p) => Number(p.qtd_sugerida_compra ?? 0) > 0);
  const pedidos = (pedidosRaw ?? []) as PedidoCompraInicioDb[];
  const dashboard = dashboardRaw as DashboardExecutivo | null;
  // avisos gravados pelo banco ainda trazem palavras antigas: o glossário (10.5) vale aqui também
  const notificacoes = ((notificacoesRaw ?? []) as Notificacao[]).map((n) => ({ ...n, titulo: noGlossario(n.titulo), corpo: noGlossario(n.corpo) }));

  const comprarAgora = previsao
    .map((p) => ({
      insumoId: p.insumo_id,
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

  // Cinco números, sem repetição, cada um levando à lista que o explica. Sem estoque e
  // Vencidos ou vencendo são problemas diferentes, com ações diferentes: ficam separados.
  const indicadores: Array<{ href: string; label: string; value: React.ReactNode; detail: string; tone: Tone }> = [];
  if (verEstoque) {
    // os mesmos números do topo da Situação do estoque, com o mesmo texto e o mesmo destino;
    // leitura incompleta aparece como "sem dado", nunca como zero
    const numeros = numerosDoEstoque(sinaisEstoque);
    for (const filtro of ["sem_disponivel", "vencido_vencendo", "reposicao"] as const) {
      const numero = numeros.find((n) => n.filtro === filtro);
      if (numero) {
        indicadores.push({
          href: hrefListaPorInsumo(filtro),
          label: numero.label,
          value: numero.value,
          detail: numero.detail,
          tone: numero.tone,
        });
      }
    }
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
      // leitura que falha mostra "sem dado", nunca zero
      value: erroPedidos ? "sem dado" : pedidos.length,
      detail: erroPedidos
        ? "a leitura das compras não respondeu"
        : `${formatCompactCurrency(dashboard?.compras_abertas_valor)} estimados em andamento`,
      tone: !erroPedidos && pedidos.length ? "info" : "neutral",
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

  // Tabela "Precisa de atenção hoje": as quatro listas que o Início tinha (prioridade de
  // compra, validade, compras em andamento e avisos) numa tabela só, do mais grave para o
  // menos grave. Com Estoque, as linhas são as do painel de situação (D1); sem Estoque e
  // com Compras, fica a sugestão de compra da previsão.
  const origens: OrigemAtencao[] = [
    ...(verSuprimentos ? (["Estoque"] as const) : []),
    ...(verEstoque ? (["Validade"] as const) : []),
    ...(verCompras ? (["Compras"] as const) : []),
    "Aviso",
  ];
  const atencao = ordenarAtencaoHoje([
    ...(situacaoEstoque ? linhasDoEstoque(situacaoEstoque.linhas) : linhasDeSugestao(comprarAgora)),
    ...linhasDeCompras(comprasDoInicio(pedidos, aCaminho && !aCaminho.erro ? aCaminho.itens : null, hoje)),
    ...linhasDeAvisos(
      notificacoes.map((n) => ({
        id: n.id,
        tipo: n.tipo,
        titulo: n.titulo,
        corpo: n.corpo,
        entidadeTipo: n.entidade_tipo,
        entidadeId: n.entidade_id,
        criadoEm: n.criado_em,
      })),
    ),
  ]);
  // leitura que falhou vira aviso na tabela: ela nunca fica menor em silêncio
  const semDado = [
    situacaoEstoque && !situacaoEstoque.resumo
      ? "Estoque e validade: sem dado. A leitura do estoque não respondeu por inteiro; abra a Situação do estoque para conferir."
      : null,
    erroPedidos ? "Compras: sem dado. A leitura das compras não respondeu." : null,
    !erroPedidos && aCaminho?.erro
      ? "Compras: prazos estimados sem dado. Só as datas informadas nas compras foram usadas para dizer o que está atrasado."
      : null,
    erroNotificacoes ? "Avisos: sem dado. A leitura dos avisos não respondeu." : null,
  ].filter((texto): texto is string => Boolean(texto));
  const listas = [
    ...(verEstoque ? [{ rotulo: "Situação do estoque", href: HREF_SITUACAO_ESTOQUE }] : []),
    ...(verCompras ? [{ rotulo: "Compras", href: "/compras" }] : []),
    { rotulo: "Notificações", href: "/notificacoes" },
  ];

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
              etapas que dependem da sua ação; cada número leva à lista que o explica; a tabela junta
              estoque, validade, compras e avisos, do mais grave para o menos grave.
            </p>
            <HelpLegend
              items={[
                { tom: "critico", rotulo: "Urgente", texto: "sem estoque, lote vencido, risco de falta ou entrega atrasada." },
                { tom: "atencao", rotulo: "Atenção", texto: "abaixo do mínimo, lote vencendo, aberto fora da ordem ou aviso não lido." },
                { tom: "info", rotulo: "Em andamento", texto: "compras abertas dentro do prazo." },
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

      <SectionCard
        title="Precisa de atenção hoje"
        help={
          <HelpTip title="Precisa de atenção hoje">
            <p>
              Uma linha por item, do mais grave para o menos grave. Com a mesma gravidade, as origens se
              alternam, para uma não esconder as outras.
            </p>
            <p>
              <b>Estoque</b> e <b>Validade</b> vêm do painel de Situação do estoque. <b>Compras</b> são as
              compras abertas. <b>Avisos</b> são as suas notificações não lidas.
            </p>
            <p>A tabela mostra 10 linhas; <b>Ver todos</b> abre o resto aqui mesmo.</p>
          </HelpTip>
        }
        contentClassName="p-3 sm:p-4"
      >
        <TabelaAtencaoHoje linhas={atencao} origens={origens} semDado={semDado} listas={listas} />
      </SectionCard>

      {(gastosComDado !== null || funilComDado !== null) && (
        <SectionCard title="Dashboard executivo">
          <ExecutiveCharts gastos={gastosComDado} funil={funilComDado} />
        </SectionCard>
      )}
    </PageShell>
  );
}
