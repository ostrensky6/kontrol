"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { hrefAtivoNaBarra } from "@/config/modules";
import { cn } from "@/lib/utils";

/**
 * Seções do Estoque: aparecem só dentro do Estoque, logo abaixo da barra de
 * Suprimentos, e não repetem nenhum link dela.
 */
export const SECOES_ESTOQUE = [
  { href: "/estoque", label: "Saldo e lotes", desc: "saldo por insumo, entradas, baixas e lotes" },
  { href: "/estoque/controle", label: "Controle de Estoque", desc: "painel por insumo, por lote e em gráficos" },
  { href: "/estoque/leitura", label: "Entrada e saída por leitura", desc: "código de barras do fabricante" },
  { href: "/estoque/inventario", label: "Inventário", desc: "contagem e ajuste de divergências" },
  { href: "/etiquetas", label: "Etiquetas", desc: "etiquetas com QR code" },
  { href: "/scanner/triagem", label: "Códigos não reconhecidos", desc: "códigos lidos ainda sem cadastro" },
] as const;

export function EstoqueSubnav() {
  const pathname = usePathname() ?? "";
  // Equipamentos tem item próprio na barra de Suprimentos
  if (pathname === "/estoque/equipamentos" || pathname.startsWith("/estoque/equipamentos/")) return null;
  const ativo = hrefAtivoNaBarra([...SECOES_ESTOQUE], pathname);

  return (
    <nav aria-label="Seções do estoque" className="border-b border-border bg-background/60 print:hidden">
      <div className="app-topnav-container flex gap-1 overflow-x-auto">
        {SECOES_ESTOQUE.map((secao) => {
          const atual = secao.href === ativo;
          return (
            <Link
              key={secao.href}
              href={secao.href}
              title={secao.desc}
              aria-current={atual ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium transition-colors",
                atual
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {secao.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
