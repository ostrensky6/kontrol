import { createClientUntyped } from "@/lib/supabase/server";
import { pode } from "@/lib/auth/permissao-efetiva";
import {
  PEDIDO_INTERNO_AGUARDANDO_CHEGADA,
  pedidoInternoNumero,
  pedidoInternoStatus,
  type PedidoInternoStatus,
} from "@/lib/pedido/status";
import {
  RecebimentoItensTable,
  type RecebimentoItemRow,
} from "@/components/pedido/RecebimentoItensTable";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { emFrascos, rotuloQuantidadeItem } from "@/lib/estoque/quantidade-compra";
import {
  COLUNAS_ITEM_COMPRA_DO_PEDIDO,
  COMPRA_ACEITA_CHEGADA,
  chegadasPelaCompra,
  compraAceitaChegada,
  type ItemCompraDoPedidoRaw,
} from "@/lib/pedido/chegada-pela-compra";
import { statusInfo } from "@/components/app/status";
import { AvisoLeitura } from "@/components/common/AvisoLeitura";
import { novaLeitura } from "@/lib/supabase/leitura";

export const dynamic = "force-dynamic";

type ItemRaw = {
  id: number;
  especificacao: string;
  quantidade: number;
  quantidade_recebida: number | null;
  unidade: string | null;
  insumo_id: number | null;
  fornecedor_sugerido: string | null;
  orcamento_previo: number | null;
  pedido_interno_id: number;
  pedidos_internos: {
    id: number;
    titulo: string;
    status: string;
    pedido_compra_id: number | null;
    projetos: { nome: string | null } | null;
  } | null;
  pedidos_internos_item_recebimentos?: ItemRecebimentoRaw[] | null;
};

type ItemRecebimentoRaw = {
  id: number;
  lote_id: number | null;
  quantidade: number;
  codigo_lote: string | null;
  fornecedor: string | null;
  validade: string | null;
  responsavel: string | null;
  recebido_em: string;
};

type CompraFormalItemRaw = {
  id: number;
  pedido_id: number;
  insumo_id: number | null;
  quantidade: number;
  quantidade_recebida: number | null;
  quantidade_em: string | null;
  conteudo_embalagem: number | null;
  insumos: { especificacao: string | null; unidade: string | null; codigo_fabricante?: string | null } | null;
  pedidos_compra: {
    id: number;
    status: string;
    projeto: string | null;
    /** compra encerrada com pendência que esta compra repõe (0130) */
    compra_origem_id: number | null;
    fornecedores: { nome: string | null } | null;
  } | null;
};

export default async function RecebimentoPage() {
  const leitura = novaLeitura("/recebimento");
  const supabase = await createClientUntyped();
  const [{ data: itensData, error: erroItens }, { data: insumos }, { data: comprasData, error: erroCompras }, podeReceberCompra, podeRegistrarRecebimento, { data: locaisData }, { data: comprasDosPedidos }] = await Promise.all([
    supabase
      .from("pedidos_internos_itens")
      .select(
        "id, especificacao, quantidade, quantidade_recebida, unidade, insumo_id, fornecedor_sugerido, orcamento_previo, pedido_interno_id, pedidos_internos!inner(id, titulo, status, pedido_compra_id, projetos(nome)), pedidos_internos_item_recebimentos(id, lote_id, quantidade, codigo_lote, fornecedor, validade, responsavel, recebido_em)",
      )
      .is("recebido_em", null)
      .order("id", { ascending: false }),
    leitura.de("insumos", supabase.from("insumos").select("id, especificacao, unidade, codigo_fabricante").eq("ativo", true).order("especificacao")),
    supabase
      .from("pedidos_compra_itens")
      .select("id, pedido_id, insumo_id, quantidade, quantidade_recebida, quantidade_em, conteudo_embalagem, insumos(especificacao, unidade, codigo_fabricante), pedidos_compra!pedidos_compra_itens_pedido_id_fkey!inner(id, status, projeto, compra_origem_id, fornecedores(nome))")
      .is("pedido_interno_item_id", null)
      .order("id", { ascending: false }),
    pode("compras.receber"),
    pode("recebimento.registrar"),
    leitura.de("locais", supabase.from("locais").select("id, nome").order("nome")),
    // chegada única: item de pedido que virou compra é recebido aqui, pelo item da compra
    leitura.de("compras dos pedidos", supabase
      .from("pedidos_compra_itens")
      .select(COLUNAS_ITEM_COMPRA_DO_PEDIDO)
      .not("pedido_interno_item_id", "is", null)
      .in("pedidos_compra.status", COMPRA_ACEITA_CHEGADA)
      .order("id")),
  ]);
  const locais = ((locaisData ?? []) as { id: number; nome: string | null }[]).map((local) => ({
    id: Number(local.id),
    nome: local.nome ?? `Local #${local.id}`,
  }));

  const itens = ((itensData ?? []) as unknown as ItemRaw[]).filter(
    (item) => item.pedidos_internos && item.pedidos_internos.status !== "cancelado",
  );

  const chegadas = podeReceberCompra
    ? chegadasPelaCompra((comprasDosPedidos ?? []) as unknown as ItemCompraDoPedidoRaw[])
    : new Map<number, never>();

  const linhasDePedido: RecebimentoItemRow[] = itens.map((item) => {
    const pedido = item.pedidos_internos!;
    const status = pedido.status;
    return {
      id: item.id,
      origem: "pedido",
      origemRotulo: pedidoInternoNumero(pedido.id),
      origemHref: `/pedido/${pedido.id}`,
      origemDetalhe: pedido.titulo,
      pedidoId: pedido.id,
      especificacao: item.especificacao,
      quantidade: Number(item.quantidade),
      quantidadeRecebida: item.quantidade_recebida,
      compraFormalId: pedido.pedido_compra_id,
      unidade: item.unidade,
      insumoId: item.insumo_id,
      fornecedorSugerido: item.fornecedor_sugerido,
      orcamentoPrevio: item.orcamento_previo,
      recebimentos: (item.pedidos_internos_item_recebimentos ?? [])
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
        .sort((a, b) => Date.parse(b.recebidoEm) - Date.parse(a.recebidoEm)),
      projeto: pedido.projetos?.nome ?? "—",
      status,
      statusLabel: pedidoInternoStatus(status).label,
      semCompra:
        podeRegistrarRecebimento &&
        PEDIDO_INTERNO_AGUARDANDO_CHEGADA.includes(status as PedidoInternoStatus) &&
        !pedido.pedido_compra_id,
      compraItem: chegadas.get(item.id) ?? null,
    };
  });

  // Chegada única: a compra que não nasceu de pedido (por exemplo, a nova
  // compra de uma pendência) entra na mesma fila, com a origem escrita.
  const comprasFormais = ((comprasData ?? []) as unknown as CompraFormalItemRaw[]).filter(
    (item) =>
      item.pedidos_compra &&
      compraAceitaChegada(item.pedidos_compra.status) &&
      Number(item.quantidade_recebida ?? 0) < Number(item.quantidade),
  );
  const linhasDeCompra: RecebimentoItemRow[] = comprasFormais.map((item) => {
    const compra = item.pedidos_compra!;
    const insumo = item.insumos;
    const recebido = Number(item.quantidade_recebida ?? 0);
    return {
      id: item.id,
      origem: "compra",
      origemRotulo: `Compra #${item.pedido_id}`,
      origemHref: `/compras/${item.pedido_id}`,
      origemDetalhe: compra.compra_origem_id ? `Pendência da compra #${compra.compra_origem_id}` : "Compra sem pedido",
      pedidoId: item.pedido_id,
      especificacao: insumo?.especificacao ?? `Insumo #${item.insumo_id}`,
      quantidade: Number(item.quantidade),
      quantidadeRotulo: rotuloQuantidadeItem(item, insumo?.unidade),
      quantidadeRecebida: recebido,
      compraFormalId: item.pedido_id,
      unidade: insumo?.unidade ?? null,
      insumoId: item.insumo_id,
      fornecedorSugerido: compra.fornecedores?.nome ?? null,
      orcamentoPrevio: null,
      projeto: compra.projeto?.trim() || "—",
      status: compra.status,
      statusLabel: statusInfo(compra.status).label,
      semCompra: false,
      compraItem: podeReceberCompra
        ? {
            id: item.id,
            pedidoId: item.pedido_id,
            quantidade: Number(item.quantidade),
            quantidadeRecebida: recebido,
            insumoId: item.insumo_id,
            insumoDescricao: insumo?.especificacao ?? null,
            unidade: insumo?.unidade ?? null,
            emFrascos: emFrascos(item),
            conteudoEmbalagem: item.conteudo_embalagem == null ? null : Number(item.conteudo_embalagem),
          }
        : null,
    };
  });
  const rows = [...linhasDePedido, ...linhasDeCompra];

  // leitura que falha não vira fila vazia nem contagem zero
  const semDado = Boolean(erroItens || erroCompras);
  const prontos = rows.filter((row) => row.compraItem).length;

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <AvisoLeitura falhas={leitura.falhas} />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Recebimento</h1>
              <HelpTip title="Recebimento">
                <p>
                  Tudo o que está para chegar, numa lista só. Cada entrega vira um{" "}
                  <b>lote já disponível no estoque</b>; o que faltar continua na fila até chegar tudo.
                </p>
                <p>
                  A coluna <b>Origem</b> diz de onde vem a linha: do pedido ou de uma compra sem pedido, como a nova
                  compra de uma pendência.
                </p>
                <p>
                  Quem registra a chegada não aceita o próprio lote: o aceite fica com outra pessoa.
                </p>
                <HelpExample>Pedido de 10 caixas, chegaram 6: recebe 6 agora e 4 ficam pendentes.</HelpExample>
              </HelpTip>
            </div>
          </div>
          <div className="grid min-w-56 grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-muted-foreground">Aguardando</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{semDado ? "sem dado" : rows.length}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="flex items-center gap-1 text-muted-foreground">
                Prontos para receber
                <HelpTip title="Aguardando × prontos">
                  <p>Aguardando: tudo que falta chegar. Prontos: pedido aprovado ou enviado, já pode registrar a chegada.</p>
                </HelpTip>
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-leaf-700 dark:text-leaf-400">
                {semDado ? "sem dado" : prontos}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6">
          {erroCompras && !erroItens ? (
            <p role="alert" className="mb-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              Compras sem pedido: sem dado. A leitura das compras não respondeu; recarregue a página antes de concluir que não há mais nada para receber.
            </p>
          ) : null}
          {erroItens ? (
            <p role="alert" className="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              Pedidos: sem dado. A leitura da fila de pedidos não respondeu; recarregue a página antes de concluir que não há nada para receber.
            </p>
          ) : (
            <RecebimentoItensTable rows={rows} insumos={insumos ?? []} locais={locais} />
          )}
        </div>
      </main>
    </div>
  );
}
