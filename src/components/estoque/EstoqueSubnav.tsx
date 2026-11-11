"use client";

import { usePathname } from "next/navigation";

import { SubnavAbas } from "@/components/layout/SubnavAbas";

/**
 * Seções do Estoque: aparecem só dentro do Estoque, logo abaixo da barra de
 * Suprimentos, e não repetem nenhum link dela. "Códigos não reconhecidos" fica
 * dentro de Entrada e saída por leitura (revisão de 11/11, L11).
 */
export const SECOES_ESTOQUE = [
  // Saldo e lotes e Controle de Estoque viraram uma tela (D1); o custo é relatório (L10)
  { href: "/estoque", label: "Saldo e lotes", desc: "saldo por insumo, entradas, baixas e lotes", ativoTambem: ["/estoque/custos"] },
  // painel único de alertas (D1, L1): saiu de Cadastros
  { href: "/estoque/situacao", label: "Situação", desc: "o que pede atenção: saldo, compra, validade e lotes" },
  {
    href: "/estoque/leitura",
    label: "Entrada e saída por leitura",
    desc: "código de barras do fabricante e códigos não reconhecidos",
    ativoTambem: ["/scanner"],
  },
  { href: "/estoque/inventario", label: "Inventário", desc: "contagem e ajuste de divergências" },
  { href: "/etiquetas", label: "Etiquetas", desc: "etiquetas com QR code" },
];

export function EstoqueSubnav() {
  const pathname = usePathname() ?? "";
  // Equipamentos tem item próprio na barra de Suprimentos
  if (pathname === "/estoque/equipamentos" || pathname.startsWith("/estoque/equipamentos/")) return null;
  return <SubnavAbas rotulo="Seções do estoque" secoes={SECOES_ESTOQUE} />;
}
