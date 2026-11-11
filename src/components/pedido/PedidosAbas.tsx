import { PedidosSubnav } from "@/components/pedido/PedidosSubnav";
import { permiteAcesso } from "@/config/modules";
import { minhasPermissoes } from "@/lib/auth/permissao-efetiva";

/**
 * Abas de Pedidos (revisão de 11/11, L13): compras formais e prazos eram links
 * de texto sob o título. Cada aba aparece só para quem pode abrir a tela.
 */
export const SECOES_PEDIDOS = [
  { href: "/pedido", label: "Pedidos", desc: "cada pedido e a etapa em que está" },
  { href: "/compras", label: "Compras", desc: "registro das compras com fornecedor, ligadas aos pedidos" },
  { href: "/suprimentos/prazos", label: "Prazos de compra", desc: "quanto tempo as compras levaram, do pedido à chegada" },
];

export async function PedidosAbas() {
  const permissoes = await minhasPermissoes();
  const secoes = SECOES_PEDIDOS.filter((secao) => permiteAcesso({ permissoes }, secao.href));
  return <PedidosSubnav secoes={secoes} />;
}
