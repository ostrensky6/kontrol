import Link from "next/link";
import { notFound } from "next/navigation";
import { createClientUntyped } from "@/lib/supabase/server";
import { pode } from "@/lib/auth/permissao-efetiva";
import {
  adicionarAnexoPedidoInterno,
  adicionarItemPedidoInterno,
  registrarAnaliseAdministrativa,
  registrarComunicacaoPedidoInterno,
  removerAnexoPedidoInterno,
  removerItemPedidoInterno,
} from "@/lib/actions/pedidos-internos";
import { PedidoInternoAcoes } from "@/components/pedido/PedidoInternoAcoes";
import { PedidoInternoCabecalhoAcoes } from "@/components/pedido/PedidoInternoCabecalhoAcoes";
import { ItemRecebimentoCell } from "@/components/pedido/ItemRecebimentoCell";
import { PedidoItemEditar } from "@/components/pedido/PedidoItemEditar";
import { PedidoItemCamposAssistidos, type PedidoItemCatalogo } from "@/components/pedido/PedidoItemCamposAssistidos";
import { Timeline } from "@/components/common/Timeline";
import { HelpLegend, HelpTip } from "@/components/common/HelpTip";
import { FormComMensagem } from "@/components/pedido/FormComMensagem";
import { SubmitButton } from "@/components/common/SubmitButton";
import { ConfirmSubmitButton } from "@/components/common/ConfirmSubmitButton";
import { statusInfo } from "@/components/app/status";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { listarEventos } from "@/lib/actions/eventos";
import {
  PEDIDO_INTERNO_ETAPA_RECEBIDA,
  PEDIDO_INTERNO_FLUXO,
  PEDIDO_INTERNO_STATUS,
  pedidoInternoNumero,
  pedidoInternoStatus,
  podeMarcarRecebida,
  type PedidoInternoStatus,
} from "@/lib/pedido/status";
import { formatCurrency as brl, formatDate, formatDateTime, formatNumber as fmt } from "@/lib/formatters";

export const dynamic = "force-dynamic";

type PedidoInternoItem = {
  id: number;
  tipo: string;
  especificacao: string;
  modelo: string | null;
  volume: string | null;
  quantidade: number;
  unidade: string | null;
  /** 0123: "embalagem" = quantidade em frascos fechados de conteudo_embalagem. */
  quantidade_em?: string | null;
  conteudo_embalagem?: number | null;
  orcamento_previo: number | null;
  fornecedor_sugerido: string | null;
  observacao: string | null;
  insumo_id: number | null;
  quantidade_recebida: number | null;
  divergencia_recebimento: string | null;
  recebido_em: string | null;
  recebido_por: string | null;
  lote_id: number | null;
  insumos: { especificacao: string | null; unidade: string | null } | null;
  pedidos_internos_item_recebimentos?: PedidoInternoItemRecebimento[] | null;
};

type PedidoInternoItemRecebimento = {
  id: number;
  lote_id: number | null;
  quantidade: number;
  codigo_lote: string | null;
  fornecedor: string | null;
  validade: string | null;
  responsavel: string | null;
  recebido_em: string;
};

type InsumoPedidoRaw = {
  id: number;
  especificacao: string | null;
  nome_item?: string | null;
  categoria_compra?: string | null;
  unidade: string | null;
  unidade_consumo?: string | null;
  fabricante?: string | null;
  codigo_fabricante?: string | null;
  custo_unitario?: number | null;
  quantidade_embalagem?: number | null;
  custo_total_embalagem?: number | null;
  tipo_insumos?: { nome: string | null } | { nome: string | null }[] | null;
  fornecedores?: { nome: string | null } | { nome: string | null }[] | null;
};

type PedidoItemHistorico = {
  insumo_id: number | null;
  especificacao: string | null;
  unidade: string | null;
  modelo: string | null;
  volume: string | null;
  fornecedor_sugerido: string | null;
};

type FornecedorRaw = {
  nome: string | null;
};

type PedidoInternoAprovacao = {
  id: number;
  etapa: string;
  decisao: string;
  responsavel: string | null;
  papel: string | null;
  comentario: string | null;
  status_origem: string | null;
  status_destino: string | null;
  criado_em: string;
};

type PedidoInternoAnexo = {
  id: number;
  etapa: string | null;
  tipo: string;
  titulo: string;
  url: string | null;
  arquivo_nome?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
  tamanho_bytes?: number | null;
  hash_sha256?: string | null;
  observacao: string | null;
  usuario: string | null;
  criado_em: string;
  downloadUrl?: string | null;
};

type PedidoInternoComunicacao = {
  id: number;
  etapa: string | null;
  tipo: string;
  remetente: string | null;
  destinatarios: string | null;
  assunto: string | null;
  referencia: string | null;
  observacao: string | null;
  usuario: string | null;
  criado_em: string;
};

const URGENCIA_LABEL: Record<string, string> = {
  baixa: "Baixa",
  normal: "Normal",
  alta: "Alta",
  critica: "Crítica",
};

const ANEXO_TIPO_LABEL: Record<string, string> = {
  orcamento_previo: "Cotação prévia",
  proposta: "Cotação do fornecedor",
  print: "Print",
  email: "E-mail",
  termo_referencia: "Termo de referência",
  oficio: "Ofício",
  boleto: "Boleto",
  nota_fiscal: "Nota fiscal",
  comprovante: "Comprovante",
  outro: "Outro",
};

const COMUNICACAO_TIPO_LABEL: Record<string, string> = {
  email: "E-mail",
  reuniao: "Reunião",
  telefone: "Telefone",
  mensagem: "Mensagem",
  outro: "Outro",
};

const DECISAO_LABEL: Record<string, string> = {
  aprovado: "Aprovado",
  reprovado: "Reprovado",
  devolvido: "Devolvido",
  registrado: "Registrado",
};

/** Etapas e status gravados como código (ex.: "em_validacao") viram o rótulo do fluxo. */
function rotuloEtapa(valor: string | null | undefined) {
  if (!valor) return null;
  return PEDIDO_INTERNO_STATUS[valor as PedidoInternoStatus]?.label ?? valor;
}

function proximaAcaoDetalhe(status: string) {
  const map: Record<string, { acao: string; responsavel: string }> = {
    rascunho: { acao: "Enviar para validação", responsavel: "Solicitante" },
    ajuste_solicitante: { acao: "Corrigir pedido", responsavel: "Solicitante" },
    ajuste_compras: { acao: "Corrigir dados administrativos", responsavel: "Compras/Admin." },
    em_validacao: { acao: "Validar especificações", responsavel: "Coordenador do projeto" },
    validado: { acao: "Formalizar em compras", responsavel: "Coordenador/Compras" },
    formalizado: { acao: "Registrar análise administrativa", responsavel: "Administrativo" },
    analise_administrativa: { acao: "Aprovar para cotação", responsavel: "Coordenador/Admin." },
    aprovado_compra: { acao: "Registrar cotações", responsavel: "Compras/Admin." },
    orcamentos: { acao: "Anexar cotações", responsavel: "Compras/Admin." },
    orcamentos_recebidos: { acao: "Enviar para aprovação final", responsavel: "Coordenador" },
    aguardando_aprovacao_final: { acao: "Aprovar compra final", responsavel: "Coordenador" },
    aprovado_para_compra: { acao: "Definir modalidade", responsavel: "Compras/Admin." },
    compra_fechada: { acao: "Aguardar pagamento/NF", responsavel: "Compras/Admin." },
    encaminhado_instituicao: { acao: "Acompanhar instituição", responsavel: "Administrativo" },
    aguardando_pagamento_nf: { acao: "Anexar documento fiscal", responsavel: "Compras/Admin." },
    compra_concluida: { acao: "Processo concluído", responsavel: "—" },
    cancelado: { acao: "Processo encerrado", responsavel: "—" },
  };
  return map[status] ?? { acao: "Revisar pedido", responsavel: "Operação" };
}

function itemTipoLabel(tipo: string | null | undefined) {
  if (tipo === "servico") return "Serviço";
  if (tipo === "equipamento") return "Equipamento";
  return "Material";
}

function pushOpcao(map: Map<number, Set<string>>, id: number, value: string | null | undefined) {
  const valor = String(value ?? "").trim();
  if (!valor) return;
  const set = map.get(id) ?? new Set<string>();
  set.add(valor);
  map.set(id, set);
}

function primeiraRelacao<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function montarCatalogoItens(
  insumos: InsumoPedidoRaw[],
  historico: PedidoItemHistorico[],
  insumosLegado: Set<number>,
): PedidoItemCatalogo[] {
  const unidades = new Map<number, Set<string>>();
  const modelos = new Map<number, Set<string>>();
  const volumes = new Map<number, Set<string>>();
  const fornecedores = new Map<number, Set<string>>();

  for (const insumo of insumos) {
    pushOpcao(unidades, insumo.id, insumo.unidade);
    pushOpcao(unidades, insumo.id, insumo.unidade_consumo);
    pushOpcao(modelos, insumo.id, insumo.fabricante);
    pushOpcao(modelos, insumo.id, insumo.codigo_fabricante);
    pushOpcao(fornecedores, insumo.id, primeiraRelacao(insumo.fornecedores)?.nome);
    if (insumo.quantidade_embalagem && insumo.unidade) {
      pushOpcao(volumes, insumo.id, `${insumo.quantidade_embalagem} ${insumo.unidade}`);
    }
  }

  for (const item of historico) {
    if (!item.insumo_id) continue;
    pushOpcao(unidades, item.insumo_id, item.unidade);
    pushOpcao(modelos, item.insumo_id, item.modelo);
    pushOpcao(volumes, item.insumo_id, item.volume);
    pushOpcao(fornecedores, item.insumo_id, item.fornecedor_sugerido);
  }

  return insumos.map((insumo) => ({
    id: insumo.id,
    especificacao: insumo.especificacao,
    nomeItem: insumo.nome_item,
    categoriaCompra: insumo.categoria_compra,
    tipoInsumo: primeiraRelacao(insumo.tipo_insumos)?.nome,
    unidade: insumo.unidade,
    custoUnitario: insumo.custo_unitario,
    // Mesma regra de kontrol_private.modelo_quantidade_insumo (0123): conta em frascos
    // quando há volume do frasco e unidade, e não restam lotes antigos por volume.
    emFrascos: !insumosLegado.has(insumo.id) && Number(insumo.quantidade_embalagem) > 0 && Boolean(insumo.unidade?.trim()),
    conteudoEmbalagem: insumo.quantidade_embalagem ?? null,
    custoEmbalagem:
      insumo.custo_total_embalagem ??
      (insumo.custo_unitario != null && insumo.quantidade_embalagem
        ? insumo.custo_unitario * insumo.quantidade_embalagem
        : null),
    unidades: [...(unidades.get(insumo.id) ?? [])],
    modelos: [...(modelos.get(insumo.id) ?? [])],
    volumes: [...(volumes.get(insumo.id) ?? [])],
    fornecedores: [...(fornecedores.get(insumo.id) ?? [])],
  }));
}

function montarFornecedoresPedido(fornecedores: FornecedorRaw[], insumos: InsumoPedidoRaw[], historico: PedidoItemHistorico[]) {
  const opcoes = new Set<string>();
  for (const fornecedor of fornecedores) {
    const nome = String(fornecedor.nome ?? "").trim();
    if (nome) opcoes.add(nome);
  }
  for (const insumo of insumos) {
    const nome = String(primeiraRelacao(insumo.fornecedores)?.nome ?? "").trim();
    if (nome) opcoes.add(nome);
  }
  for (const item of historico) {
    const nome = String(item.fornecedor_sugerido ?? "").trim();
    if (nome) opcoes.add(nome);
  }
  return [...opcoes].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function Referencia({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/60 pb-2 last:border-b-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="max-w-48 text-right font-medium">{children}</dd>
    </div>
  );
}

export default async function PedidoInternoDetalhe({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pedidoId = Number(id);
  const supabase = await createClientUntyped();

  const { data: pedido } = await supabase
    .from("pedidos_internos")
    .select("*, projetos(nome), pedidos_compra(id, status)")
    .eq("id", pedidoId)
    .single();
  if (!pedido) notFound();

  const [
    { data: itens },
    { data: insumos },
    { data: historicoItens },
    { data: fornecedores },
    { data: projetos },
    { data: aprovacoes },
    { data: anexos },
    { data: comunicacoes },
    eventos,
    podeGerir,
    podeCancelar,
    podeRegistrarRecebimento,
  ] = await Promise.all([
    supabase
      .from("pedidos_internos_itens")
      .select("id, tipo, especificacao, modelo, volume, quantidade, unidade, quantidade_em, conteudo_embalagem, orcamento_previo, fornecedor_sugerido, observacao, insumo_id, quantidade_recebida, divergencia_recebimento, recebido_em, recebido_por, lote_id, insumos(especificacao, unidade), pedidos_internos_item_recebimentos(id, lote_id, quantidade, codigo_lote, fornecedor, validade, responsavel, recebido_em)")
      .eq("pedido_interno_id", pedidoId)
      .order("id"),
    supabase
      .from("insumos")
      .select("id, especificacao, nome_item, categoria_compra, unidade, unidade_consumo, fabricante, codigo_fabricante, custo_unitario, quantidade_embalagem, custo_total_embalagem, tipo_insumos(nome), fornecedores!insumos_fornecedor_id_fkey(nome)")
      .order("especificacao"),
    supabase
      .from("pedidos_internos_itens")
      .select("insumo_id, especificacao, unidade, modelo, volume, fornecedor_sugerido")
      .not("insumo_id", "is", null)
      .order("id", { ascending: false })
      .limit(500),
    supabase.from("fornecedores").select("nome").eq("ativo", true).order("nome"),
    supabase.from("projetos").select("id, nome, coordenador").order("nome"),
    supabase
      .from("pedidos_internos_aprovacoes")
      .select("id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino, criado_em")
      .eq("pedido_interno_id", pedidoId)
      .order("criado_em", { ascending: false }),
    supabase
      .from("pedidos_internos_anexos")
      .select("id, etapa, tipo, titulo, url, arquivo_nome, storage_bucket, storage_path, mime_type, tamanho_bytes, hash_sha256, observacao, usuario, criado_em")
      .eq("pedido_interno_id", pedidoId)
      .order("criado_em", { ascending: false }),
    supabase
      .from("pedidos_internos_comunicacoes")
      .select("id, etapa, tipo, remetente, destinatarios, assunto, referencia, observacao, usuario, criado_em")
      .eq("pedido_interno_id", pedidoId)
      .order("criado_em", { ascending: false }),
    listarEventos("pedido_interno", pedidoId),
    pode("pedido.aprovar"),
    pode("compras.cancelar"),
    pode("recebimento.registrar"),
  ]);

  const pedidoStatus = pedido.status as PedidoInternoStatus;
  const statusMeta = pedidoInternoStatus(pedidoStatus);
  const projetoRow = pedido.projetos as {
    nome: string | null;
    coordenador?: string | null;
    coordenador_nome?: string | null;
    coordenador_email?: string | null;
  } | null;
  const projeto = projetoRow?.nome ?? "—";
  const compraFormal = pedido.pedidos_compra as { id: number; status: string } | null;
  const coordenadorProjeto =
    pedido.coordenador_projeto_nome ??
    pedido.coordenador_projeto_email ??
    projetoRow?.coordenador_nome ??
    projetoRow?.coordenador ??
    projetoRow?.coordenador_email ??
    "—";
  const modalidadeLabel: Record<string, string> = {
    compra_direta: "Compra direta",
    fundacao: "Fundação",
    universidade: "Universidade",
    outra: "Outra",
  };
  const linhas = ((itens ?? []) as unknown as PedidoInternoItem[]) ?? [];
  const insumoRows = ((insumos ?? []) as unknown as InsumoPedidoRaw[]) ?? [];
  const historicoRows = ((historicoItens ?? []) as unknown as PedidoItemHistorico[]) ?? [];
  const { data: lotesLegado } = await supabase
    .from("lotes_estoque")
    .select("insumo_id")
    .neq("modelo_quantidade", "EMBALAGEM_FECHADA")
    .gt("quantidade_atual", 0);
  const catalogoItens = montarCatalogoItens(
    insumoRows,
    historicoRows,
    new Set(((lotesLegado ?? []) as { insumo_id: number }[]).map((lote) => lote.insumo_id)),
  );
  const fornecedoresPedido = montarFornecedoresPedido(((fornecedores ?? []) as unknown as FornecedorRaw[]) ?? [], insumoRows, historicoRows);
  const aprovacaoRows = ((aprovacoes ?? []) as unknown as PedidoInternoAprovacao[]) ?? [];
  const anexoRowsBase = ((anexos ?? []) as unknown as PedidoInternoAnexo[]) ?? [];
  const anexoRows = await Promise.all(anexoRowsBase.map(async (anexo) => {
    if (!anexo.storage_bucket || !anexo.storage_path) return anexo;
    const { data } = await supabase.storage
      .from(anexo.storage_bucket)
      .createSignedUrl(anexo.storage_path, 60 * 60);
    return { ...anexo, downloadUrl: data?.signedUrl ?? null };
  }));
  const comunicacaoRows = ((comunicacoes ?? []) as unknown as PedidoInternoComunicacao[]) ?? [];
  const total = linhas.reduce(
    (acc, item) => acc + Number(item.quantidade ?? 0) * Number(item.orcamento_previo ?? 0),
    0,
  );
  const editavel = ["rascunho", "ajuste_solicitante", "ajuste_compras"].includes(pedido.status);
  // Itens mudam em rascunho/ajuste e, antes da formalização, na validação (quem
  // aprova). Depois de formalizado, o pedido volta para ajuste antes de mudar a
  // lista (a compra formal acompanha). Mesma regra do servidor.
  const podeEditarItens = editavel || (podeGerir && ["em_validacao", "validado"].includes(pedido.status));
  const inputCls = "rounded-md border border-input bg-card px-3 py-2 text-sm";

  // Etapas: verde = superada, amarelo = em andamento, branco = futura.
  // Etapa 11 (recebimento) é derivada: o pedido está recebido quando tem itens e
  // todos foram recebidos individualmente.
  const recebido = linhas.length > 0 && linhas.every((item) => item.recebido_em);
  const aguardandoChegada = podeMarcarRecebida(pedidoStatus);
  // O fluxo de 10 etapas está concluído quando a compra avançou além da aprovação ou já foi recebida.
  const fluxoCompleto =
    recebido ||
    ["compra_fechada", "encaminhado_instituicao", "aguardando_pagamento_nf", "compra_concluida"].includes(pedidoStatus);
  // Etapa em andamento dentro do fluxo de 10 etapas (status de ajuste retornam à etapa equivalente).
  let etapaAtiva = PEDIDO_INTERNO_FLUXO.indexOf(pedidoStatus);
  if (etapaAtiva < 0 && pedidoStatus === "ajuste_solicitante") etapaAtiva = PEDIDO_INTERNO_FLUXO.indexOf("em_validacao");
  if (etapaAtiva < 0 && pedidoStatus === "ajuste_compras") etapaAtiva = PEDIDO_INTERNO_FLUXO.indexOf("analise_administrativa");
  const classeEtapa = (estado: "concluido" | "ativo" | "futuro") =>
    estado === "concluido"
      ? "border-leaf-300 bg-leaf-50 dark:border-leaf-900 dark:bg-leaf-950/30"
      : estado === "ativo"
        ? "border-warning-strong/30 bg-warning-soft"
        : "border-border bg-card";
  const estadoRecebida: "concluido" | "ativo" | "futuro" = recebido
    ? "concluido"
    : aguardandoChegada
      ? "ativo"
      : "futuro";
  const pendencias = [
    { label: "Projeto vinculado", ok: Boolean(pedido.projeto_id) },
    { label: "Justificativa preenchida", ok: Boolean(pedido.justificativa) },
    { label: "Fonte de recurso provável", ok: Boolean(pedido.fonte_recurso) },
    { label: "Urgência definida", ok: Boolean(pedido.urgencia) },
    { label: "Ao menos um item", ok: linhas.length > 0 },
    {
      label: "Itens com especificação, quantidade e unidade",
      ok: linhas.length > 0 && linhas.every((item) => item.especificacao && Number(item.quantidade) > 0 && item.unidade),
    },
  ];
  const rascunhoCompleto = pendencias.every((item) => item.ok);
  const temDocumentoCotacao = anexoRows.some((anexo) => ["orcamento_previo", "proposta", "print", "email"].includes(anexo.tipo));
  const temDocumentoFiscal = anexoRows.some((anexo) => ["nota_fiscal", "boleto", "comprovante"].includes(anexo.tipo));
  const itensFisicos = linhas.filter((item) => ["material", "equipamento"].includes(item.tipo));
  const itensRecebidos = itensFisicos.filter((item) => item.recebido_em).length;
  const proxima = proximaAcaoDetalhe(pedido.status);

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <Breadcrumbs items={[{ label: "Pedidos", href: "/pedido" }, { label: pedidoInternoNumero(pedido.id) }]} />
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-xs font-medium text-muted-foreground/80">{pedidoInternoNumero(pedido.id)}</p>
              <span className={`rounded-md px-2.5 py-1 text-xs font-medium ${statusMeta.className}`}>
                {statusMeta.label}
              </span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight">{pedido.titulo}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Projeto: {projeto} · Solicitante: {pedido.solicitante ?? "—"}
              {pedido.data_necessidade ? ` · Necessidade: ${formatDate(pedido.data_necessidade)}` : ""}
              {pedido.urgencia ? ` · Urgência: ${URGENCIA_LABEL[pedido.urgencia] ?? pedido.urgencia}` : ""}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Tipo: {String(pedido.tipo_demanda ?? "laboratorio").replaceAll("_", "/")} · Coordenador: {coordenadorProjeto}
              {pedido.aprovador_coordenador_diferente ? " · aprovado por substituto" : ""}
              {pedido.modalidade_compra ? ` · Modalidade: ${modalidadeLabel[pedido.modalidade_compra] ?? pedido.modalidade_compra}` : ""}
            </p>
            {pedido.justificativa && (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{pedido.justificativa}</p>
            )}
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <span className="text-xs text-muted-foreground">Atualizado {formatDateTime(pedido.atualizado_em)}</span>
            <PedidoInternoCabecalhoAcoes
              pedidoId={pedidoId}
              numero={pedidoInternoNumero(pedido.id)}
              titulo={pedido.titulo}
              projetoId={pedido.projeto_id}
              dataNecessidade={pedido.data_necessidade}
              urgencia={pedido.urgencia}
              tipoDemanda={pedido.tipo_demanda}
              fonteRecurso={pedido.fonte_recurso}
              justificativa={pedido.justificativa}
              projetos={projetos ?? []}
              status={pedido.status}
              podeExcluir={podeGerir}
            />
          </div>
        </div>

        <section className="mt-3 rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Etapas do processo</h2>
              <HelpTip title="Etapas do pedido">
                <p>
                  Mostra onde o pedido está. A próxima ação e quem responde por ela aparecem no{" "}
                  <b>Painel operacional</b>, logo abaixo.
                </p>
                <HelpLegend
                  items={[
                    { tom: "ok", rotulo: "Verde", texto: "etapa concluída" },
                    { tom: "atencao", rotulo: "Amarelo", texto: "etapa atual" },
                    { tom: "neutro", rotulo: "Branco", texto: "etapa futura" },
                  ]}
                />
              </HelpTip>
            </div>
            <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{statusMeta.label}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
            {PEDIDO_INTERNO_FLUXO.map((status, index) => {
              const meta = pedidoInternoStatus(status);
              const estado: "concluido" | "ativo" | "futuro" =
                fluxoCompleto || (etapaAtiva >= 0 && index < etapaAtiva)
                  ? "concluido"
                  : etapaAtiva === index
                    ? "ativo"
                    : "futuro";
              return (
                <div key={status} className={`min-h-16 rounded-md border px-3 py-2 ${classeEtapa(estado)}`}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">Etapa {index + 1}</p>
                  <p className="mt-0.5 text-sm font-medium">{meta.label}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted-foreground">{meta.etapa}</p>
                </div>
              );
            })}
            <div className={`min-h-16 rounded-md border px-3 py-2 ${classeEtapa(estadoRecebida)}`}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                Etapa {PEDIDO_INTERNO_FLUXO.length + 1}
              </p>
              <p className="mt-0.5 text-sm font-medium">{PEDIDO_INTERNO_ETAPA_RECEBIDA.label}</p>
              <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted-foreground">{PEDIDO_INTERNO_ETAPA_RECEBIDA.etapa}</p>
            </div>
          </div>
          {pedido.status === "ajuste_solicitante" && (
            <p className="mt-3 text-sm text-warning-strong">
              Compra não aprovada na validação. Revise os itens com o solicitante e reenvie.
            </p>
          )}
          {pedido.status === "ajuste_compras" && (
            <p className="mt-3 text-sm text-danger-strong">
              Compra não aprovada na análise administrativa. Revise com compras e/ou solicitante.
            </p>
          )}
        </section>

        <section className="mt-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-1">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Materiais, serviços e equipamentos</h2>
                <HelpTip title="Itens do pedido">
                  <p>
                    Monte a lista antes de enviar para validação. O valor <b>prévio</b> é uma estimativa;
                    o preço final vem da cotação.
                  </p>
                </HelpTip>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">Total prévio: <b>{brl(total)}</b></p>
          </div>

          <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-transparent text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Item</th>
                  <th className="px-4 py-3 text-left">Modelo/volume</th>
                  <th className="px-4 py-3 text-right">Qtd</th>
                  <th className="px-4 py-3 text-right">Prévio un.</th>
                  <th className="px-4 py-3 text-left">Fornecedor</th>
                  <th className="px-4 py-3 text-left">Recebimento</th>
                  {podeEditarItens && <th className="px-4 py-3 text-right">Ação</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {linhas.map((item) => (
                  <tr key={item.id}>
                    <td className="max-w-sm px-4 py-2.5">
                      <p className="font-medium">{item.especificacao}</p>
                      <p className="text-xs text-muted-foreground">
                        {itemTipoLabel(item.tipo)}
                        {item.insumos?.especificacao ? ` · vinculado: ${item.insumos.especificacao}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {[item.modelo, item.volume].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {item.quantidade_em === "embalagem" && item.conteudo_embalagem
                        ? `${fmt(item.quantidade)} ${Number(item.quantidade) === 1 ? "frasco" : "frascos"} de ${fmt(item.conteudo_embalagem)} ${item.insumos?.unidade ?? ""}`.trim()
                        : `${fmt(item.quantidade)} ${item.unidade ?? item.insumos?.unidade ?? ""}`}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{brl(item.orcamento_previo)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{item.fornecedor_sugerido ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <ItemRecebimentoCell
                        item={{
                          id: item.id,
                          pedidoId,
                          especificacao: item.especificacao,
                          quantidade: Number(item.quantidade),
                          quantidadeRecebida: item.quantidade_recebida,
                          compraFormalId: compraFormal?.id ?? null,
                          unidade: item.unidade ?? item.insumos?.unidade ?? null,
                          insumoId: item.insumo_id,
                          fornecedorSugerido: item.fornecedor_sugerido,
                          orcamentoPrevio: item.orcamento_previo,
                        }}
                        insumos={catalogoItens}
                        podeReceber={aguardandoChegada && !compraFormal && podeRegistrarRecebimento}
                        recebidoEm={item.recebido_em}
                        recebidoPor={item.recebido_por}
                        recebimentos={(item.pedidos_internos_item_recebimentos ?? [])
                          .map((recebimento) => ({
                            id: recebimento.id,
                            loteId: recebimento.lote_id,
                            quantidade: Number(recebimento.quantidade),
                            codigoLote: recebimento.codigo_lote,
                            fornecedor: recebimento.fornecedor,
                            validade: recebimento.validade,
                            responsavel: recebimento.responsavel,
                            recebidoEm: recebimento.recebido_em,
                          }))
                          .sort((a, b) => Date.parse(b.recebidoEm) - Date.parse(a.recebidoEm))}
                      />
                      {item.lote_id && (
                        <Link href={`/estoque/lotes/${item.lote_id}`} className="mt-1 block text-xs text-primary hover:underline">
                          Lote #{item.lote_id}
                        </Link>
                      )}
                      {item.divergencia_recebimento && (
                        <p className="mt-1 text-[11px] text-warning-strong">{item.divergencia_recebimento}</p>
                      )}
                      {aguardandoChegada && compraFormal && !item.recebido_em && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Receber pela <Link href={`/compras/${compraFormal.id}`} className="text-primary hover:underline">compra formal</Link>.
                        </p>
                      )}
                    </td>
                    {podeEditarItens && (
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <PedidoItemEditar pedidoId={pedidoId} item={item} catalogo={catalogoItens} fornecedores={fornecedoresPedido} />
                          <FormComMensagem action={removerItemPedidoInterno} className="flex flex-col items-end">
                            <input type="hidden" name="item_id" value={item.id} />
                            <input type="hidden" name="pedido_interno_id" value={pedidoId} />
                            <button className="text-xs text-danger-strong hover:underline">Remover</button>
                          </FormComMensagem>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {linhas.length === 0 && (
                  <tr>
                    <td colSpan={podeEditarItens ? 7 : 6} className="px-4 py-6 text-center text-muted-foreground/80">
                      Nenhum material, serviço ou equipamento informado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {editavel && (
            <FormComMensagem action={adicionarItemPedidoInterno} className="mt-3 grid gap-2 rounded-lg border border-border bg-card p-3 shadow-sm">
              <input type="hidden" name="pedido_interno_id" value={pedidoId} />
              <div className="grid gap-3 md:grid-cols-12">
                <PedidoItemCamposAssistidos catalogo={catalogoItens} fornecedores={fornecedoresPedido} idPrefix="novo-item" />
                <div className="flex items-end md:col-span-4 xl:col-span-2">
                  <button className="h-9 w-full rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                    Adicionar item
                  </button>
                </div>
              </div>
            </FormComMensagem>
          )}
          {editavel && (
            <div className="mt-3 rounded-lg border border-border bg-card p-3 shadow-sm">
              {/* Em larguras médias (~1024 px com a barra lateral) a lista e as ações não cabem lado a lado: empilham. */}
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Conferência do rascunho</h3>
                  <div className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {pendencias.map((item) => (
                      <div key={item.label} className="flex items-start gap-2 text-xs">
                        <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${item.ok ? "bg-brand-500" : "bg-warning-strong"}`} />
                        <span className={item.ok ? "text-muted-foreground" : "font-medium text-warning-strong"}>
                          {item.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex justify-start border-t border-border/70 pt-3 xl:justify-end xl:border-t-0 xl:pt-0">
                  <PedidoInternoAcoes
                    pedidoId={pedidoId}
                    status={pedido.status}
                    podeGerir={podeGerir}
                    podeCancelar={podeCancelar}
                    temCompraFormal={Boolean(compraFormal)}
                    podeEnviarValidacao={rascunhoCompleto}
                  />
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="mt-4 grid items-start gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,.85fr)]">
          <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Painel operacional</p>
                <h2 className="mt-0.5 text-base font-semibold">{proxima.acao}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Responsável: <b className="font-medium text-foreground">{proxima.responsavel}</b>
                </p>
              </div>
              <div className="grid min-w-64 grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                  <p className="text-muted-foreground">Itens</p>
                  <p className="text-base font-semibold tabular-nums">{linhas.length}</p>
                </div>
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                  <p className="text-muted-foreground">Recebidos</p>
                  <p className="text-base font-semibold tabular-nums">{itensFisicos.length ? `${itensRecebidos}/${itensFisicos.length}` : "—"}</p>
                </div>
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                  <p className="text-muted-foreground">Prévio</p>
                  <p className="text-base font-semibold tabular-nums">{brl(total)}</p>
                </div>
              </div>
            </div>
            <div className="mt-3 border-t border-border/70 pt-3">
              {statusMeta && !editavel && (
                <PedidoInternoAcoes
                  pedidoId={pedidoId}
                  status={pedido.status}
                  podeGerir={podeGerir}
                  podeEnviarValidacao={rascunhoCompleto}
                />
              )}
              {editavel && (
                <p className="text-sm text-muted-foreground">
                  O pedido ainda está em rascunho. A ação de envio fica no fechamento da lista de itens.
                </p>
              )}
              {!podeGerir && !["rascunho", "ajuste_solicitante", "ajuste_compras"].includes(pedido.status) && (
                <p className="text-sm text-muted-foreground/80">Esta etapa exige a permissão “Aprovar pedidos internos”.</p>
              )}
            </div>
            {pedido.status === "formalizado" && podeGerir && (
              <FormComMensagem action={registrarAnaliseAdministrativa} className="mt-5 grid gap-3 rounded-lg border border-border bg-muted/20 p-4 md:grid-cols-2">
                <input type="hidden" name="pedido_interno_id" value={pedidoId} />
                <div className="md:col-span-2">
                  <h3 className="text-sm font-semibold">Análise administrativa</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">Confirme recurso, rubrica e conformidade antes de liberar cotação.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground">Fonte do recurso</label>
                  <input name="fonte_recurso" required defaultValue={pedido.fonte_recurso ?? ""} className={`${inputCls} mt-1 w-full`} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground">Rubrica</label>
                  <input name="rubrica" required defaultValue={pedido.rubrica ?? ""} className={`${inputCls} mt-1 w-full`} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground">Conformidades administrativas</label>
                  <textarea name="conformidade_admin" required defaultValue={pedido.conformidade_admin ?? ""} rows={3} className={`${inputCls} mt-1 w-full`} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground">Observação</label>
                  <input name="observacao" defaultValue={pedido.observacao_compras ?? ""} className={`${inputCls} mt-1 w-full`} />
                </div>
                <div className="md:col-span-2">
                  <SubmitButton pendingLabel="Registrando…" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                    Registrar análise administrativa
                  </SubmitButton>
                </div>
              </FormComMensagem>
            )}
            {aguardandoChegada && (
              <div className="mt-3 rounded-lg border border-leaf-300 bg-leaf-50 p-3 text-sm text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/30 dark:text-leaf-300">
                <span className="inline-flex items-center gap-1">
                  <span>
                    Receba os itens na tabela ou em{" "}
                    <Link href="/recebimento" className="font-medium underline">
                      Recebimento
                    </Link>
                    .
                  </span>
                  <HelpTip title="Quando o recebimento termina">
                    <p>
                      A etapa de recebimento só fecha quando <b>todos</b> os materiais e equipamentos do
                      pedido forem lançados no estoque.
                    </p>
                  </HelpTip>
                </span>
              </div>
            )}
          </div>

          <aside className="rounded-lg border border-border bg-card p-3 text-sm shadow-sm">
            <h2 className="text-sm font-semibold">Referências operacionais</h2>
            <dl className="mt-2 grid gap-x-5 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Referencia label="Compra formal">
                {compraFormal ? (
                  <Link href={`/compras/${compraFormal.id}`} className="text-primary hover:underline">
                    #{compraFormal.id} · {statusInfo(compraFormal.status).label}
                  </Link>
                ) : "—"}
              </Referencia>
              <Referencia label="Modalidade">{pedido.modalidade_compra ? modalidadeLabel[pedido.modalidade_compra] ?? pedido.modalidade_compra : "—"}</Referencia>
              <Referencia label="Instituição">{pedido.instituicao_destino ?? "—"}</Referencia>
              <Referencia label="Protocolo">{pedido.protocolo_externo ?? "—"}</Referencia>
              <Referencia label="Fonte">{pedido.fonte_recurso ?? "—"}</Referencia>
              <Referencia label="Rubrica">{pedido.rubrica ?? "—"}</Referencia>
              <Referencia label="Doc. cotação">{temDocumentoCotacao ? "registrado" : "pendente"}</Referencia>
              <Referencia label="Doc. fiscal">{temDocumentoFiscal ? "registrado" : "pendente"}</Referencia>
            </dl>
            <div className="mt-3 border-t border-border/70 pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Checklist da etapa</h3>
              <div className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {pendencias.map((item) => (
                  <div key={item.label} className="flex items-center gap-2 text-xs">
                    <span className={`h-2.5 w-2.5 rounded-full ${item.ok ? "bg-brand-500" : "bg-warning-strong"}`} />
                    <span className={item.ok ? "text-muted-foreground" : "font-medium text-warning-strong"}>
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </section>

        <section className="mt-4 grid items-start gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Documentos</h2>
                <p className="mt-1 text-xs text-muted-foreground">Cotações, termos, ofícios, boletos, notas e comprovantes.</p>
              </div>
              <span className={`rounded-md px-2 py-1 text-xs ${temDocumentoCotacao ? "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300" : "bg-warning-soft text-warning-strong"}`}>
                {anexoRows.length} anexo(s)
              </span>
            </div>

            <div className="mt-3 space-y-2">
              {anexoRows.map((anexo) => (
                <div key={anexo.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{anexo.titulo}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {ANEXO_TIPO_LABEL[anexo.tipo] ?? anexo.tipo} · {rotuloEtapa(anexo.etapa) ?? "sem etapa"} · {formatDateTime(anexo.criado_em)}
                      </p>
                      {anexo.downloadUrl || anexo.url ? (
                        <a href={(anexo.downloadUrl ?? anexo.url) as string} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-primary hover:underline">
                          {anexo.downloadUrl ? "Abrir arquivo" : "Abrir referência"}
                        </a>
                      ) : anexo.storage_path ? (
                        <span className="mt-1 inline-block cursor-not-allowed text-xs text-muted-foreground/80" aria-disabled="true">
                          Arquivo indisponível no momento
                        </span>
                      ) : null}
                      {(anexo.arquivo_nome || anexo.storage_path) && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {anexo.arquivo_nome ?? "Arquivo preparado"}
                          {anexo.mime_type ? ` · ${anexo.mime_type}` : ""}
                          {anexo.tamanho_bytes ? ` · ${Math.round(anexo.tamanho_bytes / 1024)} KB` : ""}
                        </p>
                      )}
                      {anexo.observacao && <p className="mt-1 text-xs text-muted-foreground">{anexo.observacao}</p>}
                    </div>
                    {editavel && (
                      <FormComMensagem action={removerAnexoPedidoInterno} className="text-right">
                        <input type="hidden" name="anexo_id" value={anexo.id} />
                        <input type="hidden" name="pedido_interno_id" value={pedidoId} />
                        <ConfirmSubmitButton
                          className="text-xs text-danger-strong hover:underline"
                          titulo="Remover o documento?"
                          mensagem={`"${anexo.titulo}" sai da lista de documentos deste pedido e o arquivo é apagado.`}
                          confirmLabel="Remover"
                          destrutivo
                        >
                          Remover
                        </ConfirmSubmitButton>
                      </FormComMensagem>
                    )}
                  </div>
                </div>
              ))}
              {anexoRows.length === 0 && <p className="text-sm text-muted-foreground/80">Nenhum documento registrado.</p>}
            </div>

            <details className="mt-3 border-t border-border/70 pt-3">
              <summary className="cursor-pointer text-xs font-medium text-primary hover:underline">Registrar documento</summary>
              <FormComMensagem action={adicionarAnexoPedidoInterno} encType="multipart/form-data" className="mt-3 grid gap-3 md:grid-cols-2">
                <input type="hidden" name="pedido_interno_id" value={pedidoId} />
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Tipo</label>
                  <select name="tipo" defaultValue="orcamento_previo" className={`${inputCls} mt-1 w-full`}>
                    <option value="orcamento_previo">Cotação prévia</option>
                    <option value="proposta">Cotação do fornecedor</option>
                    <option value="print">Print</option>
                    <option value="email">E-mail</option>
                    <option value="termo_referencia">Termo de referência</option>
                    <option value="oficio">Ofício</option>
                    <option value="boleto">Boleto</option>
                    <option value="nota_fiscal">Nota fiscal</option>
                    <option value="comprovante">Comprovante</option>
                    <option value="outro">Outro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Título</label>
                  <input name="titulo" required className={`${inputCls} mt-1 w-full`} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Arquivo</label>
                  <input name="arquivo" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.docx,.xlsx" className={`${inputCls} mt-1 w-full`} />
                  <p className="mt-1 text-[11px] text-muted-foreground">PDF, imagem, DOCX ou XLSX, até 15 MB.</p>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Link ou referência externa (opcional)</label>
                  <input name="url" placeholder="https://..." className={`${inputCls} mt-1 w-full`} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Observação</label>
                  <input name="observacao" className={`${inputCls} mt-1 w-full`} />
                </div>
                <div className="md:col-span-2">
                  <SubmitButton pendingLabel="Enviando…" className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                    Registrar documento
                  </SubmitButton>
                </div>
              </FormComMensagem>
            </details>
          </div>

          <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Comunicações</h2>
            <p className="mt-1 text-xs text-muted-foreground">Registro interno de e-mails, reuniões, mensagens e encaminhamentos.</p>

            <div className="mt-3 space-y-2">
              {comunicacaoRows.map((comunicacao) => (
                <div key={comunicacao.id} className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-medium">{comunicacao.assunto ?? COMUNICACAO_TIPO_LABEL[comunicacao.tipo] ?? comunicacao.tipo}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {COMUNICACAO_TIPO_LABEL[comunicacao.tipo] ?? comunicacao.tipo} · {comunicacao.remetente ?? "—"} → {comunicacao.destinatarios ?? "—"} · {formatDateTime(comunicacao.criado_em)}
                  </p>
                  {comunicacao.referencia && <p className="mt-1 text-xs text-primary">{comunicacao.referencia}</p>}
                  {comunicacao.observacao && <p className="mt-1 text-xs text-muted-foreground">{comunicacao.observacao}</p>}
                </div>
              ))}
              {comunicacaoRows.length === 0 && <p className="text-sm text-muted-foreground/80">Nenhuma comunicação registrada.</p>}
            </div>

            <details className="mt-3 border-t border-border/70 pt-3">
              <summary className="cursor-pointer text-xs font-medium text-primary hover:underline">Registrar comunicação</summary>
              <FormComMensagem action={registrarComunicacaoPedidoInterno} className="mt-3 grid gap-3 md:grid-cols-2">
                <input type="hidden" name="pedido_interno_id" value={pedidoId} />
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Tipo</label>
                  <select name="tipo" defaultValue="email" className={`${inputCls} mt-1 w-full`}>
                    <option value="email">E-mail</option>
                    <option value="reuniao">Reunião</option>
                    <option value="telefone">Telefone</option>
                    <option value="mensagem">Mensagem</option>
                    <option value="outro">Outro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Remetente</label>
                  <input name="remetente" defaultValue="giacompras2025@gmail.com" className={`${inputCls} mt-1 w-full`} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Destinatários</label>
                  <input name="destinatarios" className={`${inputCls} mt-1 w-full`} />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Assunto</label>
                  <input name="assunto" className={`${inputCls} mt-1 w-full`} />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Referência</label>
                  <input name="referencia" placeholder="ID da mensagem, protocolo, link..." className={`${inputCls} mt-1 w-full`} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Observação</label>
                  <input name="observacao" className={`${inputCls} mt-1 w-full`} />
                </div>
                <div className="md:col-span-2">
                  <SubmitButton pendingLabel="Registrando…" className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                    Registrar comunicação
                  </SubmitButton>
                </div>
              </FormComMensagem>
            </details>
          </div>
        </section>

        <section className="mt-8 rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Aprovações e decisões</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {aprovacaoRows.map((aprovacao) => (
              <div key={aprovacao.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{rotuloEtapa(aprovacao.etapa) ?? "—"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {aprovacao.responsavel ?? "—"} · {aprovacao.papel ?? "—"} · {formatDateTime(aprovacao.criado_em)}
                    </p>
                  </div>
                  <span className="rounded-md bg-muted px-2 py-1 text-xs">{DECISAO_LABEL[aprovacao.decisao] ?? aprovacao.decisao}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {rotuloEtapa(aprovacao.status_origem) ?? "início"} → {rotuloEtapa(aprovacao.status_destino) ?? "—"}
                </p>
                {aprovacao.comentario && (
                  <p className="mt-2 text-xs leading-5 text-foreground">{aprovacao.comentario}</p>
                )}
              </div>
            ))}
            {aprovacaoRows.length === 0 && (
              <p className="text-sm text-muted-foreground/80">Nenhuma aprovação formal registrada ainda.</p>
            )}
          </div>
        </section>

        <section className="mt-8 rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Linha do tempo</h2>
          <div className="mt-3">
            <Timeline eventos={eventos} />
          </div>
        </section>
      </main>
    </div>
  );
}
