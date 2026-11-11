import { redirect } from "next/navigation";

/**
 * Controle de Estoque e Saldo e lotes viraram uma tela só (D1 da revisão de
 * 11/11): a lista por insumo e por lote fica em Estoque, os alertas e os
 * gráficos na Situação do estoque e o pedido de um insumo na ficha dele.
 * O endereço antigo continua valendo e leva ao Estoque.
 */
export default function EstoqueControlePage() {
  redirect("/estoque");
}
