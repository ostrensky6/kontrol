import { cicloLiberaEm, dataEmBrasilia, rotuloCiclo, rotuloData } from "@/lib/pedido/ciclo";
import { rotuloUso } from "@/lib/pedido/natureza";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClientUntyped } from "@/lib/supabase/server";
import { pode } from "@/lib/auth/permissao-efetiva";
import type { PedidoInternoRow } from "@/components/pedido/PedidosInternosTable";
import { PedidosPorEtapa } from "@/components/pedido/PedidosPorEtapa";
import { STATUS_PEDIDO_ENCERRADO, etapaDoPedido, filtroEtapaValido } from "@/lib/pedido/etapas";
import { proximoPasso } from "@/lib/pedido/proximo-passo";
import { coordenadorDoProjeto, type UsuarioCoordenador } from "@/app/projetos/_lib/responsavel";
import { AguardandoVoce } from "@/components/dashboard/AguardandoVoce";
import { PENDENCIAS_DE_PEDIDOS, pendenciasDe } from "@/components/dashboard/aguardando";
import { carregarPendencias } from "@/lib/pendencias/carregar";
import type { PedidoItemView } from "@/components/pedido/PedidoItensQuickView";
import { NovoPedidoDialog } from "@/components/pedido/NovoPedidoDialog";
import { pedidoInternoNumero, pedidoInternoSituacao } from "@/lib/pedido/status";
import { lerAreasPedido } from "@/lib/pedido/areas";
import { formatCurrency as brl, formatDate } from "@/lib/formatters";
import { statusInfo } from "@/components/app/status";
import { HelpTip } from "@/components/common/HelpTip";
import { AvisoLeitura } from "@/components/common/AvisoLeitura";
import { novaLeitura } from "@/lib/supabase/leitura";
import { lerAbertosERecentes } from "@/lib/supabase/lista-recente";

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

const COLUNAS_PEDIDO =
  "id, titulo, status, natureza, aprovacao_area_em, solicitante, data_necessidade, urgencia, urgencia_justificativa, ciclo_pagamento, tipo_demanda, modalidade_compra, pedido_compra_id, criado_em, coordenador_projeto_nome, coordenador_projeto_email, projetos(nome, coordenador_id, coordenador, coordenador_nome, coordenador_email), pedidos_compra(id, status), pedidos_internos_itens(id, tipo, especificacao, modelo, volume, quantidade, unidade, orcamento_previo, fornecedor_sugerido, recebido_em), pedidos_internos_anexos(id, tipo)";
// banco ainda sem as colunas novas: a lista abre com o que existia antes
const COLUNAS_PEDIDO_ANTIGAS =
  "id, titulo, status, solicitante, data_necessidade, urgencia, pedido_compra_id, criado_em, projetos(nome, coordenador), pedidos_compra(id, status), pedidos_internos_itens(id, tipo, especificacao, modelo, volume, quantidade, unidade, orcamento_previo, fornecedor_sugerido, recebido_em), pedidos_internos_anexos(id, tipo)";

/**
 * Pedidos em andamento vêm todos, sem corte; dos concluídos e cancelados, só
 * os mais recentes (ou todos, quando a pessoa pede). A ordem termina em `id`
 * para a leitura em páginas não pular linha.
 */
function lerPedidos(supabase: SupabaseClient, colunas: string, todosEncerrados: boolean) {
  const encerrados = `(${STATUS_PEDIDO_ENCERRADO.join(",")})`;
  return lerAbertosERecentes<PedidoInternoListRow>({
    abertos: (de, ate) =>
      supabase
        .from("pedidos_internos")
        .select(colunas)
        .not("status", "in", encerrados)
        .order("criado_em", { ascending: false })
        .order("id", { ascending: false })
        .range(de, ate),
    encerrados: (de, ate, contar) =>
      supabase
        .from("pedidos_internos")
        .select(colunas, contar ? { count: "exact" } : undefined)
        .in("status", [...STATUS_PEDIDO_ENCERRADO])
        .order("criado_em", { ascending: false })
        .order("id", { ascending: false })
        .range(de, ate),
    todos: todosEncerrados,
  });
}

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
  searchParams: Promise<{ etapa?: string | string[]; novo?: string | string[]; encerrados?: string | string[] }>;
}) {
  const leitura = novaLeitura("/pedido");
  const query = await searchParams;
  const filtroEtapa = filtroEtapaValido(Array.isArray(query.etapa) ? query.etapa[0] : query.etapa);
  const abrirNovo = query.novo === "1";
  const todosEncerrados = (Array.isArray(query.encerrados) ? query.encerrados[0] : query.encerrados) === "todos";
  const supabase = await createClientUntyped();
  const [pedidosFull, projetosFull, podeExcluir, areas, aguardando, usuariosResp, podeConduzir] = await Promise.all([
    lerPedidos(supabase, COLUNAS_PEDIDO, todosEncerrados),
    supabase.from("projetos").select("id, nome, coordenador, coordenador_nome, coordenador_email").order("nome"),
    pode("pedido.aprovar"),
    lerAreasPedido(supabase),
    // o banco diz, pela competência de cada um, o que espera este usuário (0173)
    carregarPendencias(),
    // quem aprova pelo projeto é o usuário coordenador (0136/0169), não o nome escrito no cadastro
    leitura.de("pessoas", supabase.from("perfis").select("id, nome, email, suspenso")),
    // 0184: quem conduz a compra inteira (e o Administrador) não para no ciclo
    pode("compras.conduzir"),
  ]);
  const usuarios = (usuariosResp.data ?? []) as UsuarioCoordenador[];
  const pendencias = pendenciasDe(aguardando, PENDENCIAS_DE_PEDIDOS);
  const pedidosLidos = pedidosFull.error
    ? await leitura.de("pedidos", lerPedidos(supabase, COLUNAS_PEDIDO_ANTIGAS, todosEncerrados))
    : pedidosFull;
  // em andamento e encerrados vêm de duas leituras: a lista segue do mais novo para o mais antigo
  const pedidos = [...pedidosLidos.data].sort(
    (a, b) => String(b.criado_em).localeCompare(String(a.criado_em)) || b.id - a.id,
  );
  const { data: projetos } = projetosFull.error
    ? await leitura.de("projetos", supabase.from("projetos").select("id, nome, coordenador").order("nome"))
    : projetosFull;

  const hojeBrasilia = dataEmBrasilia(new Date());
  const rows: PedidoInternoRow[] = pedidos.map((pedido) => {
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
      // mesma regra da página do pedido (0184): para quem conduz, o próximo passo é formalizar
      cicloAbreEm: podeConduzir ? null : cicloTravadoAte,
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
        <AvisoLeitura falhas={leitura.falhas} />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Pedidos</h1>
              <HelpTip title="Pedidos">
                <p>
                  Todo pedido do laboratório ou do campo passa pelas mesmas seis etapas: solicitação,
                  aprovação, administrativo, cotação, fechamento de compra e pagamento.
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

        {/* o quadro inteiro voltou na organização de 11/11/2026: o que espera a pessoa fica onde a ação acontece */}
        <div className="mt-4">
          <AguardandoVoce
            pendencias={pendencias}
            destaque
            vazio="Nenhum pedido esperando a sua ação agora. Quando um pedido depender de você, ele aparece aqui."
            ajuda="Pedidos que dependem de você: aprovar como coordenador ou pelo laboratório, autorizar, cotar, fechar a compra ou pagar."
          />
        </div>

        <div className="mt-5">
          <PedidosPorEtapa
            key={filtroEtapa}
            rows={rows}
            podeExcluir={podeExcluir}
            filtroInicial={filtroEtapa}
            encerrados={pedidosLidos.encerrados}
            todosEncerrados={todosEncerrados}
          />
        </div>
      </main>
    </div>
  );
}
