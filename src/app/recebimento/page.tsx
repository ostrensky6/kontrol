import { createClient } from "@/lib/supabase/server";
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
import { ScannerRecebimentoCompra } from "@/components/compras/ScannerRecebimentoCompra";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { emFrascos, rotuloQuantidadeItem } from "@/lib/estoque/quantidade-compra";
import { formatNumber } from "@/lib/formatters";

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
  insumos: { especificacao: string | null; unidade: string | null } | null;
  pedidos_compra: {
    id: number;
    status: string;
    fornecedores: { nome: string | null } | null;
  } | null;
};

export default async function RecebimentoPage() {
  const supabase = await createClient();
  const [{ data: itensData }, { data: insumos }, { data: comprasData }, podeReceberCompra, podeRegistrarRecebimento, { data: locaisData }] = await Promise.all([
    supabase
      .from("pedidos_internos_itens")
      .select(
        "id, especificacao, quantidade, quantidade_recebida, unidade, insumo_id, fornecedor_sugerido, orcamento_previo, pedido_interno_id, pedidos_internos!inner(id, titulo, status, pedido_compra_id, projetos(nome)), pedidos_internos_item_recebimentos(id, lote_id, quantidade, codigo_lote, fornecedor, validade, responsavel, recebido_em)",
      )
      .is("recebido_em", null)
      .order("id", { ascending: false }),
    supabase.from("insumos").select("id, especificacao, unidade").order("especificacao"),
    supabase
      .from("pedidos_compra_itens")
      .select("id, pedido_id, insumo_id, quantidade, quantidade_recebida, quantidade_em, conteudo_embalagem, insumos(especificacao, unidade), pedidos_compra!inner(id, status, fornecedores(nome))")
      .is("pedido_interno_item_id", null)
      .order("id", { ascending: false }),
    pode("compras.receber"),
    pode("recebimento.registrar"),
    supabase.from("locais").select("id, nome").order("nome"),
  ]);
  const locais = ((locaisData ?? []) as { id: number; nome: string | null }[]).map((local) => ({
    id: Number(local.id),
    nome: local.nome ?? `Local #${local.id}`,
  }));

  const itens = ((itensData ?? []) as unknown as ItemRaw[]).filter(
    (item) => item.pedidos_internos && item.pedidos_internos.status !== "cancelado",
  );

  const rows: RecebimentoItemRow[] = itens.map((item) => {
    const pedido = item.pedidos_internos!;
    const status = pedido.status;
    return {
      id: item.id,
      pedidoId: pedido.id,
      pedidoNumero: pedidoInternoNumero(pedido.id),
      pedidoTitulo: pedido.titulo,
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
      podeReceber:
        podeRegistrarRecebimento &&
        PEDIDO_INTERNO_AGUARDANDO_CHEGADA.includes(status as PedidoInternoStatus) &&
        !pedido.pedido_compra_id,
    };
  });

  const prontos = rows.filter((row) => row.podeReceber).length;
  const comprasFormais = ((comprasData ?? []) as unknown as CompraFormalItemRaw[]).filter(
    (item) =>
      item.pedidos_compra &&
      ["aprovado", "enviado", "em_transito"].includes(item.pedidos_compra.status) &&
      Number(item.quantidade_recebida ?? 0) < Number(item.quantidade),
  );

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Recebimento</h1>
              <HelpTip title="Recebimento">
                <p>
                  Tudo o que está para chegar, de pedidos internos e de compras. Cada entrega vira um{" "}
                  <b>lote em quarentena</b>; o que faltar continua na fila até chegar tudo.
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
              <p className="mt-1 text-xl font-semibold tabular-nums">{rows.length + comprasFormais.length}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="flex items-center gap-1 text-muted-foreground">
                Prontos para receber
                <HelpTip title="Aguardando × prontos">
                  <p>Aguardando: tudo que falta chegar. Prontos: pedido aprovado ou enviado, já pode registrar a chegada.</p>
                </HelpTip>
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-leaf-700 dark:text-leaf-400">
                {prontos + (podeReceberCompra ? comprasFormais.length : 0)}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <RecebimentoItensTable rows={rows} insumos={insumos ?? []} />
        </div>

        <section className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Compras formais sem pedido interno</h2>
              <p className="mt-1 text-sm text-muted-foreground">Itens recebidos diretamente do fornecedor, inclusive recebimentos parciais.</p>
            </div>
            <span className="text-sm tabular-nums text-muted-foreground">{comprasFormais.length} pendente(s)</span>
          </div>
          <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Compra</th>
                  <th className="px-4 py-3 text-left">Insumo</th>
                  <th className="px-4 py-3 text-left">Fornecedor</th>
                  <th className="px-4 py-3 text-right">Recebido</th>
                  <th className="px-4 py-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {comprasFormais.map((item) => {
                  const insumo = item.insumos;
                  const pedido = item.pedidos_compra;
                  const recebido = Number(item.quantidade_recebida ?? 0);
                  return (
                    <tr key={item.id}>
                      <td className="px-4 py-3 font-mono text-xs">#{item.pedido_id}</td>
                      <td className="px-4 py-3 font-medium">{insumo?.especificacao ?? `Insumo #${item.insumo_id}`}</td>
                      <td className="px-4 py-3 text-muted-foreground">{pedido?.fornecedores?.nome ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatNumber(recebido)} de {rotuloQuantidadeItem(item, insumo?.unidade)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {podeReceberCompra ? (
                          <ScannerRecebimentoCompra
                            item={{
                              id: item.id,
                              pedidoId: item.pedido_id,
                              quantidade: Number(item.quantidade),
                              quantidadeRecebida: recebido,
                              insumoId: item.insumo_id,
                              insumoDescricao: insumo?.especificacao ?? null,
                              unidade: insumo?.unidade ?? null,
                              emFrascos: emFrascos(item),
                              conteudoEmbalagem: item.conteudo_embalagem == null ? null : Number(item.conteudo_embalagem),
                            }}
                            locais={locais}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">Requer a permissão “Receber compras”</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {comprasFormais.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Nenhuma compra formal pendente.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
