"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HelpCircle, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { abrirAjudaContextual } from "@/components/layout/ContextHelp";
import { KontrolLogo } from "@/components/brand/KontrolLogo";
import { SideNav, type NavGroup } from "@/components/layout/SideNav";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { sair } from "@/lib/actions/auth";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";

const PAPEL_LABEL: Record<string, string> = {
  tecnico: "Técnico",
  coordenador: "Coordenador",
  gestor: "Gestor",
  admin: "Admin",
};
const SIDEBAR_COLLAPSED_STORAGE_KEY = "kontrol:sidebar:collapsed";

type Perfil = { nome: string | null; email: string | null; papel: string } | null;

function abrirPaletaComandos() {
  window.dispatchEvent(new Event("kontrol:open-command-palette"));
}

/** Conteúdo da barra (logo + navegação + sessão), reutilizado no rail e no drawer. */
function SidebarContent({
  groups,
  perfil,
  userEmail,
  onNavigate,
  onCollapse,
}: {
  groups: NavGroup[];
  perfil: Perfil;
  userEmail: string | null;
  onNavigate?: () => void;
  onCollapse?: () => void;
}) {
  return (
    <>
      <Link
        href="/"
        onClick={onNavigate}
        className="flex items-center justify-center border-b border-border/70 px-4 py-4"
      >
        <KontrolLogo
          className="h-auto w-40 max-w-full object-contain"
          fetchPriority="high"
        />
      </Link>

      <div className="border-b border-border/70 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={abrirPaletaComandos}
            className="h-8 min-w-0 flex-1 justify-start gap-2 border-border bg-background text-sm text-muted-foreground shadow-none hover:text-foreground"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="min-w-0 flex-1 truncate text-left">Buscar ou executar</span>
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              Ctrl K
            </kbd>
          </Button>
          {onCollapse && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onCollapse}
              aria-label="Colapsar menu"
              title="Colapsar menu"
              className="hidden h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground md:inline-flex"
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <SideNav groups={groups} onNavigate={onNavigate} />

      <div className="border-t border-border/70 px-5 py-3">
        <p className="truncate text-xs font-medium text-foreground">
          {perfil?.nome || perfil?.email || userEmail}
        </p>
        <div className="mt-1.5 flex items-center justify-between">
          {perfil?.papel && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {PAPEL_LABEL[perfil.papel] ?? perfil.papel}
            </span>
          )}
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <form action={sair}>
              <button className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-danger-soft hover:text-danger-strong">
                Sair
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}

function CollapsedSidebar({
  groups,
  onExpand,
}: {
  groups: NavGroup[];
  onExpand: () => void;
}) {
  return (
    <aside className="hidden shrink-0 flex-col border-r border-border bg-card md:sticky md:top-0 md:flex md:h-dvh md:w-14 md:items-center md:shadow-[1px_0_0_0_rgba(15,23,42,0.04),4px_0_24px_-12px_rgba(15,23,42,0.12)]">
      <Link
        href="/"
        className="flex h-14 w-full items-center justify-center border-b border-border/70"
        title="Início"
        aria-label="Início"
      >
        <span className="h-9 w-9 overflow-hidden">
          <KontrolLogo
            className="h-9 w-auto max-w-none object-contain object-left"
            fetchPriority="high"
          />
        </span>
      </Link>

      <div className="flex w-full flex-col items-center gap-1 border-b border-border/70 px-2 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onExpand}
          aria-label="Expandir menu"
          title="Expandir menu"
          className="h-10 w-10 text-muted-foreground hover:text-foreground"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={abrirPaletaComandos}
          aria-label="Buscar ou executar"
          title="Buscar ou executar"
          className="h-10 w-10 text-muted-foreground hover:text-foreground"
        >
          <Search className="h-4 w-4" />
        </Button>
      </div>

      <SideNav groups={groups} collapsed />

      <div className="flex w-full flex-col items-center gap-1 border-t border-border/70 px-2 py-3">
        <ThemeToggle />
        <form action={sair}>
          <button
            type="submit"
            aria-label="Sair"
            title="Sair"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-danger-soft hover:text-danger-strong"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </aside>
  );
}

export function Sidebar({
  groups,
  perfil,
  userEmail,
}: {
  groups: NavGroup[];
  perfil: Perfil;
  userEmail: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const fechar = () => setOpen(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true");
    } catch {
      // Preferimos o estado inicial deterministico se a preferencia local falhar.
    }
  }, []);

  function atualizarCollapsed(next: boolean) {
    setCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
    } catch {
      // Persistencia da preferencia visual e opcional.
    }
  }

  return (
    <>
      {/* Barra superior (só mobile). A folha A4 impressa é mais estreita que o
          breakpoint md: sem print:hidden, o logo do Kontrol saía na proposta. */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-card/95 px-4 py-2.5 backdrop-blur md:hidden print:hidden">
        <Button
          type="button"
          aria-label="Abrir menu"
          onClick={() => setOpen(true)}
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <Link
          href="/"
          className="flex items-center gap-2 font-bold tracking-tight text-foreground"
        >
          <KontrolLogo
            className="h-9 w-auto max-w-32 object-contain"
            fetchPriority="high"
          />
        </Link>
        <div className="flex items-center">
          {/* No celular a ajuda contextual abre daqui, e não por um botão flutuante. */}
          <Button
            type="button"
            aria-label="Ajuda contextual"
            onClick={abrirAjudaContextual}
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground"
          >
            <HelpCircle className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            aria-label="Buscar ou executar ação"
            onClick={abrirPaletaComandos}
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground"
          >
            <Search className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Rail estática (desktop) */}
      {collapsed ? (
        <CollapsedSidebar groups={groups} onExpand={() => atualizarCollapsed(false)} />
      ) : (
        <aside className="hidden shrink-0 flex-col border-r border-border bg-card md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shadow-[1px_0_0_0_rgba(15,23,42,0.04),4px_0_24px_-12px_rgba(15,23,42,0.12)]">
          <SidebarContent
            groups={groups}
            perfil={perfil}
            userEmail={userEmail}
            onCollapse={() => atualizarCollapsed(true)}
          />
        </aside>
      )}

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent
          className="left-0 right-auto w-[18rem] max-w-[86vw] border-l-0 border-r border-border bg-card p-0 md:hidden"
          showCloseButton
        >
          <DrawerTitle className="sr-only">Menu de navegação</DrawerTitle>
          <DrawerDescription className="sr-only">
            Acesse módulos do Kontrol App e ações rápidas.
          </DrawerDescription>
          <SidebarContent
            groups={groups}
            perfil={perfil}
            userEmail={userEmail}
            onNavigate={fechar}
          />
        </DrawerContent>
      </Drawer>
    </>
  );
}
