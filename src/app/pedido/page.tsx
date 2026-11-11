import { cicloLiberaEm, dataEmBrasilia, rotuloCiclo, rotuloData } from "@/lib/pedido/ciclo";
import { rotuloUso } from "@/lib/pedido/natureza";
import { createClientUntyped } from "@/lib/supabase/server";
import { pode } from "@/lib/auth/permissao-efetiva";
import type { PedidoInternoRow } from "@/components/pedido/PedidosInternosTable";
import { PedidosPorEtapa } from "@/components/pedido/PedidosPorEtapa";
import { etapaDoPedido, filtroEtapaValido } from "@/lib/pedido/etapas";
import { proximoPasso } from "@/lib/pedido/proximo-passo";
import { coordenadorDoProjeto, type UsuarioCoordenador } from "@/app/projetos/_lib/responsavel";
import { AguardandoVoceLinha } from "@/components/dashboard/AguardandoVoceLinha";
import { PENDENCIAS_DE_PEDIDOS, pendenciasDe } from "@/components/dashboard/aguardando";
import { carregarPendencias } from "@/lib/pendencias/carregar";
import type { PedidoItemView } from "@/components/pedido/PedidoItensQuickView";
import { NovoPedidoDialog } from "@/components/pedido/NovoPedidoDialog";
import { pedidoInternoNumero, pedidoInternoSituacao } from "@/lib/pedido/status";
import { lerAreasPedido } from "@/lib/pedido/areas";
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

type ProjetoDoPedido = {
  nome: string | null;
  coordenador_id?: string | null;
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
  urgencia_justificativa?: string | null;
  ciclo_pagamento?: string | null;
  tipo_demanda?: string | null;
  modalidade_compra?: string | null;
  natureza?: string | null;
  aprovacao_area_em?: string | null;
  pedido_compra_id: number | null;
  criado_em: string;
  coordenador_projeto_nome?: string | null;
  coordenador_projeto_email?: string | null;
  projetos: ProjetoDoPedido | ProjetoDoPedido[] | null;
  pedidos_compra?: { id: number; status: string } | Array<{ id: number; status: string }> | null;
  pedidos_internos_itens: Array<PedidoItemView & { recebido_em?: string | null }>;
  pedidos_internos_anexos: Array<{ id: number; tipo: string }>;
};

function asOne<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

const LABEL_MODALIDADE: Record<string, string> = {
  compra_direta: "Compra direta",
  fundacao: "Fundação",
  universidade: "Universidade",
  outra: "Outra",
};

function pendenciasPedido(row: PedidoInternoListRow) {
  const pendencias: string[] = [];
  const docsCotacao = (row.pedidos_internos_anexos ?? []).some((doc) => ["orcamento_previo", "proposta", "print", "email"].includes(doc.tipo));
  if (!docsCotacao && ["orcamentos", "aprovado_compra"].includes(row.status)) pendencias.push("cotação");
  if (!(row.pedidos_internos_itens ?? []).length) pendencias.push("itens");
  if (row.status === "aprovado_para_compra" && !row.modalidade_compra) pendencias.push("modalidade");
  return pendencias.length ? pendencias.join(", ") : "—";
}

export default async function PedidoPage({
  searchParams,
}: {
  searchParams: Promise<{ etapa?: string | string[]; novo?: string | string[] }>;
}) {
  const query = await searchParams;
  const filtroEtapa = filtroEtapaValido(Array.isArray(query.etapa) ? query.etapa[0] : query.etapa);
  const abrirNovo = query.novo === "1";
  const supabase = await createClientUntyped();
  const [pedidosFull, projetosFull, podeExcluir, areas, aguardando, usuariosResp] = await Promise.all([
    supabase
      .from("pedidos_internos")
      .select("id, titulo, status, natureza, aprovacao_area_em, solicitante, data_necessidade, urgencia, urgencia_justificativa, ciclo_pagamento, tipo_demanda, modalidade_compra, pedido_compra_id, criado_em, coordenador_projeto_nome, coordenador_projeto_email, projetos(nome, coordenador_id, coordenador, coordenador_nome, coordenador_email), pedidos_compra(id, status), pedidos_internos_itens(id, tipo, especificacao, modelo, volume, quantidade, unidade, orcamento_previo, fornecedor_sugerido, recebido_em), pedidos_internos_anexos(id, tipo)")
      .order("criado_em", { ascending: false }),
    supabase.from("projetos").select("id, nome, coordenador, coordenador_nome, coordenador_email").order("nome"),
    pode("pedido.aprovar"),
    lerAreasPedido(supabase),
    // o banco diz, pela competência de cada um, o que espera este usuário (0173)
    carregarPendencias(),
    // quem aprova pelo projeto é o usuário coordenador (0136/0169), não o nome escrito no cadastro
    supabase.from("perfis").select("id, nome, email, suspenso"),
  ]);
  const usuarios = (usuariosResp.data ?? []) as UsuarioCoordenador[];
  const pendencias = pendenciasDe(aguardando, PENDENCIAS_DE_PEDIDOS);
  const { data: pedidos } = pedidosFull.error
    ? await supabase
        .from("pedidos_internos")
        .select("id, titulo, status, solicitante, data_necessidade, urgencia, pedido_compra_id, criado_em, projetos(nome, coordenador), pedidos_compra(id, status), pedidos_internos_itens(id, tipo, especificacao, modelo, volume, quantidade, unidade, orcamento_previo, fornecedor_sugerido, recebido_em), pedidos_internos_anexos(id, tipo)")
        .order("criado_em", { ascending: false })
    : pedidosFull;
  const { data: projetos } = projetosFull.error
    ? await supabase.from("projetos").select("id, nome, coordenador").order("nome")
    : projetosFull;

  const hojeBrasilia = dataEmBrasilia(new Date());
  const rows: PedidoInternoRow[] = ((pedidos ?? []) as unknown as PedidoInternoListRow[]).map((pedido) => {
    const itens = ((pedido.pedidos_internos_itens ?? []) as PedidoItemView[]) ?? [];
    const total = itens.reduce(
      (acc, item) => acc + Number(item.quantidade ?? 0) * Number(item.orcamento_previo ?? 0),
      0,
    );
    const status = pedidoInternoSituacao(pedido);
    const projetoRow = asOne(pedido.projetos);
    const compraRow = asOne(pedido.pedidos_compra);
    const projeto = projetoRow?.nome ?? "—";
    // quem aprovou fica gravado no pedido; antes disso, o usuário coordenador do projeto
    const coordenadorAtual = projetoRow ? coordenadorDoProjeto(projetoRow, usuarios) : null;
    const coordenador =
      pedido.coordenador_projeto_nome ??
      pedido.coordenador_projeto_email ??
      (coordenadorAtual?.situacao === "ok" ? coordenadorAtual.nome : coordenadorAtual ? "Sem coordenador no projeto" : "—");
    const docsCotacao = (pedido.pedidos_internos_anexos ?? []).some((doc) => ["orcamento_previo", "proposta", "print", "email"].includes(doc.tipo));
    const recebidos = (pedido.pedidos_internos_itens ?? []).filter((item) => item.recebido_em).length;
    // 0176: pedido do ciclo seguinte espera o ciclo abrir
    const cicloTravadoAte = pedido.status === "validado"
      ? cicloLiberaEm(pedido.ciclo_pagamento, pedido.urgencia, pedido.urgencia_justificativa, hojeBrasilia)
      : null;
    // mesmo texto da página do pedido; o nome do coordenador só vale com projeto
    const proxima = proximoPasso(pedido, {
      coordenador: coordenadorAtual?.situacao === "ok" ? coordenadorAtual.nome : null,
      semCoordenador: Boolean(coordenadorAtual && coordenadorAtual.situacao !== "ok"),
      semProjeto: !projetoRow,
      cicloAbreEm: cicloTravadoAte,
    });
    const compraFormal = compraRow?.id ? `#${compraRow.id} · ${statusInfo(compraRow.status).label}` : "—";
    return {
      id: pedido.id,
      numero: pedidoInternoNumero(pedido.id),
      titulo: pedido.titulo,
      tipoDemanda: rotuloUso(pedido.tipo_demanda),
      projeto,
      coordenador,
      solicitante: pedido.solicitante ?? "—",
      necessidade: formatDate(pedido.data_necessidade),
      urgencia: URGENCIA_LABEL[pedido.urgencia ?? "normal"] ?? pedido.urgencia ?? "Normal",
      ciclo: (rotuloCiclo(pedido.ciclo_pagamento) ?? "—") + (cicloTravadoAte ? ` · abre ${rotuloData(cicloTravadoAte)}` : ""),
      itens: itens.length,
      itensDetalhe: itens,
      total: brl(total),
      status: pedido.status,
      statusLabel: status.label,
      etapa: etapaDoPedido(pedido),
      proximaAcao: proxima.acao,
      responsavelAtual: proxima.responsavel,
      documentos: docsCotacao ? "ok" : "pendente",
      modalidade: pedido.modalidade_compra ? LABEL_MODALIDADE[pedido.modalidade_compra] ?? pedido.modalidade_compra : "—",
      compraFormal,
      pedidoCompraId: pedido.pedido_compra_id,
      recebimento: itens.length ? `${recebidos}/${itens.length}` : "—",
      pendencias: pendenciasPedido(pedido),
    };
  });

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Pedidos</h1>
              <HelpTip title="Pedidos">
                <p>
                  Todo pedido do laboratório ou do campo passa pelas mesmas seis etapas: solicitação,
                  aprovação, administrativo, cotação, compra e entrega, e pagamento.
                </p>
                <p>
                  <b>Aguardando você</b> mostra os pedidos que dependem de você, como os que o coordenador
                  precisa aprovar. Clique no nome para abrir o pedido: o botão de aprovar fica no topo dele.
                </p>
                <p>
                  Clique numa etapa para ver só os pedidos dela. A coluna <b>Próximo passo</b> diz o que
                  falta e com quem está.
                </p>
              </HelpTip>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">O que foi pedido e em que etapa cada pedido está.</p>
          </div>
          <NovoPedidoDialog projetos={((projetos ?? []) as ProjetoOption[])} areas={areas} abrirAoCarregar={abrirNovo} />
        </div>

        {/* o quadro completo fica no Início e no sino; aqui, uma linha (D4) */}
        <AguardandoVoceLinha pendencias={pendencias} className="mt-4" />

        <div className="mt-5">
          <PedidosPorEtapa key={filtroEtapa} rows={rows} podeExcluir={podeExcluir} filtroInicial={filtroEtapa} />
        </div>
      </main>
    </div>
  );
}
