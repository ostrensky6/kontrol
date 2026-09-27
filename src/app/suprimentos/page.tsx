import Link from "next/link";
import { createClientUntyped } from "@/lib/supabase/server";
import { pode } from "@/lib/auth/permissao-efetiva";
import { GerarPedidoReposicaoButton } from "@/components/pedido/GerarPedidoReposicaoButton";
import { PlanoLinhaAcoes } from "@/components/planejamento/PlanoGestao";
import { avaliarGestaoPlano } from "@/lib/planejamento/gestao";
import { HelpTip } from "@/components/common/HelpTip";
import { statusInfo } from "@/components/app/status";
import { formatDate, formatNumber as fmt } from "@/lib/formatters";
import { pedidoInternoNumero, pedidoInternoStatus } from "@/lib/pedido/status";

export const dynamic = "force-dynamic";

type PlanejamentoRow = {
  id: number;
  nome: string;
  data_alvo: string | null;
  status_operacional: string | null;
  projeto_id: number | null;
  projetos: { nome: string | null; coordenador?: string | null; coordenador_nome?: string | null; coordenador_email?: string | null } | Array<{ nome: string | null; coordenador?: string | null; coordenador_nome?: string | null; coordenador_email?: string | null }> | null;
  reservas_estoque: Array<{ status: string; quantidade: number; quantidade_consumida?: number | null; lote_id?: number | null }> | null;
};

type PedidoInternoRow = {
  id: number;
  titulo: string;
  status: string;
  solicitante: string | null;
  data_necessidade: string | null;
  urgencia: string | null;
  tipo_demanda: string | null;
  modalidade_compra: string | null;
  instituicao_destino: string | null;
  pedido_compra_id: number | null;
  coordenador_projeto_nome: string | null;
  coordenador_projeto_email: string | null;
  projetos: { nome: string | null; coordenador?: string | null; coordenador_nome?: string | null; coordenador_email?: string | null } | Array<{ nome: string | null; coordenador?: string | null; coordenador_nome?: string | null; coordenador_email?: string | null }> | null;
  pedidos_compra: { id: number; status: string } | Array<{ id: number; status: string }> | null;
  pedidos_internos_itens: Array<{ id: number; tipo: string; recebido_em: string | null; lote_id?: number | null }>;
  pedidos_internos_anexos: Array<{ id: number; tipo: string }>;
};

type CompraRow = {
  id: number;
  status: string;
  data_solicitacao: string | null;
  data_prevista_entrega: string | null;
  fornecedores: { nome: string | null } | null;
  projetos: { nome: string | null } | null;
  pedidos_compra_itens: Array<{ id: number; lote_id: number | null; pedido_interno_item_id: number | null }>;
};

type LoteRow = {
  id: number;
  codigo_lote: string | null;
  validade: string | null;
  validade_apos_abertura: string | null;
  quantidade_atual: number | null;
  status: string;
  insumos: { especificacao: string | null; unidade: string | null; categoria_compra?: string | null } | null;
};

type EquipamentoRow = {
  id: number;
  status_operacional: string;
  ativo: boolean;
  codigo_patrimonio: string | null;
  equipamentos: { nome: string | null } | null;
  equipamento_reservas: Array<{ id: number; status: string; data_inicio: string; data_fim: string; planejamento_id: number | null }> | null;
};

type NotificacaoRow = {
  id: number;
  tipo: string;
  titulo: string;
  corpo: string | null;
  entidade_tipo: string | null;
  entidade_id: number | null;
  status: string;
  criado_em: string;
};

type PrevisaoRow = {
  insumo_id: number;
  especificacao: string | null;
  unidade: string | null;
  disponivel: number | null;
  qtd_sugerida_compra: number | null;
  qtd_pedida_aberta: number | null;
};

const STATUS_PLANO: Record<string, string> = {
  rascunho: "Rascunho",
  reservado: "Reservado",
  em_execucao: "Em execução",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

const MODALIDADE: Record<string, string> = {
  compra_direta: "Compra direta",
  fundacao: "Fundação",
  universidade: "Universidade",
  outra: "Outra",
};

const STATUS_EXTRA: Record<string, string> = {
  operacional: "Operacional",
  em_manutencao: "Em manutenção",
  calibracao_pendente: "Calibração pendente",
  calibracao_vencida: "Calibração vencida",
  em_transito: "Em trânsito",
};

/** Código gravado no banco (ex.: "em_manutencao") → rótulo legível. */
function rotulo(valor: string | null | undefined) {
  if (!valor) return "—";
  if (STATUS_EXTRA[valor]) return STATUS_EXTRA[valor];
  const label = statusInfo(valor).label;
  if (label !== valor) return label;
  const texto = valor.replaceAll("_", " ");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function validadeEfetiva(lote: Pick<LoteRow, "validade" | "validade_apos_abertura">) {
  if (lote.validade && lote.validade_apos_abertura) {
    return lote.validade <= lote.validade_apos_abertura ? lote.validade : lote.validade_apos_abertura;
  }
  return lote.validade ?? lote.validade_apos_abertura;
}

function asOne<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function erroSchemaCache(error: { message?: string; code?: string } | null | undefined) {
  return Boolean(
    error &&
      (error.code === "PGRST204" ||
        error.message?.includes("schema cache") ||
        error.message?.includes("Could not find the")),
  );
}

function adicionarDias(data: string, dias: number) {
  const base = new Date(`${data}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

function isAtrasada(data: string | null, status: string) {
  if (!data || ["recebido", "cancelado"].includes(status)) return false;
  return data < new Date().toISOString().slice(0, 10);
}

function docsCotacao(pedido: PedidoInternoRow) {
  return pedido.pedidos_internos_anexos.some((doc) => ["orcamento_previo", "proposta", "print", "email"].includes(doc.tipo));
}

function coordenadorPedido(pedido: PedidoInternoRow) {
  const projeto = Array.isArray(pedido.projetos) ? (pedido.projetos[0] ?? null) : pedido.projetos;
  return (
    pedido.coordenador_projeto_nome ??
    pedido.coordenador_projeto_email ??
    projeto?.coordenador_nome ??
    projeto?.coordenador ??
    projeto?.coordenador_email ??
    "—"
  );
}

function proximaAcaoPedido(status: string) {
  const map: Record<string, { acao: string; responsavel: string }> = {
    rascunho: { acao: "Enviar para validação", responsavel: "Solicitante" },
    ajuste_solicitante: { acao: "Corrigir pedido", responsavel: "Solicitante" },
    em_validacao: { acao: "Aprovar coordenador", responsavel: "Coordenador" },
    validado: { acao: "Formalizar em compras", responsavel: "Coordenador/Compras" },
    formalizado: { acao: "Análise administrativa", responsavel: "Administrativo" },
    analise_administrativa: { acao: "Aprovar para cotação", responsavel: "Coordenador/Admin." },
    ajuste_compras: { acao: "Corrigir administrativo", responsavel: "Compras/Admin." },
    aprovado_compra: { acao: "Registrar cotações", responsavel: "Compras/Admin." },
    orcamentos: { acao: "Anexar cotações", responsavel: "Compras/Admin." },
    orcamentos_recebidos: { acao: "Enviar aprovação final", responsavel: "Coordenador" },
    aguardando_aprovacao_final: { acao: "Aprovar compra final", responsavel: "Coordenador" },
    aprovado_para_compra: { acao: "Definir modalidade", responsavel: "Compras/Admin." },
    compra_fechada: { acao: "Aguardar pagamento/NF", responsavel: "Compras/Admin." },
    encaminhado_instituicao: { acao: "Acompanhar instituição", responsavel: "Administrativo" },
    aguardando_pagamento_nf: { acao: "Anexar NF/comprovante", responsavel: "Compras/Admin." },
    compra_concluida: { acao: "Concluído", responsavel: "—" },
    cancelado: { acao: "Encerrado", responsavel: "—" },
  };
  return map[status] ?? { acao: "Revisar", responsavel: "Operação" };
}

function pendenciasPedido(pedido: PedidoInternoRow) {
  const pendencias: string[] = [];
  if (!pedido.projetos) pendencias.push("sem projeto");
  if (!pedido.pedidos_internos_itens.length) pendencias.push("sem itens");
  if (["aprovado_compra", "orcamentos"].includes(pedido.status) && !docsCotacao(pedido)) pendencias.push("cotação pendente");
  if (pedido.status === "aprovado_para_compra" && !pedido.modalidade_compra) pendencias.push("modalidade pendente");
  return pendencias;
}

function statusTone(kind: "red" | "amber" | "blue" | "green" | "zinc") {
  return {
    red: "bg-danger-soft text-danger-strong",
    amber: "bg-warning-soft text-warning-strong",
    blue: "bg-info-soft text-info-strong",
    green: "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300",
    zinc: "bg-muted text-muted-foreground",
  }[kind];
}

function Pill({ children, tone = "zinc" }: { children: React.ReactNode; tone?: "red" | "amber" | "blue" | "green" | "zinc" }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusTone(tone)}`}>{children}</span>;
}

function Kpi({ label, value, detail, href, tone }: { label: string; value: number; detail: string; href: string; tone: "red" | "amber" | "blue" | "green" | "zinc" }) {
  return (
    <Link href={href} className="rounded-lg border border-border bg-card p-4 shadow-sm hover:border-brand-300">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span className={`text-2xl font-semibold tabular-nums ${tone === "red" ? "text-danger-strong" : ""}`}>{value}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
    </Link>
  );
}

function Section({ id, title, action, help, children }: { id: string; title: string; action?: React.ReactNode; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="border-t border-border py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
          {help}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-input px-4 py-6 text-sm text-muted-foreground">{children}</div>;
}

function TableShell({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">{children}</div>;
}

const th = "px-4 py-3 text-left";
const td = "px-4 py-3";

async function consultarPedidosSuprimentos(supabase: Awaited<ReturnType<typeof createClientUntyped>>) {
  const full = await supabase
    .from("pedidos_internos")
    .select("id, titulo, status, solicitante, data_necessidade, urgencia, tipo_demanda, modalidade_compra, instituicao_destino, pedido_compra_id, coordenador_projeto_nome, coordenador_projeto_email, projetos(nome, coordenador, coordenador_nome, coordenador_email), pedidos_compra(id, status), pedidos_internos_itens(id, tipo, recebido_em, lote_id), pedidos_internos_anexos(id, tipo)")
    .order("criado_em", { ascending: false })
    .limit(80);

  if (!erroSchemaCache(full.error)) return full;

  return supabase
    .from("pedidos_internos")
    .select("id, titulo, status, solicitante, data_necessidade, urgencia, pedido_compra_id, projetos(nome, coordenador), pedidos_compra(id, status), pedidos_internos_itens(id, tipo, recebido_em, lote_id), pedidos_internos_anexos(id, tipo)")
    .order("criado_em", { ascending: false })
    .limit(80);
}

export default async function SuprimentosPage() {
  const supabase = await createClientUntyped();
  const podeGerarReposicao = await pode("compras.solicitar");
  const hoje = new Date().toISOString().slice(0, 10);
  const limiteVencimento = adicionarDias(hoje, 30);

  const [
    { data: planejamentosRaw },
    { data: pedidosRaw },
    { data: comprasRaw },
    { data: recebimentosRaw },
    { data: lotesRaw },
    { data: equipamentosRaw },
    { data: notificacoesRaw },
    { data: previsaoRaw },
  ] = await Promise.all([
    supabase
      .from("planejamento")
      .select("id, nome, data_alvo, status_operacional, projeto_id, projetos(nome, coordenador), reservas_estoque(status, quantidade, quantidade_consumida)")
      .order("criado_em", { ascending: false })
      .limit(60),
    consultarPedidosSuprimentos(supabase),
    supabase
      .from("pedidos_compra")
      .select("id, status, data_solicitacao, data_prevista_entrega, fornecedores(nome), projetos(nome), pedidos_compra_itens(id, lote_id, pedido_interno_item_id)")
      .in("status", ["solicitado", "aprovado", "enviado", "em_transito"])
      .order("data_prevista_entrega", { ascending: true, nullsFirst: false })
      .limit(80),
    supabase
      .from("pedidos_internos_itens")
      .select("id, especificacao, recebido_em, pedido_interno_id, pedidos_internos!inner(id, titulo, status, projetos(nome))")
      .is("recebido_em", null)
      .limit(80),
    supabase
      .from("lotes_estoque")
      .select("id, codigo_lote, validade, validade_apos_abertura, quantidade_atual, status, insumos(especificacao, unidade, categoria_compra)")
      .gt("quantidade_atual", 0)
      .not("status", "in", "(consumido,descartado)")
      .order("validade", { nullsFirst: false })
      .limit(100),
    supabase
      .from("equipamento_unidades")
      .select("id, status_operacional, ativo, codigo_patrimonio, equipamentos(nome)")
      .limit(80),
    supabase
      .from("notificacoes")
      .select("id, tipo, titulo, corpo, entidade_tipo, entidade_id, status, criado_em")
      .in("status", ["nao_lida"])
      .order("criado_em", { ascending: false })
      .limit(50),
    supabase
      .from("v_previsao_suprimentos")
      .select("insumo_id, especificacao, unidade, disponivel, qtd_sugerida_compra, qtd_pedida_aberta")
      .order("qtd_sugerida_compra", { ascending: false })
      .limit(40),
  ]);

  const planejamentos = (planejamentosRaw ?? []) as unknown as PlanejamentoRow[];
  const pedidos = (pedidosRaw ?? []) as unknown as PedidoInternoRow[];
  const compras = (comprasRaw ?? []) as unknown as CompraRow[];
  const recebimentos = (recebimentosRaw ?? []) as unknown as Array<{
    id: number;
    especificacao: string;
    pedido_interno_id: number;
    pedidos_internos: { id: number; titulo: string; status: string; projetos: { nome: string | null } | Array<{ nome: string | null }> | null } | Array<{ id: number; titulo: string; status: string; projetos: { nome: string | null } | Array<{ nome: string | null }> | null }> | null;
  }>;
  const lotes = (lotesRaw ?? []) as unknown as LoteRow[];
  const equipamentos = (equipamentosRaw ?? []) as unknown as EquipamentoRow[];
  const notificacoes = (notificacoesRaw ?? []) as unknown as NotificacaoRow[];
  const previsao = (previsaoRaw ?? []) as unknown as PrevisaoRow[];

  const planosRascunho = planejamentos.filter((p) => (p.status_operacional ?? "rascunho") === "rascunho");
  const planosReservados = planejamentos.filter((p) => p.status_operacional === "reservado");
  const planosExecucao = planejamentos.filter((p) => p.status_operacional === "em_execucao");
  const planosComReservaParcial = planejamentos.filter((p) => (p.reservas_estoque ?? []).some((r) => r.status === "parcial"));
  const planosAguardandoReserva = planejamentos.filter((p) => (p.status_operacional ?? "rascunho") === "rascunho" && !(p.reservas_estoque ?? []).some((r) => r.status === "reservado"));

  const aguardandoCoordenador = pedidos.filter((p) => p.status === "em_validacao");
  const aguardandoOrcamento = pedidos.filter((p) => ["aprovado_compra", "orcamentos"].includes(p.status) && !docsCotacao(p));
  const noAdministrativo = pedidos.filter((p) => ["formalizado", "analise_administrativa", "ajuste_compras"].includes(p.status));
  const enviadosInstituicao = pedidos.filter((p) => p.status === "encaminhado_instituicao" || ["fundacao", "universidade"].includes(p.modalidade_compra ?? ""));
  const compraDireta = pedidos.filter((p) => ["compra_fechada", "aguardando_pagamento_nf"].includes(p.status) || p.modalidade_compra === "compra_direta");
  const comprasAtrasadas = compras.filter((c) => isAtrasada(c.data_prevista_entrega, c.status));

  const lotesQuarentena = lotes.filter((l) => l.status === "quarentena");
  const lotesVencidos = lotes.filter((l) => {
    const v = validadeEfetiva(l);
    return v != null && v < hoje;
  });
  const lotesVencendo = lotes.filter((l) => {
    const v = validadeEfetiva(l);
    return v != null && v >= hoje && v <= limiteVencimento;
  });

  const equipamentosIndisponiveis = equipamentos.filter((e) => !e.ativo || ["em_manutencao", "calibracao_vencida", "inativo", "descartado"].includes(e.status_operacional));
  const equipamentosReservados = equipamentos.filter((e) => e.status_operacional === "reservado" || (e.equipamento_reservas ?? []).some((r) => ["reservado", "em_uso"].includes(r.status)));
  const reposicaoAgora = previsao.filter((p) => Number(p.qtd_sugerida_compra ?? 0) > 0);

  const pedidosPrioritarios = [
    ...aguardandoCoordenador,
    ...aguardandoOrcamento,
    ...noAdministrativo,
    ...enviadosInstituicao,
    ...compraDireta,
  ].filter((pedido, index, arr) => arr.findIndex((item) => item.id === pedido.id) === index).slice(0, 18);

  const rastreabilidade = pedidos
    .filter((pedido) => pedido.pedido_compra_id || pedido.pedidos_internos_itens.some((item) => item.lote_id))
    .slice(0, 12);

  const nav = [
    ["Visão geral", "#visao-geral"],
    ["Planejamentos e reservas", "#planejamentos"],
    ["Pedidos laboratório/campo", "#pedidos"],
    ["Compras", "#compras"],
    ["Recebimentos", "#recebimentos"],
    ["Quarentena", "#quarentena"],
    ["Equipamentos", "#equipamentos"],
    ["Notificações", "#notificacoes"],
    ["Rastreabilidade", "#rastreabilidade"],
  ];

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Suprimentos</h1>
              <HelpTip title="Suprimentos">
                <p>
                  Painel de todo o ciclo do material: <b>reservas</b> dos planos, pedidos e compras em
                  andamento, o que está chegando e os lotes em quarentena.
                </p>
                <p>Clique em um indicador para ir direto à seção correspondente.</p>
              </HelpTip>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {podeGerarReposicao && <GerarPedidoReposicaoButton />}
            <Link href="/pedido" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Novo pedido
            </Link>
          </div>
        </div>

        <nav className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2 text-sm" aria-label="Seções de suprimentos">
          {nav.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="app-nav-level-3 rounded-md border border-primary/20 px-3 py-1.5 text-xs font-semibold text-brand-800 shadow-xs transition hover:border-primary/40 hover:text-brand-900 dark:text-brand-300 dark:hover:bg-primary/10"
            >
              {label}
            </Link>
          ))}
        </nav>

        <nav className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" aria-label="Ferramentas de estoque">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ferramentas</span>
          <Link href="/estoque/controle" className="font-medium text-primary hover:underline">Controle de estoque</Link>
          <Link href="/estoque/inventario" className="font-medium text-primary hover:underline">Inventário (contagem)</Link>
          <Link href="/etiquetas" className="font-medium text-primary hover:underline">Etiquetas QR</Link>
          <Link href="/scanner/triagem" className="font-medium text-primary hover:underline">Códigos não reconhecidos</Link>
          <Link href="/estoque/equipamentos" className="font-medium text-primary hover:underline">Equipamentos</Link>
        </nav>

        <Section id="visao-geral" title="Visão geral">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Planos em rascunho" value={planosRascunho.length} detail="ainda sem reserva final" href="#planejamentos" tone="zinc" />
            <Kpi label="Aguardando reserva" value={planosAguardandoReserva.length} detail="planos prontos para imobilizar lotes" href="#planejamentos" tone={planosAguardandoReserva.length ? "amber" : "green"} />
            <Kpi label="Planos reservados" value={planosReservados.length} detail="com lotes imobilizados" href="#planejamentos" tone="blue" />
            <Kpi label="Planos com falta" value={planosComReservaParcial.length} detail="reservas parciais ou pendências de estoque" href="#planejamentos" tone={planosComReservaParcial.length ? "red" : "green"} />
            <Kpi label="Em execução" value={planosExecucao.length} detail="baixa já iniciada" href="#planejamentos" tone="blue" />
            <Kpi label="Aguardando coordenador" value={aguardandoCoordenador.length} detail="pedidos internos em validação" href="#pedidos" tone={aguardandoCoordenador.length ? "amber" : "green"} />
            <Kpi label="Cotação pendente" value={aguardandoOrcamento.length} detail="cotação/documento ainda não registrado" href="#pedidos" tone={aguardandoOrcamento.length ? "amber" : "green"} />
            <Kpi label="No administrativo" value={noAdministrativo.length} detail="fonte, rubrica, conformidade e cotação" href="#pedidos" tone="blue" />
            <Kpi label="Fundação/Universidade" value={enviadosInstituicao.length} detail="processos enviados ou nessa modalidade" href="#pedidos" tone="blue" />
            <Kpi label="Compra direta" value={compraDireta.length} detail="fornecedor/pagamento/NF em andamento" href="#pedidos" tone="blue" />
            <Kpi label="Compras atrasadas" value={comprasAtrasadas.length} detail="previsão de entrega vencida" href="#compras" tone={comprasAtrasadas.length ? "red" : "green"} />
            <Kpi label="Aguardando recebimento" value={recebimentos.length} detail="itens internos ainda não recebidos" href="#recebimentos" tone={recebimentos.length ? "amber" : "green"} />
            <Kpi label="Lotes em quarentena" value={lotesQuarentena.length} detail="aguardando liberação" href="#quarentena" tone={lotesQuarentena.length ? "amber" : "green"} />
            <Kpi label="Vencendo/vencidos" value={lotesVencendo.length + lotesVencidos.length} detail="janela de 30 dias ou já vencidos" href="#quarentena" tone={lotesVencidos.length ? "red" : lotesVencendo.length ? "amber" : "green"} />
            <Kpi label="Equipamentos críticos" value={equipamentosIndisponiveis.length + equipamentosReservados.length} detail="indisponíveis, reservados ou em manutenção" href="#equipamentos" tone={equipamentosIndisponiveis.length ? "red" : equipamentosReservados.length ? "blue" : "green"} />
            <Kpi label="Notificações" value={notificacoes.length} detail="pendências não lidas" href="#notificacoes" tone={notificacoes.length ? "amber" : "green"} />
          </div>
        </Section>

        <Section
          id="planejamentos"
          title="Planejamentos e reservas"
          help={
            <HelpTip title="Reserva de lotes">
              <p>
                Reservar separa lotes do estoque para um plano de análise. O material reservado deixa
                de contar como <b>disponível</b> para outros usos.
              </p>
              <p>Reserva parcial indica que faltou estoque para o plano inteiro.</p>
            </HelpTip>
          }
          action={<Link href="/planejamento" className="text-sm font-medium text-primary hover:underline">Abrir planejamento</Link>}>
          {planejamentos.length ? (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className={th}>Plano</th>
                    <th className={th}>Projeto</th>
                    <th className={th}>Data alvo</th>
                    <th className={th}>Status</th>
                    <th className={th}>Reservas</th>
                    <th className={`${th} text-right`}>Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {planejamentos.slice(0, 12).map((plano) => {
                    const reservas = plano.reservas_estoque ?? [];
                    const reservadas = reservas.filter((r) => r.status === "reservado").length;
                    const parciais = reservas.filter((r) => r.status === "parcial").length;
                    const gestao = avaliarGestaoPlano({ status: plano.status_operacional, reservas, podeGerir: podeGerarReposicao });
                    return (
                      <tr key={plano.id}>
                        <td className={`${td} font-medium`}><Link href={`/planejamento/${plano.id}`} className="text-primary hover:underline">{plano.nome}</Link></td>
                        <td className={td}>{asOne(plano.projetos)?.nome ?? "—"}</td>
                        <td className={td}>{formatDate(plano.data_alvo)}</td>
                        <td className={td}><Pill tone={plano.status_operacional === "em_execucao" ? "blue" : plano.status_operacional === "reservado" ? "green" : "zinc"}>{STATUS_PLANO[plano.status_operacional ?? "rascunho"] ?? plano.status_operacional ?? "Rascunho"}</Pill></td>
                        <td className={td}>{reservadas} lote(s){parciais ? ` · ${parciais} parcial` : ""}</td>
                        <td className={`${td} text-right`}>
                          <PlanoLinhaAcoes
                            planId={plano.id}
                            nome={plano.nome}
                            editavel={gestao.podeEditar}
                            gestao={{ acao: gestao.acao, bloqueado: gestao.acaoBloqueada, motivo: gestao.motivoAcao }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
          ) : <Empty>Nenhum planejamento encontrado.</Empty>}
        </Section>

        <Section id="pedidos" title="Pedidos do laboratório/campo" action={<Link href="/pedido" className="text-sm font-medium text-primary hover:underline">Abrir pedidos</Link>}>
          {pedidosPrioritarios.length ? (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className={th}>Pedido</th>
                    <th className={th}>Projeto</th>
                    <th className={th}>Coordenador</th>
                    <th className={th}>Etapa</th>
                    <th className={th}>Próxima ação</th>
                    <th className={th}>Responsável</th>
                    <th className={th}>Docs</th>
                    <th className={th}>Modalidade</th>
                    <th className={th}>Recebido</th>
                    <th className={th}>Pendências</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {pedidosPrioritarios.map((pedido) => {
                    const status = pedidoInternoStatus(pedido.status);
                    const prox = proximaAcaoPedido(pedido.status);
                    const materiais = pedido.pedidos_internos_itens.filter((item) => item.tipo === "material");
                    const recebidos = materiais.filter((item) => item.recebido_em).length;
                    const pendencias = pendenciasPedido(pedido);
                    return (
                      <tr key={pedido.id}>
                        <td className={`${td} min-w-56`}>
                          <Link href={`/pedido/${pedido.id}`} className="font-medium text-primary hover:underline">{pedidoInternoNumero(pedido.id)}</Link>
                          <p className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground" title={pedido.titulo}>{pedido.titulo}</p>
                        </td>
                        <td className={td}>{asOne(pedido.projetos)?.nome ?? "—"}</td>
                        <td className={td}>{coordenadorPedido(pedido)}</td>
                        <td className={td}><span className={`rounded-md px-2 py-1 text-xs ${status.className}`}>{status.label}</span></td>
                        <td className={td}>{prox.acao}</td>
                        <td className={td}>{prox.responsavel}</td>
                        <td className={td}>{docsCotacao(pedido) ? <Pill tone="green">OK</Pill> : <Pill tone="amber">Pendente</Pill>}</td>
                        <td className={td}>{pedido.modalidade_compra ? MODALIDADE[pedido.modalidade_compra] ?? pedido.modalidade_compra : "—"}</td>
                        <td className={td}>{materiais.length ? `${recebidos}/${materiais.length}` : "—"}</td>
                        <td className={td}>{pendencias.length ? <span className="text-warning-strong">{pendencias.join(", ")}</span> : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
          ) : <Empty>Nenhum pedido interno com pendência prioritária.</Empty>}
        </Section>

        <Section id="compras" title="Compras" action={<Link href="/compras" className="text-sm font-medium text-primary hover:underline">Abrir compras</Link>}>
          <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
            <div>
              {compras.length ? (
                <TableShell>
                  <table className="w-full text-sm">
                    <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className={th}>Compra</th>
                        <th className={th}>Fornecedor</th>
                        <th className={th}>Projeto</th>
                        <th className={th}>Status</th>
                        <th className={th}>Previsão</th>
                        <th className={th}>Itens</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {compras.slice(0, 12).map((compra) => (
                        <tr key={compra.id}>
                          <td className={`${td} font-medium`}><Link href={`/compras/${compra.id}`} className="text-primary hover:underline">Compra #{compra.id}</Link></td>
                          <td className={td}>{compra.fornecedores?.nome ?? "—"}</td>
                          <td className={td}>{compra.projetos?.nome ?? "—"}</td>
                          <td className={td}><Pill tone={isAtrasada(compra.data_prevista_entrega, compra.status) ? "red" : "blue"}>{rotulo(compra.status)}</Pill></td>
                          <td className={td}>{formatDate(compra.data_prevista_entrega)}</td>
                          <td className={td}>{compra.pedidos_compra_itens.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableShell>
              ) : <Empty>Nenhuma compra formal aberta.</Empty>}
            </div>
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
              <h3 className="text-sm font-semibold">Sugestões de reposição</h3>
              <div className="mt-3 space-y-2 text-sm">
                {reposicaoAgora.slice(0, 8).map((item) => (
                  <div key={item.insumo_id} className="flex justify-between gap-3 border-b border-border/60 pb-2 last:border-b-0">
                    <span className="truncate">{item.especificacao ?? `Insumo #${item.insumo_id}`}</span>
                    <span className="shrink-0 tabular-nums">pedir {fmt(item.qtd_sugerida_compra)} {item.unidade ?? ""}</span>
                  </div>
                ))}
                {!reposicaoAgora.length && <p className="text-muted-foreground">Sem reposição sugerida agora.</p>}
              </div>
            </div>
          </div>
        </Section>

        <Section id="recebimentos" title="Recebimentos" action={<Link href="/recebimento" className="text-sm font-medium text-primary hover:underline">Abrir recebimento</Link>}>
          {recebimentos.length ? (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className={th}>Item</th>
                    <th className={th}>Pedido</th>
                    <th className={th}>Projeto</th>
                    <th className={th}>Etapa</th>
                    <th className={`${th} text-right`}>Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {recebimentos.slice(0, 12).map((item) => {
                    const pedido = asOne(item.pedidos_internos);
                    const projeto = asOne(pedido?.projetos);
                    return (
                      <tr key={item.id}>
                        <td className={`${td} font-medium`}>{item.especificacao}</td>
                        <td className={td}><Link href={`/pedido/${item.pedido_interno_id}`} className="text-primary hover:underline">{pedido?.titulo ?? `Pedido #${item.pedido_interno_id}`}</Link></td>
                        <td className={td}>{projeto?.nome ?? "—"}</td>
                        <td className={td}>{pedido ? pedidoInternoStatus(pedido.status).label : "—"}</td>
                        <td className={`${td} text-right`}><Link href="/recebimento" className="font-medium text-primary hover:underline">Receber</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
          ) : <Empty>Nenhum item aguardando recebimento.</Empty>}
        </Section>

        <Section id="quarentena" title="Quarentena e liberação" action={<Link href="/estoque" className="text-sm font-medium text-primary hover:underline">Abrir estoque</Link>}>
          {lotesQuarentena.length || lotesVencendo.length || lotesVencidos.length ? (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className={th}>Lote</th>
                    <th className={th}>Insumo</th>
                    <th className={th}>Status</th>
                    <th className={th}>Validade efetiva</th>
                    <th className={th}>Saldo</th>
                    <th className={`${th} text-right`}>Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {[...lotesVencidos, ...lotesQuarentena, ...lotesVencendo].filter((lote, index, arr) => arr.findIndex((item) => item.id === lote.id) === index).slice(0, 14).map((lote) => {
                    const validade = validadeEfetiva(lote);
                    return (
                      <tr key={lote.id}>
                        <td className={`${td} font-mono text-xs`}><Link href={`/estoque/lotes/${lote.id}`} className="text-primary hover:underline">{lote.codigo_lote ?? `#${lote.id}`}</Link></td>
                        <td className={td}>{lote.insumos?.especificacao ?? "—"}</td>
                        <td className={td}><Pill tone={lote.status === "quarentena" ? "amber" : validade && validade < hoje ? "red" : "blue"}>{rotulo(lote.status)}</Pill></td>
                        <td className={td}>{formatDate(validade)}</td>
                        <td className={td}>{fmt(lote.quantidade_atual)} {lote.insumos?.unidade ?? ""}</td>
                        <td className={`${td} text-right`}><Link href={`/estoque/lotes/${lote.id}`} className="font-medium text-primary hover:underline">Ver lote</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
          ) : <Empty>Nenhum lote em quarentena, vencido ou vencendo nos próximos 30 dias.</Empty>}
        </Section>

        <Section id="equipamentos" title="Equipamentos" action={<Link href="/estoque/equipamentos" className="text-sm font-medium text-primary hover:underline">Abrir equipamentos</Link>}>
          {equipamentos.length ? (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className={th}>Unidade</th>
                    <th className={th}>Patrimônio</th>
                    <th className={th}>Status</th>
                    <th className={th}>Reserva ativa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {equipamentos.filter((e) => !e.ativo || e.status_operacional !== "operacional" || (e.equipamento_reservas ?? []).length > 0).slice(0, 12).map((equip) => {
                    const reserva = (equip.equipamento_reservas ?? []).find((r) => ["reservado", "em_uso"].includes(r.status));
                    return (
                      <tr key={equip.id}>
                        <td className={`${td} font-medium`}><Link href={`/estoque/equipamentos?focus=${equip.id}`} className="text-primary hover:underline">{equip.equipamentos?.nome ?? `Equipamento #${equip.id}`}</Link></td>
                        <td className={td}>{equip.codigo_patrimonio ?? "—"}</td>
                        <td className={td}><Pill tone={!equip.ativo || ["em_manutencao", "calibracao_vencida", "inativo", "descartado"].includes(equip.status_operacional) ? "red" : equip.status_operacional === "reservado" ? "blue" : "green"}>{equip.ativo ? rotulo(equip.status_operacional) : "Inativo"}</Pill></td>
                        <td className={td}>{reserva ? `${formatDate(reserva.data_inicio)} → ${formatDate(reserva.data_fim)}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
          ) : <Empty>Nenhuma unidade de equipamento cadastrada.</Empty>}
        </Section>

        <Section id="notificacoes" title="Notificações e pendências" action={<Link href="/notificacoes" className="text-sm font-medium text-primary hover:underline">Abrir notificações</Link>}>
          {notificacoes.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {notificacoes.slice(0, 12).map((n) => (
                <Link key={n.id} href={n.entidade_tipo === "pedido_compra" && n.entidade_id ? `/compras/${n.entidade_id}` : n.entidade_tipo === "planejamento" && n.entidade_id ? `/planejamento/${n.entidade_id}` : "/notificacoes"} className="rounded-lg border border-border bg-card p-4 shadow-sm hover:border-brand-300">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{n.titulo}</p>
                      {n.corpo && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{n.corpo}</p>}
                    </div>
                    <Pill tone="amber">{rotulo(n.tipo)}</Pill>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{formatDate(n.criado_em)}</p>
                </Link>
              ))}
            </div>
          ) : <Empty>Sem notificações não lidas.</Empty>}
        </Section>

        <Section
          id="rastreabilidade"
          title="Rastreabilidade"
          help={
            <HelpTip title="Rastreabilidade">
              <p>
                Liga cada pedido interno à <b>compra formal</b> e aos lotes que entraram no estoque, para
                saber de onde veio cada material.
              </p>
            </HelpTip>
          }
        >
          {rastreabilidade.length ? (
            <TableShell>
              <table className="w-full text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className={th}>Pedido interno</th>
                    <th className={th}>Compra formal</th>
                    <th className={th}>Itens recebidos</th>
                    <th className={th}>Lotes</th>
                    <th className={th}>Modalidade</th>
                    <th className={th}>Instituição</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {rastreabilidade.map((pedido) => {
                    const lotesRecebidos = pedido.pedidos_internos_itens.filter((item) => item.lote_id);
                    return (
                      <tr key={pedido.id}>
                        <td className={`${td} font-medium`}><Link href={`/pedido/${pedido.id}`} className="text-primary hover:underline">{pedidoInternoNumero(pedido.id)} · {pedido.titulo}</Link></td>
                        <td className={td}>{asOne(pedido.pedidos_compra)?.id ? <Link href={`/compras/${asOne(pedido.pedidos_compra)?.id}`} className="text-primary hover:underline">#{asOne(pedido.pedidos_compra)?.id} · {rotulo(asOne(pedido.pedidos_compra)?.status)}</Link> : "—"}</td>
                        <td className={td}>{pedido.pedidos_internos_itens.filter((item) => item.recebido_em).length}/{pedido.pedidos_internos_itens.length}</td>
                        <td className={td}>
                          {lotesRecebidos.length ? lotesRecebidos.map((item) => (
                            <Link key={item.id} href={`/estoque/lotes/${item.lote_id}`} className="mr-2 text-primary hover:underline">#{item.lote_id}</Link>
                          )) : "—"}
                        </td>
                        <td className={td}>{pedido.modalidade_compra ? MODALIDADE[pedido.modalidade_compra] ?? pedido.modalidade_compra : "—"}</td>
                        <td className={td}>{pedido.instituicao_destino ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
          ) : <Empty>Ainda não há processos com compra/lote suficientes para rastreabilidade item-a-item.</Empty>}
        </Section>
      </main>
    </div>
  );
}
