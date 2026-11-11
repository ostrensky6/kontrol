"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HelpCircle, Search } from "lucide-react";

import { abrirAjudaContextual } from "@/components/layout/ContextHelp";
import { NAV_ICONS, type NavIcon } from "@/components/layout/SideNav";
import { SinoAvisos } from "@/components/layout/SinoAvisos";
import { Button } from "@/components/ui/button";
import { hrefAtivoNaBarra, moduleIsActive } from "@/config/modules";
import { cn } from "@/lib/utils";

export type ModuloDaBarra = {
  id: string;
  label: string;
  activePaths: string[];
  itens: Array<{ href: string; label: string; desc?: string; icon?: NavIcon; ativoTambem?: string[] }>;
};

export function abrirPaletaComandos() {
  window.dispatchEvent(new Event("kontrol:open-command-palette"));
}

/**
 * Barra do topo, a mesma em todas as telas (revisão de 11/11, 10.2): à
 * esquerda os lugares do módulo aberto; à direita a busca, o sino e a ajuda.
 * No celular a busca, o sino e a ajuda ficam na barra do logotipo.
 */
export function BarraSuperior({ modulos }: { modulos: ModuloDaBarra[] }) {
  const pathname = usePathname() ?? "";
  const modulo = modulos.find((item) => moduleIsActive(item, pathname));
  // módulo com um lugar só (Início, Projetos, Ajuda) não precisa de barra de lugares
  const itens = modulo && modulo.itens.length > 1 ? modulo.itens : [];
  const hrefAtivo = hrefAtivoNaBarra(itens, pathname);

  return (
    <div
      data-testid="barra-superior"
      className={cn(
        "border-b border-border bg-card/90 py-2 backdrop-blur print:hidden",
        itens.length === 0 && "hidden md:block",
      )}
    >
      <div className="app-topnav-container flex items-center gap-3">
        {modulo && itens.length > 0 ? (
          <nav aria-label={`Navegação de ${modulo.label}`} className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
            {itens.map((item) => {
              const ativo = item.href === hrefAtivo;
              const Icon = item.icon ? NAV_ICONS[item.icon] : undefined;
              return (
                <Button
                  key={item.href}
                  asChild
                  size="sm"
                  variant={ativo ? "default" : "outline"}
                  className={cn("shrink-0 gap-2", !ativo && "app-nav-level-2 dark:bg-card dark:hover:bg-primary/10")}
                >
                  <Link href={item.href} aria-current={ativo ? "page" : undefined} title={item.desc?.replaceAll("**", "")}>
                    {Icon && <Icon className="h-3.5 w-3.5" />}
                    <span>{item.label}</span>
                  </Link>
                </Button>
              );
            })}
          </nav>
        ) : (
          <div className="flex-1" />
        )}

        <div role="group" aria-label="Busca, avisos e ajuda" className="hidden shrink-0 items-center gap-1 md:flex">
          <Button
            type="button"
            variant="outline"
            onClick={abrirPaletaComandos}
            aria-label="Buscar ou executar"
            className="h-9 gap-2 border-border bg-background px-2.5 text-sm text-muted-foreground shadow-none hover:text-foreground"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            <span className="hidden lg:inline">Buscar</span>
            <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground lg:inline">
              Ctrl K
            </kbd>
          </Button>
          <SinoAvisos />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={abrirAjudaContextual}
            aria-label="Ajuda contextual"
            title="Ajuda desta tela"
            className="h-9 w-9 text-muted-foreground hover:text-foreground"
          >
            <HelpCircle className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
