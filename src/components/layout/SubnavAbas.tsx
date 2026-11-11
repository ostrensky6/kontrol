"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { hrefAtivoNaBarra } from "@/config/modules";
import { cn } from "@/lib/utils";

export type SecaoDaSubnav = { href: string; label: string; desc?: string; ativoTambem?: string[]; contador?: number };

/**
 * Abas de segundo nível, logo abaixo da barra do módulo (seções do Estoque,
 * configurações dos orçamentos, cadastros de um grupo). Uma aparência só.
 */
export function SubnavAbas({ rotulo, secoes }: { rotulo: string; secoes: SecaoDaSubnav[] }) {
  const pathname = usePathname() ?? "";
  const ativo = hrefAtivoNaBarra(secoes, pathname);

  return (
    <nav aria-label={rotulo} className="border-b border-border bg-background/60 print:hidden">
      <div className="app-topnav-container flex gap-1 overflow-x-auto">
        {secoes.map((secao) => {
          const atual = secao.href === ativo;
          return (
            <Link
              key={secao.href}
              href={secao.href}
              title={secao.desc}
              aria-current={atual ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors",
                atual
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {secao.label}
              {secao.contador ? (
                <span className="rounded-full bg-warning-soft px-1.5 text-xs font-semibold text-warning-strong">
                  {secao.contador}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
