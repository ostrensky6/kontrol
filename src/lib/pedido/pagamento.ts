/**
 * Entrega antes do pagamento (0170, decisão D6 de 09/11/2026). A regra mora no
 * banco (kontrol_private.pendencia_pagamento); a tela lê o mesmo texto.
 */

type Rpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/** Texto do que falta para pagar; null quando pode pagar ou quando não deu para ler. */
export async function lerPendenciaPagamento(supabase: Rpc, pedidoId: number): Promise<string | null> {
  const { data, error } = await supabase.rpc("pendencia_pagamento_pedido_interno", { p_pedido_id: pedidoId });
  if (error) return null;
  return typeof data === "string" && data.trim() ? data : null;
}

/** Etapas em que a entrega pode ser confirmada ou a exceção registrada. */
export const ETAPAS_ANTES_DO_PAGAMENTO = ["aprovado_para_compra", "compra_fechada", "encaminhado_instituicao"];

type ItemEntrega = { tipo: string | null; recebido_em?: string | null };

/**
 * Mostra "Confirmar entrega"? Só quando o pedido tem serviço (ou nenhum item
 * físico), a entrega ainda não foi confirmada e todo item físico já chegou.
 */
export function podeConfirmarEntrega(
  pedido: { status: string; entrega_confirmada_em?: string | null },
  itens: ItemEntrega[],
): boolean {
  if (!ETAPAS_ANTES_DO_PAGAMENTO.includes(pedido.status) || pedido.entrega_confirmada_em) return false;
  const fisicos = itens.filter((i) => i.tipo === "material" || i.tipo === "equipamento");
  const temServico = itens.some((i) => i.tipo !== "material" && i.tipo !== "equipamento");
  if (!temServico && fisicos.length > 0) return false;
  return fisicos.every((i) => Boolean(i.recebido_em));
}
