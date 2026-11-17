import { createClientUntyped } from "@/lib/supabase/server";
import { lerEquivalentesComSaldo } from "@/lib/estoque/equivalentes";
import { lerEstoqueParaPedido } from "@/lib/estoque/estoque-para-pedido";
import { pode } from "@/lib/auth/permissao-efetiva";
import { usuarioAtual } from "@/lib/auth/roles";
import {
  aguardaLaboratorio,
  etapasAprovacao,
  lerAprovadores,
  travaDoEnvio,
  motivoProprioPedido,
  usuarioDecide,
} from "@/lib/pedido/aprovadores";
import { lerAreasPedido } from "@/lib/pedido/areas";
import {
  ETAPAS_ANTES_DO_PAGAMENTO,
  lerPendenciaPagamento,
  podeConfirmarEntrega,
} from "@/lib/pedido/pagamento";
import { ETAPAS_COM_ORCAMENTOS, lerOrcamentos, resumirOrcamentos } from "@/lib/pedido/orcamentos";
import {
  datasDoCiclo,
  cicloLiberaEm,
  dataEmBrasilia,
  ehUrgente,
  faltaJustificativaUrgencia,
  motivoCicloTravado,
} from "@/lib/pedido/ciclo";
import { PedidoTrilha } from "@/components/pedido/PedidoTrilha";
import { etapaDoPedido } from "@/lib/pedido/etapas";
import { proximoPasso } from "@/lib/pedido/proximo-passo";
import { Timeline } from "@/components/common/Timeline";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { avisoControlados, itensControlados } from "@/lib/pedido/controlados";
import { STATUS_DE_AJUSTE, lerSituacaoReenvio, textoReenvio } from "@/lib/pedido/reenvio";
import { listarEventos } from "@/lib/actions/eventos";
import {
  pedidoInternoNumero,
  pedidoInternoSituacao,
  podeMarcarRecebida,
  type PedidoInternoStatus,
} from "@/lib/pedido/status";
import { AvisoLeitura } from "@/components/common/AvisoLeitura";
import { novaLeitura, semRegistro } from "@/lib/supabase/leitura";
import {
  type FornecedorRaw,
  type InsumoPedidoRaw,
  type PedidoInternoAnexo,
  type PedidoInternoAprovacao,
  type PedidoInternoComunicacao,
  type PedidoInternoItem,
  type PedidoItemHistorico,
  montarCatalogoItens,
  montarFornecedoresPedido,
} from "@/lib/pedido/detalhe";
import {
  COLUNAS_ITEM_COMPRA_DO_PEDIDO,
  chegadasPelaCompra,
  type ItemCompraDoPedidoRaw,
} from "@/lib/pedido/chegada-pela-compra";
import {
  COLUNAS_COMPRA_DO_PEDIDO,
  pedidoMostraPainelDaCompra,
  chegadaDaCompra,
  type CompraDoPedido,
} from "@/lib/pedido/compra-do-pedido";
import { PedidoCabecalho } from "@/components/pedido/detalhe/PedidoCabecalho";
import { PedidoCompraPainel } from "@/components/pedido/detalhe/PedidoCompraPainel";
import { PedidoPainelAgora } from "@/components/pedido/detalhe/PedidoPainelAgora";
import { PedidoResumo } from "@/components/pedido/detalhe/PedidoResumo";
import { PedidoItens } from "@/components/pedido/detalhe/PedidoItens";
import { PedidoDocumentos } from "@/components/pedido/detalhe/PedidoDocumentos";
import { PedidoComunicacoes } from "@/components/pedido/detalhe/PedidoComunicacoes";
import { PedidoAprovacoes } from "@/components/pedido/detalhe/PedidoAprovacoes";

export const dynamic = "force-dynamic";

export default async function PedidoInternoDetalhe({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** aviso: o "Novo pedido" gravou o pedido, mas os itens ou o envio não saíram */
  searchParams?: Promise<{ aviso?: string }>;
}) {
  const leitura = novaLeitura("/pedido/[id]");
  const { id } = await params;
  const { aviso } = (await searchParams) ?? {};
  const pedidoId = Number(id);
  const supabase = await createClientUntyped();

  const { data: pedido } = await leitura.de("pedidos", supabase
    .from("pedidos_internos")
    .select(`*, projetos(nome), pedidos_compra(${COLUNAS_COMPRA_DO_PEDIDO})`)
    .eq("id", pedidoId)
    .single());
  if (!pedido) semRegistro(leitura);

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
    aprovadores,
    areas,
    usuario,
    podeReceberCompra,
    { data: locais },
    { data: itensDaCompra },
    podeAprovarCompra,
    podeUrgencia,
    podeEstornar,
  ] = await Promise.all([
    leitura.de("itens do pedido", supabase
      .from("pedidos_internos_itens")
      .select("id, tipo, especificacao, modelo, volume, quantidade, unidade, quantidade_em, conteudo_embalagem, orcamento_previo, fornecedor_sugerido, observacao, caracteristicas, exigencia_tecnica, exclusividade, outros_fornecedores, insumo_id, quantidade_recebida, divergencia_recebimento, recebido_em, recebido_por, lote_id, insumos(especificacao, unidade, controlado, codigo_fabricante), pedidos_internos_item_recebimentos(id, lote_id, quantidade, codigo_lote, fornecedor, validade, responsavel, recebido_em)")
      .eq("pedido_interno_id", pedidoId)
      .order("id")),
    leitura.de("insumos", supabase
      .from("insumos")
      .select("id, especificacao, nome_item, categoria_compra, unidade, unidade_consumo, fabricante, codigo_fabricante, custo_unitario, quantidade_embalagem, custo_total_embalagem, sinonimos, tipo_insumos(nome), fornecedores!insumos_fornecedor_id_fkey(nome)")
      .eq("ativo", true)
      .order("especificacao")),
    leitura.de("itens do pedido", supabase
      .from("pedidos_internos_itens")
      .select("insumo_id, especificacao, unidade, modelo, volume, fornecedor_sugerido")
      .not("insumo_id", "is", null)
      .order("id", { ascending: false })
      .limit(500)),
    leitura.de("fornecedores", supabase.from("fornecedores").select("id, nome").eq("ativo", true).order("nome")),
    leitura.de("projetos", supabase.from("projetos").select("id, nome, coordenador").order("nome")),
    leitura.de("aprovações do pedido", supabase
      .from("pedidos_internos_aprovacoes")
      .select("id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino, criado_em")
      .eq("pedido_interno_id", pedidoId)
      .order("criado_em", { ascending: false })),
    leitura.de("documentos do pedido", supabase
      .from("pedidos_internos_anexos")
      .select("id, etapa, tipo, titulo, url, arquivo_nome, storage_bucket, storage_path, mime_type, tamanho_bytes, hash_sha256, observacao, usuario, criado_em")
      .eq("pedido_interno_id", pedidoId)
      .order("criado_em", { ascending: false })),
    leitura.de("mensagens do pedido", supabase
      .from("pedidos_internos_comunicacoes")
      .select("id, etapa, tipo, remetente, destinatarios, assunto, referencia, observacao, usuario, criado_em")
      .eq("pedido_interno_id", pedidoId)
      .order("criado_em", { ascending: false })),
    listarEventos("pedido_interno", pedidoId),
    pode("pedido.aprovar"),
    pode("compras.cancelar"),
    pode("recebimento.registrar"),
    lerAprovadores(supabase, pedidoId),
    lerAreasPedido(supabase),
    usuarioAtual(),
    pode("compras.receber"),
    leitura.de("locais", supabase.from("locais").select("id, nome").order("nome")),
    // chegada única: item que virou compra é recebido aqui, pelo item da compra
    pedido.pedido_compra_id
      ? leitura.de("itens da compra", supabase
          .from("pedidos_compra_itens")
          .select(COLUNAS_ITEM_COMPRA_DO_PEDIDO)
          .eq("pedido_id", pedido.pedido_compra_id)
          .order("id"))
      : Promise.resolve({ data: [] }),
    pode("compras.aprovar"),
    pode("pedido.urgencia"),
    pode("estoque.lote.gerir"),
  ]);

  const pedidoStatus = pedido.status as PedidoInternoStatus;
  // 0169: validado de material de laboratório ainda espera o laboratório
  const statusMeta = pedidoInternoSituacao(pedido);
  const esperaLaboratorio = aguardaLaboratorio(pedido);
  const ehAdmin = usuario?.papel === "admin";
  const podeValidar = usuarioDecide(aprovadores?.coordenador?.ids, usuario?.id, ehAdmin);
  const podeDecidirLaboratorio = esperaLaboratorio && usuarioDecide(aprovadores?.laboratorio?.ids, usuario?.id, ehAdmin);
  // 0136 (D2), mesma regra do banco: quem pediu não dá a aprovação final do próprio pedido
  const motivoProprio = motivoProprioPedido({
    solicitante: pedido.solicitante,
    emailUsuario: usuario?.email,
    ehAdmin,
    coordenaProjeto: pedido.projeto_id != null && usuarioDecide(aprovadores?.coordenador?.ids, usuario?.id, false),
  });
  const etapasQuemAprova = etapasAprovacao(aprovadores, pedido);
  const travaEnvio = travaDoEnvio(aprovadores);
  // D6 (0170): pagamento só depois da entrega
  const pendenciaPagamento = ETAPAS_ANTES_DO_PAGAMENTO.includes(pedido.status)
    ? await lerPendenciaPagamento(supabase, pedidoId)
    : null;
  // D2 (0171): três orçamentos de fornecedores diferentes e um escolhido
  const comOrcamentos = ETAPAS_COM_ORCAMENTOS.includes(pedido.status);
  const orcamentos = comOrcamentos ? await lerOrcamentos(supabase, pedidoId) : null;
  const resumoOrcamentos = orcamentos ? resumirOrcamentos(orcamentos) : null;
  // D5 (0175): o que acontece ao reenviar depois do ajuste
  const avisoReenvio = STATUS_DE_AJUSTE.includes(String(pedido.status))
    ? textoReenvio(await lerSituacaoReenvio(supabase, pedidoId))
    : null;
  const projetoRow = pedido.projetos as {
    nome: string | null;
    coordenador?: string | null;
    coordenador_nome?: string | null;
    coordenador_email?: string | null;
  } | null;
  const projeto = projetoRow?.nome ?? "—";
  const compraFormal = pedido.pedidos_compra as CompraDoPedido | null;
  // Quem aprovou fica gravado no pedido; antes disso vale o que o banco aponta
  // (usuário coordenador do projeto), nunca o nome escrito à mão no cadastro.
  const coordenadorProjeto =
    pedido.coordenador_projeto_nome ??
    pedido.coordenador_projeto_email ??
    aprovadores?.coordenador?.nome ??
    (aprovadores?.falta_coordenador ? "não indicado" : "—");
  const modalidadeLabel: Record<string, string> = {
    compra_direta: "Compra direta",
    fundacao: "Fundação",
    universidade: "Universidade",
    outra: "Outra",
  };
  const linhas = ((itens ?? []) as unknown as PedidoInternoItem[]) ?? [];
  // D9 (0174): controlado só pela FUNPAR (o banco também trava)
  const controlados = itensControlados(linhas);
  const avisoControlado = avisoControlados(controlados);
  const podeConfirmar =
    (podeRegistrarRecebimento || podeGerir) && podeConfirmarEntrega(pedido, linhas);
  // Antes da compra, aponta outra marca do mesmo tipo técnico que já tem saldo (item 8).
  const antesDaCompra = ["rascunho", "em_validacao", "validado", "ajuste_solicitante", "ajuste_compras"].includes(String(pedido.status));
  const { equivalentes } = antesDaCompra
    ? await lerEquivalentesComSaldo(supabase, linhas.map((l) => l.insumo_id).filter((id): id is number => id != null))
    : { equivalentes: new Map<number, never[]>() };
  const insumoRows = ((insumos ?? []) as unknown as InsumoPedidoRaw[]) ?? [];
  const historicoRows = ((historicoItens ?? []) as unknown as PedidoItemHistorico[]) ?? [];
  const { data: lotesLegado } = await leitura.de("lotes", supabase
    .from("lotes_estoque")
    .select("insumo_id")
    .neq("modelo_quantidade", "EMBALAGEM_FECHADA")
    .gt("quantidade_atual", 0));
  // Estoque na hora de pedir: só enquanto ainda se mexe nos itens antes da compra.
  // Leitura incompleta não vira "sem saldo": o quadro simplesmente não aparece.
  const leituraEstoque = antesDaCompra ? await lerEstoqueParaPedido(supabase) : null;
  const estoqueParaPedido = leituraEstoque && !leituraEstoque.erro ? leituraEstoque.estoque : null;
  const catalogoItens = montarCatalogoItens(
    insumoRows,
    historicoRows,
    new Set(((lotesLegado ?? []) as { insumo_id: number }[]).map((lote) => lote.insumo_id)),
  ).map((item) => (estoqueParaPedido ? { ...item, estoque: estoqueParaPedido.get(item.id) ?? null } : item));
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

  // Recebimento é uma marca paralela: o pedido está recebido quando tem itens e
  // todos foram recebidos individualmente.
  const aguardandoChegada = podeMarcarRecebida(pedidoStatus);
  const chegadasCompra =
    aguardandoChegada && podeReceberCompra
      ? chegadasPelaCompra((itensDaCompra ?? []) as unknown as ItemCompraDoPedidoRaw[])
      : new Map<number, never>();
  const etapa = etapaDoPedido(pedido);
  const encerrado = etapa === "concluido" || etapa === "cancelado";
  const pendencias = [
    // 0169: sem projeto vale (a Supervisão valida); sem quem valide, não segue
    { label: "Quem aprova indicado", ok: !aprovadores?.falta_coordenador },
    ...(pedido.natureza === "material_consumo_lab"
      ? [{ label: "Laboratório com coordenação", ok: !aprovadores?.falta_laboratorio }]
      : []),
    { label: "Justificativa preenchida", ok: Boolean(pedido.justificativa) },
    { label: "Tipo de material ou despesa", ok: Boolean(pedido.natureza) },
    { label: "Objetivo", ok: Boolean(pedido.objetivo) },
    // 0183: quem pede não define a urgência; a linha só aparece em pedido já urgente
    ...(ehUrgente(pedido.urgencia)
      ? [{ label: "Urgência justificada por quem a define (fura o ciclo do dia 10)", ok: !faltaJustificativaUrgencia(pedido.urgencia, pedido.urgencia_justificativa) }]
      : []),
    { label: "Ao menos um item", ok: linhas.length > 0 },
    {
      label: "Itens com especificação, quantidade e unidade",
      ok: linhas.length > 0 && linhas.every((item) => item.especificacao && Number(item.quantidade) > 0 && item.unidade),
    },
  ];
  const rascunhoCompleto = pendencias.every((item) => item.ok);
  // "Novo pedido" grava e envia de uma vez; se uma parte não saiu, o pedido fica como rascunho e diz por quê
  const avisoNovoPedido =
    pedido.status !== "rascunho"
      ? null
      : aviso === "itens"
        ? "O pedido foi guardado como rascunho, mas os itens não foram gravados. Inclua os itens abaixo e envie para aprovação."
        : aviso === "envio"
          ? `O pedido foi guardado como rascunho, mas não seguiu para aprovação. ${travaEnvio ?? "Confira o que falta em “Conferir e enviar”, abaixo, e envie de novo."}`
          : null;
  const temDocumentoCotacao = anexoRows.some((anexo) => ["orcamento_previo", "proposta", "print", "email"].includes(anexo.tipo));
  const temDocumentoFiscal = anexoRows.some((anexo) => ["nota_fiscal", "boleto", "comprovante"].includes(anexo.tipo));
  const itensFisicos = linhas.filter((item) => ["material", "equipamento"].includes(item.tipo));
  const itensRecebidos = itensFisicos.filter((item) => item.recebido_em).length;
  // as duas datas do ciclo: solicitação e a aprovação da coordenação que o define
  const datasCiclo = datasDoCiclo(aprovacaoRows, pedido.aprovacao_area_em);
  // 0176: pedido do ciclo seguinte só segue para compras quando o ciclo abrir
  const hojeBrasilia = dataEmBrasilia(new Date());
  const cicloTravadoAte =
    pedido.status === "validado"
      ? cicloLiberaEm(pedido.ciclo_pagamento, pedido.urgencia, pedido.urgencia_justificativa, hojeBrasilia)
      : null;
  const motivoCiclo =
    pedido.status === "validado"
      ? motivoCicloTravado(pedido.ciclo_pagamento, pedido.urgencia, pedido.urgencia_justificativa, hojeBrasilia)
      : null;
  const proxima = proximoPasso(pedido, {
    coordenador: aprovadores?.coordenador?.nome,
    coordenadorRotulo: aprovadores?.coordenador?.rotulo,
    laboratorio: aprovadores?.laboratorio?.nome
      ? `${aprovadores.laboratorio.nome} (${aprovadores.laboratorio.area})`
      : null,
    cicloAbreEm: cicloTravadoAte,
  });
  // De quem é a vez. "Sua vez" só quando o banco aponta o usuário como quem
  // decide (coordenador ou laboratório); nas outras etapas vale a permissão.
  const usuarioId = usuario?.id ?? null;
  const titularCoordenador = Boolean(usuarioId && aprovadores?.coordenador?.ids?.includes(usuarioId));
  const titularLaboratorio = Boolean(usuarioId && aprovadores?.laboratorio?.ids?.includes(usuarioId));
  const vez: { tom: "sua" | "espera" | "neutro"; rotulo: string; texto: string | null } = encerrado
    ? { tom: "neutro", rotulo: statusMeta.label, texto: null }
    : editavel
      ? {
          tom: "neutro",
          rotulo: "Com o solicitante",
          texto: rascunhoCompleto
            ? "Tudo conferido. Envie para aprovação no fim da lista de itens."
            : `Falta para enviar: ${pendencias.filter((item) => !item.ok).map((item) => item.label.toLowerCase()).join("; ")}.`,
        }
      : esperaLaboratorio
        ? podeDecidirLaboratorio
          ? {
              tom: "sua",
              rotulo: "Sua vez",
              texto: titularLaboratorio
                ? "Você responde pela coordenação deste laboratório. Confira os itens abaixo e aprove ou devolva."
                : "Você pode decidir como Administrador, na ausência da coordenação do laboratório.",
            }
          : { tom: "espera", rotulo: "Aguardando o laboratório", texto: null }
        : pedido.status === "em_validacao"
          ? podeGerir && podeValidar
            ? {
                tom: "sua",
                rotulo: "Sua vez",
                texto: titularCoordenador
                  ? "Você é quem aprova este pedido. Confira os itens abaixo e aprove ou devolva ao solicitante."
                  : `Você pode aprovar como Administrador, na ausência de ${aprovadores?.coordenador?.nome ?? "quem aprova"}.`,
              }
            : { tom: "espera", rotulo: "Aguardando aprovação", texto: null }
          : cicloTravadoAte
            ? { tom: "espera", rotulo: "Aguardando o ciclo abrir", texto: null }
            : podeGerir || (aguardandoChegada && (podeReceberCompra || podeConfirmar))
              ? { tom: "sua", rotulo: "Você pode agir", texto: null }
              : { tom: "espera", rotulo: "Em andamento", texto: null };

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <AvisoLeitura falhas={leitura.falhas} />
        <Breadcrumbs items={[{ label: "Pedidos", href: "/pedido" }, { label: pedidoInternoNumero(pedido.id) }]} />
        {avisoNovoPedido && (
          <p role="status" data-testid="aviso-novo-pedido" className="mt-2 rounded-lg border border-warning-strong/40 bg-warning-soft px-3 py-2 text-sm">
            {avisoNovoPedido}
          </p>
        )}
        <PedidoCabecalho
          pedido={pedido}
          statusMeta={statusMeta}
          projeto={projeto}
          coordenadorProjeto={coordenadorProjeto}
          modalidadeLabel={modalidadeLabel}
          avisoControlado={avisoControlado}
          datasCiclo={datasCiclo}
          cicloTravadoAte={cicloTravadoAte}
          pedidoId={pedidoId}
          areas={areas}
          projetos={projetos}
          podeGerir={podeGerir}
          podeDefinirUrgencia={podeUrgencia && !encerrado}
        />

        <section aria-label="Andamento do pedido" className="mt-3 rounded-lg border border-border bg-card px-3 py-4 shadow-sm">
          <PedidoTrilha etapa={etapa} />
          {pedido.status === "ajuste_solicitante" && (
            <p className="mt-3 text-sm text-warning-strong">
              Pedido devolvido ao solicitante. Revise os itens e reenvie.
            </p>
          )}
          {pedido.status === "ajuste_compras" && (
            <p className="mt-3 text-sm text-danger-strong">
              Pedido devolvido na análise administrativa. Revise com Compras e reenvie.
            </p>
          )}
        </section>

        <section className="mt-3 grid items-start gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,.85fr)]">
          <PedidoPainelAgora
            vez={vez}
            encerrado={encerrado}
            proxima={proxima}
            statusMeta={statusMeta}
            editavel={editavel}
            pedidoId={pedidoId}
            pedido={pedido}
            podeGerir={podeGerir}
            rascunhoCompleto={rascunhoCompleto}
            compraFormal={compraFormal}
            podeValidar={podeValidar}
            motivoProprioPedido={motivoProprio}
            aprovadores={aprovadores}
            esperaLaboratorio={esperaLaboratorio}
            podeDecidirLaboratorio={podeDecidirLaboratorio}
            motivoCiclo={motivoCiclo}
            pendenciaPagamento={pendenciaPagamento}
            podeConfirmar={podeConfirmar}
            resumoOrcamentos={resumoOrcamentos}
            controlados={controlados}
            etapasQuemAprova={etapasQuemAprova}
            comOrcamentos={comOrcamentos}
            orcamentos={orcamentos}
            fornecedores={fornecedores}
            anexoRowsBase={anexoRowsBase}
            aguardandoChegada={aguardandoChegada}
          />

          <PedidoResumo
            linhas={linhas}
            itensFisicos={itensFisicos}
            itensRecebidos={itensRecebidos}
            total={total}
            compraFormal={compraFormal}
            pedido={pedido}
            modalidadeLabel={modalidadeLabel}
            temDocumentoCotacao={temDocumentoCotacao}
            temDocumentoFiscal={temDocumentoFiscal}
          />
        </section>

        {/* compra única na tela: a compra que nasceu do pedido é conduzida aqui */}
        {compraFormal && pedidoMostraPainelDaCompra(pedido.status) && (
          <PedidoCompraPainel
            pedidoId={pedidoId}
            pedidoStatus={pedido.status}
            compra={compraFormal}
            chegada={itensDaCompra ? chegadaDaCompra(itensDaCompra as unknown as ItemCompraDoPedidoRaw[]) : null}
            orcamentoEscolhido={orcamentos?.find((orcamento) => orcamento.escolhida) ?? null}
            fornecedores={((fornecedores ?? []) as unknown as FornecedorRaw[])
              .filter((f): f is { id: number; nome: string } => typeof f.id === "number" && Boolean(f.nome))
              .map((f) => ({ id: f.id, nome: f.nome }))}
            podeAprovarCompra={podeAprovarCompra}
            hoje={hojeBrasilia}
          />
        )}

        <PedidoItens
          total={total}
          podeEditarItens={podeEditarItens}
          linhas={linhas}
          equivalentes={equivalentes}
          pedidoId={pedidoId}
          compraFormal={compraFormal}
          chegadasCompra={chegadasCompra}
          locais={((locais ?? []) as { id: number; nome: string | null }[]).map((local) => ({
            id: Number(local.id),
            nome: local.nome ?? `Local #${local.id}`,
          }))}
          catalogoItens={catalogoItens}
          aguardandoChegada={aguardandoChegada}
          podeRegistrarRecebimento={podeRegistrarRecebimento}
          podeEstornar={podeEstornar}
          fornecedoresPedido={fornecedoresPedido}
          editavel={editavel}
          pendencias={pendencias}
          avisoReenvio={avisoReenvio}
          pedido={pedido}
          podeGerir={podeGerir}
          podeCancelar={podeCancelar}
          rascunhoCompleto={rascunhoCompleto}
          travaEnvio={travaEnvio}
        />

        <section className="mt-4 grid items-start gap-4 lg:grid-cols-2">
          <PedidoDocumentos
            temDocumentoCotacao={temDocumentoCotacao}
            anexoRows={anexoRows}
            editavel={editavel}
            pedidoId={pedidoId}
          />

          <PedidoComunicacoes comunicacaoRows={comunicacaoRows} pedidoId={pedidoId} />
        </section>

        <PedidoAprovacoes aprovacaoRows={aprovacaoRows} />

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
