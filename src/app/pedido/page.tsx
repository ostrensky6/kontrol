import { createClientUntyped } from "@/lib/supabase/server";
import { pode } from "@/lib/auth/permissao-efetiva";
import { PedidosInternosTable, type PedidoInternoRow } from "@/components/pedido/PedidosInternosTable";
import type { PedidoItemView } from "@/components/pedido/PedidoItensQuickView";
import { NovoPedidoDialog } from "@/components/pedido/NovoPedidoDialog";
import { pedidoInternoNumero, pedidoInternoStatus } from "@/lib/pedido/status";
import { formatCurrency as brl, formatDate } from "@/lib/formatters";
import { statusInfo } from "@/components/app/status";
import { HelpTip } from "@/components/common/HelpTip";

const URGENCIA_LABEL: Record<string, string> = {
  baixa: "Baixa",
  normal: "Normal",
  alta: "Alta",
  critica: "Crítica",
};

export const dynamic = "force-dynamic";

type ProjetoOption = {
  id: number;
  nome: string;
  coordenador?: string | null;
  coordenador_nome?: string | null;
  coordenador_email?: string | null;
};

type PedidoInternoListRow = {
  id: number;
  titulo: string;
  status: string;
  solicitante: string | null;
  data_necessidade: string | null;
  urgencia: string | null;
  tipo_demanda?: string | null;
  modalidade_compra?: string | null;
  pedido_compra_id: number | null;
  criado_em: string;
  coordenador_projeto_nome?: string | null;
  coordenador_projeto_email?: string | null;
  projetos: { nome: string | null; coordenador?: string | null; coordenador_nome?: string | null; coordenador_email?: string | null } | Array<{ nome: string | null; coordenador?: string | null; coordenador_nome?: string | null; coordenador_email?: string | null }> | null;
  pedidos_compra?: { id: number; status: string } | Array<{ id: number; status: string }> | null;
  pedidos_internos_itens: Array<PedidoItemView & { recebido_em?: string | null }>;
  pedidos_internos_anexos: Array<{ id: number; tipo: string }>;
};

function asOne<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

const LABEL_TIPO: Record<string, string> = {
  laboratorio: "Laboratório",
  campo: "Campo",
  laboratorio_campo: "Lab./campo",
  administrativo: "Administrativo",
  outro: "Outro",
};

const LABEL_MODALIDADE: Record<string, string> = {
  compra_direta: "Compra direta",
  fundacao: "Fundação",
  universidade: "Universidade",
  outra: "Outra",
};

function proximaAcao(status: string) {
  const map: Record<string, { acao: string; responsavel: string }> = {
    rascunho: { acao: "Enviar para validação", responsavel: "Solicitante" },
    ajuste_solicitante: { acao: "Corrigir pedido", responsavel: "Solicitante" },
    ajuste_compras: { acao: "Corrigir dados administrativos", responsavel: "Compras/Admin." },
    em_validacao: { acao: "Aprovar coordenador", responsavel: "Coordenador do projeto" },
    validado: { acao: "Formalizar compra", responsavel: "Coordenador/Compras" },
    formalizado: { acao: "Análise administrativa", responsavel: "Administrativo" },
    analise_administrativa: { acao: "Aprovar para cotação", responsavel: "Coordenador/Admin." },
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

function pendenciasPedido(row: PedidoInternoListRow) {
  const pendencias: string[] = [];
  const docsCotacao = row.pedidos_internos_anexos.some((doc) => ["orcamento_previo", "proposta", "print", "email"].includes(doc.tipo));
  if (!docsCotacao && ["orcamentos", "aprovado_compra"].includes(row.status)) pendencias.push("cotação");
  if (!row.projetos) pendencias.push("projeto");
  if (!row.pedidos_internos_itens.length) pendencias.push("itens");
  if (row.status === "aprovado_para_compra" && !row.modalidade_compra) pendencias.push("modalidade");
  return pendencias.length ? pendencias.join(", ") : "—";
}

function recebimentoPendente(valor: string) {
  if (valor === "—") return false;
  const [recebidos, total] = valor.split("/").map((parte) => Number(parte));
  return Number.isFinite(recebidos) && Number.isFinite(total) && total > 0 && recebidos < total;
}

export default async function PedidoPage() {
  const supabase = await createClientUntyped();
  const [pedidosFull, projetosFull, podeExcluir] = await Promise.all([
    supabase
      .from("pedidos_internos")
      .select("id, titulo, status, solicitante, data_necessidade, urgencia, tipo_demanda, modalidade_compra, pedido_compra_id, criado_em, coordenador_projeto_nome, coordenador_projeto_email, projetos(nome, coordenador, coordenador_nome, coordenador_email), pedidos_compra(id, status), pedidos_internos_itens(id, tipo, especificacao, modelo, volume, quantidade, unidade, orcamento_previo, fornecedor_sugerido, recebido_em), pedidos_internos_anexos(id, tipo)")
      .order("criado_em", { ascending: false }),
    supabase.from("projetos").select("id, nome, coordenador, coordenador_nome, coordenador_email").order("nome"),
    pode("pedido.aprovar"),
  ]);
  const { data: pedidos } = pedidosFull.error
    ? await supabase
        .from("pedidos_internos")
        .select("id, titulo, status, solicitante, data_necessidade, urgencia, pedido_compra_id, criado_em, projetos(nome, coordenador), pedidos_compra(id, status), pedidos_internos_itens(id, tipo, especificacao, modelo, volume, quantidade, unidade, orcamento_previo, fornecedor_sugerido, recebido_em), pedidos_internos_anexos(id, tipo)")
        .order("criado_em", { ascending: false })
    : pedidosFull;
  const { data: projetos } = projetosFull.error
    ? await supabase.from("projetos").select("id, nome, coordenador").order("nome")
    : projetosFull;

  const rows: PedidoInternoRow[] = ((pedidos ?? []) as unknown as PedidoInternoListRow[]).map((pedido) => {
    const itens = ((pedido.pedidos_internos_itens ?? []) as PedidoItemView[]) ?? [];
    const total = itens.reduce(
      (acc, item) => acc + Number(item.quantidade ?? 0) * Number(item.orcamento_previo ?? 0),
      0,
    );
    const status = pedidoInternoStatus(pedido.status);
    const projetoRow = asOne(pedido.projetos);
    const compraRow = asOne(pedido.pedidos_compra);
    const projeto = projetoRow?.nome ?? "—";
    const coordenador =
      pedido.coordenador_projeto_nome ??
      pedido.coordenador_projeto_email ??
      projetoRow?.coordenador_nome ??
      projetoRow?.coordenador ??
      projetoRow?.coordenador_email ??
      "—";
    const docsCotacao = pedido.pedidos_internos_anexos.some((doc) => ["orcamento_previo", "proposta", "print", "email"].includes(doc.tipo));
    const recebidos = pedido.pedidos_internos_itens.filter((item) => item.recebido_em).length;
    const proxima = proximaAcao(pedido.status);
    const compraFormal = compraRow?.id ? `#${compraRow.id} · ${statusInfo(compraRow.status).label}` : "—";
    return {
      id: pedido.id,
      numero: pedidoInternoNumero(pedido.id),
      titulo: pedido.titulo,
      tipoDemanda: LABEL_TIPO[pedido.tipo_demanda ?? "laboratorio"] ?? pedido.tipo_demanda ?? "—",
      projeto,
      coordenador,
      solicitante: pedido.solicitante ?? "—",
      necessidade: formatDate(pedido.data_necessidade),
      urgencia: URGENCIA_LABEL[pedido.urgencia ?? "normal"] ?? pedido.urgencia ?? "Normal",
      itens: itens.length,
      itensDetalhe: itens,
      total: brl(total),
      status: pedido.status,
      statusLabel: status.label,
      proximaAcao: proxima.acao,
      responsavelAtual: proxima.responsavel,
      documentos: docsCotacao ? "ok" : "pendente",
      modalidade: pedido.modalidade_compra ? LABEL_MODALIDADE[pedido.modalidade_compra] ?? pedido.modalidade_compra : "—",
      compraFormal,
      recebimento: itens.length ? `${recebidos}/${itens.length}` : "—",
      pendencias: pendenciasPedido(pedido),
    };
  });

  const abertos = rows.filter((row) => !["cancelado", "compra_concluida"].includes(row.status));
  const aguardandoCoordenador = rows.filter((row) => row.status === "em_validacao");
  const cotacao = rows.filter((row) => ["aprovado_compra", "orcamentos", "orcamentos_recebidos"].includes(row.status));
  const recebimento = rows.filter((row) => recebimentoPendente(row.recebimento));
  const pendentes = rows.filter((row) => row.pendencias !== "—");

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Pedido</h1>
              <HelpTip title="Pedido interno">
                <p>
                  Solicitação de materiais, serviços ou equipamentos feita pela equipe. Passa pela{" "}
                  <b>validação do coordenador</b>, pela análise administrativa e pela cotação antes de
                  virar compra formal.
                </p>
                <p>Abra um pedido para ver em que etapa ele está e qual é a próxima ação.</p>
              </HelpTip>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Pedidos internos do GATGF de materiais e serviços, antes da compra formal.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <NovoPedidoDialog projetos={((projetos ?? []) as ProjetoOption[])} />
          </div>
        </div>

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi label="Abertos" value={abertos.length} detail="em qualquer etapa ativa" tone={abertos.length ? "info" : "neutral"} />
          <Kpi label="Aguardando coordenador" value={aguardandoCoordenador.length} detail="validação técnica" tone={aguardandoCoordenador.length ? "warning" : "neutral"} />
          <Kpi label="Em cotação" value={cotacao.length} detail="cotações" tone={cotacao.length ? "info" : "neutral"} />
          <Kpi label="Com pendências" value={pendentes.length} detail="faltam dados/documentos" tone={pendentes.length ? "warning" : "neutral"} />
          <Kpi label="Aguardando recebimento" value={recebimento.length} detail="itens ainda não recebidos" tone={recebimento.length ? "success" : "neutral"} />
        </section>

        <div className="mt-6">
          <PedidosInternosTable rows={rows} podeExcluir={podeExcluir} />
        </div>
      </main>
    </div>
  );
}

function Kpi({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  tone: "neutral" | "info" | "warning" | "success";
}) {
  const toneClass = {
    neutral: "text-foreground",
    info: "text-info-strong",
    warning: "text-warning-strong",
    success: "text-leaf-700 dark:text-leaf-300",
  }[tone];
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
