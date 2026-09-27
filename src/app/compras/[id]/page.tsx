import { notFound } from "next/navigation";
import Link from "next/link";
import { createClientUntyped } from "@/lib/supabase/server";
import { pode } from "@/lib/auth/permissao-efetiva";
import {
  adicionarItemPedido,
  definirFornecedorCompra,
  removerItemPedido,
} from "@/lib/actions/compras";
import { PedidoAcoes } from "@/components/compras/PedidoAcoes";
import { FormComMensagem } from "@/components/pedido/FormComMensagem";
import { SubmitButton } from "@/components/common/SubmitButton";
import { ScannerRecebimentoCompra } from "@/components/compras/ScannerRecebimentoCompra";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { HelpTip } from "@/components/common/HelpTip";
import { listarEventos } from "@/lib/actions/eventos";
import { Timeline } from "@/components/common/Timeline";
import { formatDate, formatDateTime, formatNumber as fmt, formatCurrency as brl } from "@/lib/formatters";
import { emFrascos, rotuloQuantidadeItem } from "@/lib/estoque/quantidade-compra";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  solicitado: "Solicitado",
  aprovado: "Aprovado",
  enviado: "Enviado",
  em_transito: "Em trânsito",
  recebido: "Recebido",
  cancelado: "Cancelado",
};

type PedidoCompraItemRow = {
  id: number;
  quantidade: number;
  quantidade_recebida: number | null;
  divergencia_recebimento: string | null;
  custo_unitario_estimado: number | null;
  lote_id: number | null;
  pedido_interno_item_id: number | null;
  insumo_id: number | null;
  quantidade_em: string | null;
  conteudo_embalagem: number | null;
  insumos: { especificacao: string | null; unidade: string | null } | null;
  pedidos_internos_itens?: { pedido_interno_id: number | null; fornecedor_sugerido: string | null } | null;
  pedidos_compra_item_recebimentos?: CompraItemRecebimento[] | null;
};

type CompraItemRecebimento = {
  id: number;
  lote_id: number;
  quantidade: number;
  codigo_lote: string | null;
  validade: string | null;
  responsavel: string | null;
  recebido_em: string;
  /** recebimento desfeito (0127): não conta no recebido, fica só como histórico */
  estornado_em: string | null;
};

type PedidoCompraItensQuery = {
  select: (columns: string) => {
    eq: (column: string, value: number) => {
      order: (column: string) => PromiseLike<{ data: PedidoCompraItemRow[] | null; error: unknown }>;
    };
  };
};

export default async function PedidoDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pedidoId = Number(id);
  const supabase = await createClientUntyped();

  const { data: pedido } = await supabase
    .from("pedidos_compra")
    .select("*, fornecedores(nome)")
    .eq("id", pedidoId)
    .single();
  if (!pedido) notFound();

  const semFornecedor = pedido.status === "solicitado" && pedido.fornecedor_id == null;
  const [{ data: itens }, { data: insumos }, podeAprovar, podeReceber, podeCancelar, podeSolicitar, { data: locais }, { data: fornecedores }] = await Promise.all([
    (supabase.from("pedidos_compra_itens") as unknown as PedidoCompraItensQuery)
      .select("id, quantidade, quantidade_recebida, divergencia_recebimento, custo_unitario_estimado, lote_id, pedido_interno_item_id, insumo_id, quantidade_em, conteudo_embalagem, insumos(especificacao, unidade), pedidos_internos_itens(pedido_interno_id, fornecedor_sugerido), pedidos_compra_item_recebimentos(id, lote_id, quantidade, codigo_lote, validade, responsavel, recebido_em, estornado_em)")
      .eq("pedido_id", pedidoId)
      .order("id"),
    supabase.from("insumos").select("id, especificacao").order("especificacao"),
    pode("compras.aprovar"),
    pode("compras.receber"),
    pode("compras.cancelar"),
    pode("compras.solicitar"),
    supabase.from("locais").select("id, nome").order("nome"),
    semFornecedor
      ? supabase.from("fornecedores").select("id, nome, ativo").order("nome")
      : Promise.resolve({ data: [] as { id: number; nome: string; ativo: boolean }[] }),
  ]);

  const eventos = await listarEventos("pedido_compra", pedidoId);
  const editavel = pedido.status === "solicitado" && podeSolicitar;
  const recebivel = ["aprovado", "enviado", "em_transito"].includes(pedido.status) && podeReceber;
  const forn = (pedido.fornecedores as { nome: string | null } | null)?.nome;
  const total = (itens ?? []).reduce(
    (a, it) => a + Number(it.quantidade) * Number(it.custo_unitario_estimado ?? 0),
    0,
  );
  // Compra nascida de pedido interno: se todos os itens sugerem o mesmo
  // fornecedor e ele está cadastrado (mesmo nome, sem diferenciar maiúsculas),
  // ele vem pré-selecionado. A gravação continua sendo escolha de quem edita.
  const listaFornecedores = ((fornecedores ?? []) as { id: number; nome: string; ativo: boolean | null }[]);
  const sugestoesFornecedor = new Set(
    (itens ?? []).map((it) => it.pedidos_internos_itens?.fornecedor_sugerido?.trim().toLocaleLowerCase("pt-BR") ?? ""),
  );
  const nomeSugerido = sugestoesFornecedor.size === 1 ? [...sugestoesFornecedor][0] : "";
  const fornecedorSugerido = nomeSugerido
    ? listaFornecedores.find((f) => f.nome.trim().toLocaleLowerCase("pt-BR") === nomeSugerido) ?? null
    : null;
  const inp = "rounded-md border border-input bg-card px-2 py-1.5 text-sm font-medium text-brand-700 dark:text-brand-300"; // §8.2: entrada em azul

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <Breadcrumbs items={[{ label: "Compras", href: "/compras" }, { label: `Compra #${pedido.id}` }]} />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">Compra #{pedido.id}</h1>
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">
              {STATUS[pedido.status] ?? pedido.status}
            </span>
          </div>
          <Link href={`/compras/${pedidoId}/imprimir`} className="rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-muted">
            Imprimir / PDF
          </Link>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {forn ? `Fornecedor: ${forn} · ` : ""}
          {pedido.projeto ? `Projeto: ${pedido.projeto} · ` : ""}
          Solicitante: {pedido.solicitante ?? "—"}
          {pedido.aprovador ? ` · Aprovado por ${pedido.aprovador}` : ""}
          {pedido.data_prevista_entrega ? ` · Previsão: ${formatDate(pedido.data_prevista_entrega)}` : ""}
        </p>

        {semFornecedor && (
          <section
            aria-labelledby="compra-sem-fornecedor"
            className="mt-4 rounded-lg border border-warning-strong/30 bg-warning-soft px-4 py-3 text-sm"
          >
            <h2 id="compra-sem-fornecedor" className="font-semibold text-warning-strong">
              Compra sem fornecedor
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {fornecedorSugerido
                ? `Todos os itens sugerem ${fornecedorSugerido.nome}. Confirme para que ele saia no pedido impresso.`
                : "Defina o fornecedor antes de aprovar: sem ele o pedido impresso sai incompleto."}
            </p>
            {editavel || podeAprovar ? (
              listaFornecedores.length > 0 ? (
                <FormComMensagem action={definirFornecedorCompra} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="pedido_id" value={pedidoId} />
                  <div>
                    <label htmlFor="compra-fornecedor" className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">
                      Fornecedor
                    </label>
                    <select
                      id="compra-fornecedor"
                      name="fornecedor_id"
                      required
                      defaultValue={fornecedorSugerido ? String(fornecedorSugerido.id) : ""}
                      className={inp}
                    >
                      <option value="" disabled>Selecione…</option>
                      {listaFornecedores
                        .filter((f) => f.ativo !== false || f.id === fornecedorSugerido?.id)
                        .map((f) => (
                          <option key={f.id} value={f.id}>{f.nome}</option>
                        ))}
                    </select>
                  </div>
                  <SubmitButton size="sm" pendingLabel="Salvando…">Definir fornecedor</SubmitButton>
                </FormComMensagem>
              ) : (
                <p className="mt-2 text-xs">
                  Nenhum fornecedor cadastrado.{" "}
                  <Link href="/cadastros/fornecedores" className="text-primary hover:underline">Cadastrar fornecedor</Link>
                </p>
              )
            ) : null}
          </section>
        )}

        {/* itens */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Itens</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-transparent text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Insumo</th>
                  <th className="px-4 py-3 text-left">Origem</th>
                  <th className="px-4 py-3 text-right">Qtd</th>
                  <th className="px-4 py-3 text-right">Custo est.</th>
                  <th className="px-4 py-3 text-center">
                    <span className="inline-flex items-center gap-1">
                      Recebido
                      <HelpTip title="Recebimento do item">
                        <p>
                          O item pode chegar <b>em partes</b>. Cada entrega vira um lote em quarentena,
                          listado aqui com número, validade e responsável.
                        </p>
                        <p>A compra só fica como Recebida quando todos os itens chegam.</p>
                        <p>Para desfazer uma entrega registrada por engano, abra o lote e use <b>Estornar recebimento</b>.</p>
                      </HelpTip>
                    </span>
                  </th>
                  {(editavel || recebivel) && <th className="px-4 py-3 text-right">Ação</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {(itens ?? []).map((it) => {
                  const ins = it.insumos as { especificacao: string | null; unidade: string | null } | null;
                  const recebimentos = (it.pedidos_compra_item_recebimentos ?? [])
                    .slice()
                    .sort((a, b) => Date.parse(b.recebido_em) - Date.parse(a.recebido_em));
                  return (
                    <tr key={it.id}>
                      <td className="px-4 py-2.5 max-w-xs truncate" title={ins?.especificacao ?? ""}>{ins?.especificacao}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {it.pedidos_internos_itens?.pedido_interno_id ? (
                          <Link href={`/pedido/${it.pedidos_internos_itens.pedido_interno_id}`} className="text-primary hover:underline">
                            Pedido interno #{it.pedidos_internos_itens.pedido_interno_id}
                          </Link>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{rotuloQuantidadeItem(it, ins?.unidade)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{brl(it.custo_unitario_estimado)}</td>
                      <td className="px-4 py-2.5 text-center">
                        {Number(it.quantidade_recebida ?? 0) > 0 || recebimentos.length > 0 ? (
                          <span className="inline-flex flex-col items-center gap-0.5">
                            {Number(it.quantidade_recebida ?? 0) > 0 ? (
                              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-800 dark:bg-brand-950/50 dark:text-brand-300">
                                {Number(it.quantidade_recebida) >= Number(it.quantidade)
                                  ? `✓ recebido (${rotuloQuantidadeItem(it, ins?.unidade, it.quantidade_recebida)})`
                                  : `parcial: ${fmt(it.quantidade_recebida)} de ${rotuloQuantidadeItem(it, ins?.unidade)}`}
                              </span>
                            ) : (
                              // todos os recebimentos foram estornados: o item voltou a aguardar
                              <span className="text-xs text-muted-foreground/80">nada recebido</span>
                            )}
                            {it.divergencia_recebimento && (
                              <span className="text-[10px] text-warning-strong">
                                {it.divergencia_recebimento}
                              </span>
                            )}
                            {recebimentos.length > 0 && (
                              <span className="mt-1 w-full space-y-0.5 text-left text-[10px] text-muted-foreground">
                                {recebimentos.map((recebimento) => (
                                  <span
                                    key={recebimento.id}
                                    className="block"
                                    title={
                                      recebimento.estornado_em
                                        ? `Recebimento estornado em ${formatDateTime(recebimento.estornado_em)}: não conta no recebido.`
                                        : undefined
                                    }
                                  >
                                    <span className={recebimento.estornado_em ? "line-through opacity-70" : undefined}>
                                      <Link href={`/estoque/lotes/${recebimento.lote_id}`} className="text-primary hover:underline">
                                        Lote {recebimento.codigo_lote ?? `#${recebimento.lote_id}`}
                                      </Link>{" "}
                                      · {rotuloQuantidadeItem(it, ins?.unidade, recebimento.quantidade)}
                                      {recebimento.validade ? ` · val. ${formatDate(recebimento.validade)}` : ""}
                                      {recebimento.responsavel ? ` · ${recebimento.responsavel}` : ""}
                                      {` · ${formatDateTime(recebimento.recebido_em)}`}
                                    </span>
                                    {recebimento.estornado_em && (
                                      <span className="ml-1 rounded bg-danger-soft px-1 py-px font-semibold text-danger-strong">
                                        estornado
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/80">—</span>
                        )}
                      </td>
                      {(editavel || recebivel) && (
                        <td className="px-4 py-2.5 text-right">
                          {editavel && (
                            <FormComMensagem action={removerItemPedido} className="inline">
                              <input type="hidden" name="item_id" value={it.id} />
                              <input type="hidden" name="pedido_id" value={pedidoId} />
                              <button className="text-xs text-danger-strong hover:underline">Remover</button>
                            </FormComMensagem>
                          )}
                          {recebivel && Number(it.quantidade_recebida ?? 0) < Number(it.quantidade) && (
                            <ScannerRecebimentoCompra
                              item={{
                                id: it.id,
                                pedidoId,
                                quantidade: Number(it.quantidade),
                                quantidadeRecebida: Number(it.quantidade_recebida ?? 0),
                                insumoId: it.insumo_id,
                                insumoDescricao: ins?.especificacao ?? null,
                                unidade: ins?.unidade ?? null,
                                emFrascos: emFrascos(it),
                                conteudoEmbalagem: it.conteudo_embalagem == null ? null : Number(it.conteudo_embalagem),
                              }}
                              locais={((locais ?? []) as { id: number; nome: string | null }[]).map((local) => ({
                                id: Number(local.id),
                                nome: local.nome ?? `Local #${local.id}`,
                              }))}
                            />
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {(itens ?? []).length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground/80">Nenhum item.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-right text-sm text-muted-foreground">Total estimado: <b>{brl(total)}</b></p>

          {editavel && (
            <FormComMensagem action={adicionarItemPedido} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="pedido_id" value={pedidoId} />
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Insumo</label>
                <select name="insumo_id" className={inp} defaultValue="">
                  <option value="" disabled>Selecione…</option>
                  {(insumos ?? []).map((i) => (
                    <option key={i.id} value={i.id}>{i.especificacao}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Frascos</label>
                <input name="quantidade" type="number" min="1" step="1" className={`${inp} w-24`} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">Custo est. por frasco</label>
                <input name="custo_unitario_estimado" type="number" min="0" step="0.01" className={`${inp} w-28`} />
              </div>
              <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">Adicionar</button>
            </FormComMensagem>
          )}
        </section>

        {/* ações de status */}
        <section className="mt-8">
          <PedidoAcoes
            pedidoId={pedidoId}
            status={pedido.status}
            podeAprovar={podeAprovar}
            podeCancelar={podeCancelar}
            temRecebimento={(itens ?? []).some(
              (item) => Number(item.quantidade_recebida ?? 0) > 0 || item.lote_id != null,
            )}
          />
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
