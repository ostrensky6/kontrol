"use client";

import { usePathname } from "next/navigation";

import { SubnavAbas, type SecaoDaSubnav } from "@/components/layout/SubnavAbas";

/** Listas em que as abas de Pedidos aparecem; na página de um pedido ou de uma compra, não. */
const TELAS_COM_ABAS = ["/pedido", "/compras", "/suprimentos/prazos"];

export function PedidosSubnav({ secoes }: { secoes: SecaoDaSubnav[] }) {
  const pathname = usePathname() ?? "";
  if (!TELAS_COM_ABAS.includes(pathname) || secoes.length < 2) return null;
  return <SubnavAbas rotulo="Seções de pedidos" secoes={secoes} />;
}
