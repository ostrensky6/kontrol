"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { hrefAtivoNaBarra } from "@/config/modules";
import { rotaDeConfiguracaoDoOrcamento } from "@/lib/orcamento/secoes-configuracao";
import { cn } from "@/lib/utils";

/**
 * Abas de Configurações dos orçamentos: aparecem só nas três telas de
 * configuração, logo abaixo da barra de Orçamentos, e mostram só as telas
 * que a pessoa pode abrir.
 */
export function ConfiguracoesSubnav({
  secoes,
}: {
  secoes: Array<{ href: string; label: string; desc: string }>;
}) {
  const pathname = usePathname() ?? "";
  if (!rotaDeConfiguracaoDoOrcamento(pathname) || secoes.length < 2) return null;
  const ativo = hrefAtivoNaBarra(secoes, pathname);

  return (
    <nav aria-label="Configurações dos orçamentos" className="border-b border-border bg-background/60 print:hidden">
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
