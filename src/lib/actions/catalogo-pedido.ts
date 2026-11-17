"use server";

import { createClientUntyped } from "@/lib/supabase/server";
import { lerEstoqueParaPedido } from "@/lib/estoque/estoque-para-pedido";
import {
  type FornecedorRaw,
  type InsumoPedidoRaw,
  type PedidoItemHistorico,
  montarCatalogoItens,
  montarFornecedoresPedido,
} from "@/lib/pedido/detalhe";
import type { PedidoItemCatalogo } from "@/components/pedido/PedidoItemCamposAssistidos";

export type CatalogoNovoPedido = {
  catalogo: PedidoItemCatalogo[];
  fornecedores: string[];
  /** alguma leitura falhou: a lista pode estar incompleta e o item ainda pode ser descrito à mão */
  incompleto: boolean;
};

/**
 * Insumos, fornecedores e estoque para escolher os itens no "Novo pedido"
 * (ajuste 4 de 17/11/2026). São as mesmas leituras que o pedido faz para o
 * formulário "Adicionar item"; aqui elas só rodam quando o formulário abre,
 * para a lista de pedidos não carregar o catálogo inteiro a cada visita.
 */
export async function carregarCatalogoNovoPedido(): Promise<CatalogoNovoPedido> {
  const supabase = await createClientUntyped();
  const [insumos, historico, fornecedores, lotesLegado, estoque] = await Promise.all([
    supabase
      .from("insumos")
      .select("id, especificacao, nome_item, categoria_compra, unidade, unidade_consumo, fabricante, codigo_fabricante, custo_unitario, quantidade_embalagem, custo_total_embalagem, sinonimos, tipo_insumos(nome), fornecedores!insumos_fornecedor_id_fkey(nome)")
      .eq("ativo", true)
      .order("especificacao"),
    supabase
      .from("pedidos_internos_itens")
      .select("insumo_id, especificacao, unidade, modelo, volume, fornecedor_sugerido")
      .not("insumo_id", "is", null)
      .order("id", { ascending: false })
      .limit(500),
    supabase.from("fornecedores").select("id, nome").eq("ativo", true).order("nome"),
    supabase.from("lotes_estoque").select("insumo_id").neq("modelo_quantidade", "EMBALAGEM_FECHADA").gt("quantidade_atual", 0),
    lerEstoqueParaPedido(supabase),
  ]);

  const insumoRows = ((insumos.data ?? []) as unknown as InsumoPedidoRaw[]) ?? [];
  const historicoRows = ((historico.data ?? []) as unknown as PedidoItemHistorico[]) ?? [];
  // Leitura de estoque incompleta não vira "sem saldo": o quadro do estoque simplesmente não aparece.
  const estoqueParaPedido = estoque.erro ? null : estoque.estoque;
  const catalogo = montarCatalogoItens(
    insumoRows,
    historicoRows,
    new Set(((lotesLegado.data ?? []) as { insumo_id: number }[]).map((lote) => lote.insumo_id)),
  ).map((item) => (estoqueParaPedido ? { ...item, estoque: estoqueParaPedido.get(item.id) ?? null } : item));

  return {
    catalogo,
    fornecedores: montarFornecedoresPedido(((fornecedores.data ?? []) as unknown as FornecedorRaw[]) ?? [], insumoRows, historicoRows),
    incompleto: Boolean(insumos.error || historico.error || fornecedores.error || lotesLegado.error || estoque.erro),
  };
}
