"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ArchiveRestore,
  Bell,
  Boxes,
  Bug,
  Building2,
  Calculator,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Database,
  DollarSign,
  FileText,
  FlaskConical,
  FolderKanban,
  FolderOpen,
  History,
  Inbox,
  LayoutGrid,
  LifeBuoy,
  MapPin,
  Microscope,
  PackageCheck,
  PackageSearch,
  Percent,
  ScanLine,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Tag,
  TestTube2,
  Truck,
  UserCog,
  UsersRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { moduleIsActive } from "@/config/modules";

export type Accent = "brand" | "blue" | "amber" | "violet" | "slate";
export const NAV_ICONS = {
  Activity,
  ArchiveRestore,
  Bell,
  Boxes,
  Bug,
  Building2,
  Calculator,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Database,
  DollarSign,
  FileText,
  FlaskConical,
  FolderKanban,
  FolderOpen,
  History,
  Inbox,
  LayoutGrid,
  LifeBuoy,
  MapPin,
  Microscope,
  PackageCheck,
  PackageSearch,
  Percent,
  ScanLine,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Tag,
  TestTube2,
  Truck,
  UserCog,
  UsersRound,
  Wrench,
} satisfies Record<string, LucideIcon>;

export type NavIcon = keyof typeof NAV_ICONS;
export type NavLink = {
  href: string;
  label: string;
  desc?: string;
  icon?: NavIcon;
  shortcut?: string;
};
export type NavGroup = {
  title: string;
  accent: Accent;
  icon?: NavIcon;
  href?: string;
  desc?: string;
  activePaths?: string[];
  links: NavLink[];
};

export function SideNav({
  groups,
  onNavigate,
  collapsed = false,
}: {
  groups: NavGroup[];
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();

  function grupoAtivo(group: NavGroup) {
    if (group.activePaths?.length) return moduleIsActive({ activePaths: group.activePaths }, pathname);
    const href = group.href ?? group.links[0]?.href;
    return Boolean(href && (pathname === href || pathname.startsWith(href + "/")));
  }

  if (collapsed) {
    return (
      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Navegação compacta">
        <ul className="space-y-1">
          {groups.map((g) => {
            const ativo = grupoAtivo(g);
            const LinkIcone = g.icon ? NAV_ICONS[g.icon] : Activity;
            const href = g.href ?? g.links[0]?.href ?? "/";
            return (
              <li key={g.title}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  title={g.title}
                  aria-label={g.title}
                  className={cn(
                    "relative flex h-10 w-10 items-center justify-center rounded-md transition-colors",
                    ativo
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {ativo && (
                    <span
                      className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary"
                      aria-hidden="true"
                    />
                  )}
                  <LinkIcone className="h-4 w-4" />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Navegação principal">
      {groups.map((g) => {
        const GrupoIcone = g.icon ? NAV_ICONS[g.icon] : Activity;
        const temLinkAtivo = grupoAtivo(g);
        const href = g.href ?? g.links[0]?.href ?? "/";
        return (
          <Link
            key={g.title}
            href={href}
            onClick={onNavigate}
            className={cn(
              "mb-1.5 flex items-center gap-2 rounded-md px-2.5 py-2.5 text-left transition-colors last:mb-0",
              temLinkAtivo
                ? "bg-primary/10 font-semibold text-primary"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border",
                temLinkAtivo
                  ? "border-primary/30 bg-card text-primary"
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              <GrupoIcone className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold leading-5">{g.title}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
