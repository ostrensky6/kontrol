import Link from "next/link";
import { notFound } from "next/navigation";

import { PrintButton } from "@/components/orcamento/PrintButton";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { createClientUntyped } from "@/lib/supabase/server";
import { rotuloQuantidadeItem } from "@/lib/estoque/quantidade-compra";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  solicitado: "Solicitado",
  aprovado: "Aprovado",
  enviado: "Enviado",
  em_transito: "Em trânsito",
  recebido: "Recebido",
  cancelado: "Cancelado",
};

type ItemCompra = {
  id: number;
  quantidade: number;
  quantidade_recebida: number | null;
  custo_unitario_estimado: number | null;
  quantidade_em: string | null;
  conteudo_embalagem: number | null;
  insumos: { especificacao: string | null; unidade: string | null } | null;
};

type ItensQuery = {
  select: (columns: string) => {
    eq: (column: string, value: number) => {
      order: (column: string) => PromiseLike<{ data: ItemCompra[] | null; error: unknown }>;
    };
  };
};

export default async function PedidoCompraImprimivel({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pedidoId = Number(id);
  const supabase = await createClientUntyped();

  const [{ data: pedido }, { data: itens }] = await Promise.all([
    supabase
      .from("pedidos_compra")
      .select("id, status, solicitante, aprovador, projeto, data_solicitacao, data_aprovacao, data_prevista_entrega, observacao, fornecedores(nome, contato, cnpj, endereco, telefone, email)")
      .eq("id", pedidoId)
      .single(),
    (supabase.from("pedidos_compra_itens") as unknown as ItensQuery)
      .select("id, quantidade, quantidade_recebida, custo_unitario_estimado, quantidade_em, conteudo_embalagem, insumos(especificacao, unidade)")
      .eq("pedido_id", pedidoId)
      .order("id"),
  ]);
  if (!pedido) notFound();

  const fornecedor = pedido.fornecedores as unknown as {
    nome: string | null;
    contato: string | null;
    cnpj: string | null;
    endereco: string | null;
    telefone: string | null;
    email: string | null;
  } | null;
  const total = (itens ?? []).reduce(
    (acumulado, item) => acumulado + Number(item.quantidade) * Number(item.custo_unitario_estimado ?? 0),
    0,
  );

  return (
    <div className="min-h-dvh bg-transparent font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="print-area app-page-container">
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <Link href={`/compras/${pedidoId}`} className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted">
            Voltar à compra
          </Link>
          <PrintButton />
        </div>

        <article className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 print:border-0 print:shadow-none">
          <header className="border-b border-zinc-200 bg-zinc-950 px-6 py-6 text-white">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-300">Kontrol</p>
                <h1 className="mt-2 text-2xl font-semibold">Compra</h1>
                <p className="mt-1 text-sm text-zinc-300">Documento para cotação, confirmação e fornecimento.</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-zinc-400">Número</p>
                <p className="mt-1 text-xl font-semibold">PC-{pedido.id}</p>
                <p className="mt-1 text-sm text-zinc-300">{STATUS[pedido.status] ?? pedido.status}</p>
              </div>
            </div>
          </header>

          <div className="p-6">
            <div className="grid gap-4 md:grid-cols-2">
              <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Fornecedor</h2>
                <p className="mt-3 font-semibold">{fornecedor?.nome ?? "A definir"}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-300">
                  {[fornecedor?.cnpj, fornecedor?.contato, fornecedor?.email, fornecedor?.telefone, fornecedor?.endereco]
                    .filter(Boolean)
                    .join("\n") || "Dados de contato não informados."}
                </p>
              </section>
              <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Dados do pedido</h2>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <Campo label="Solicitante" value={pedido.solicitante} />
                  <Campo label="Aprovador" value={pedido.aprovador} />
                  <Campo label="Solicitado em" value={formatDate(pedido.data_solicitacao)} />
                  <Campo label="Previsão" value={formatDate(pedido.data_prevista_entrega)} />
                  <Campo label="Projeto" value={pedido.projeto} />
                  <Campo label="Aprovado em" value={formatDate(pedido.data_aprovacao)} />
                </dl>
              </section>
            </div>

            <section className="mt-6 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-700">
                  <tr>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3 text-right">Quantidade</th>
                    <th className="px-4 py-3 text-right">Custo unitário est.</th>
                    <th className="px-4 py-3 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {(itens ?? []).map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3 font-medium">{item.insumos?.especificacao ?? `Insumo #${item.id}`}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{rotuloQuantidadeItem(item, item.insumos?.unidade)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(item.custo_unitario_estimado)}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">{formatCurrency(Number(item.quantidade) * Number(item.custo_unitario_estimado ?? 0))}</td>
                    </tr>
                  ))}
                  {(itens ?? []).length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-zinc-500">Nenhum item incluído no pedido.</td></tr>
                  )}
                </tbody>
                <tfoot className="border-t border-zinc-200 dark:border-zinc-700">
                  <tr>
                    <td colSpan={3} className="px-4 py-4 text-right text-sm font-semibold">Total estimado</td>
                    <td className="px-4 py-4 text-right text-lg font-semibold tabular-nums">{formatCurrency(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </section>

            {pedido.observacao && (
              <section className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Observações</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-700 dark:text-zinc-300">{pedido.observacao}</p>
              </section>
            )}

            <footer className="proposal-footer mt-10 border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500 dark:border-zinc-700">
              Documento emitido pelo Kontrol. Confirme disponibilidade, prazo, condições comerciais e dados de faturamento antes do fornecimento.
            </footer>
          </div>
        </article>
      </main>
    </div>
  );
}

function Campo({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 font-medium">{value || "—"}</dd>
    </div>
  );
}
