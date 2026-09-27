import type { Accent, NavGroup, NavIcon, NavLink } from "@/components/layout/SideNav";
import { getCadastrosOrdenados } from "@/lib/cadastros/config";
import { acessoDaRota } from "@/config/acesso-modulos";

export const ORDEM_PAPEIS = ["tecnico", "coordenador", "gestor", "admin"] as const;

export type Role = (typeof ORDEM_PAPEIS)[number];
export type NavigationProfile = {
  papel?: string | null;
  /** permissões efetivas (0124); sem elas, vale só o papel mínimo */
  permissoes?: { admin: boolean; permissoes: Record<string, boolean> } | null;
} | null;

export type AppModuleId =
  | "operacao"
  | "suprimentos"
  | "orcamentos"
  | "cadastros"
  | "ajuda"
  | "governanca";

export type ModuleChild = NavLink & {
  minRole?: Role;
  showInTopNav?: boolean;
};

export type AppModule = {
  id: AppModuleId;
  label: string;
  href: string;
  desc: string;
  icon: NavIcon;
  accent: Accent;
  minRole?: Role;
  activePaths: string[];
  children: ModuleChild[];
};

export function nivelDoPapel(papel?: string | null) {
  return papel ? ORDEM_PAPEIS.indexOf(papel as Role) : -1;
}

export function permiteMinRole(perfil: NavigationProfile, minRole?: Role) {
  if (!minRole) return true;
  const papelAtual = nivelDoPapel(perfil?.papel);
  const papelMinimo = ORDEM_PAPEIS.indexOf(minRole);
  return papelAtual >= papelMinimo;
}

const cadastroChildren = getCadastrosOrdenados().map((cadastro) => ({
  href: `/cadastros/${cadastro.slug}`,
  label: cadastro.titulo,
  desc: cadastro.subtitulo,
  icon: "Database" as const,
}));

export const APP_MODULES: AppModule[] = [
  {
    id: "cadastros",
    label: "Cadastros",
    href: "/cadastros",
    desc: "dados mestres do laboratório",
    icon: "Database",
    accent: "violet",
    activePaths: ["/cadastros"],
    children: [
      {
        href: "/cadastros",
        label: "Todos os cadastros",
        desc: "índice, exportação e importação dos dados mestres",
        icon: "LayoutGrid",
        shortcut: "D",
      },
      ...cadastroChildren,
    ],
  },
  {
    id: "operacao",
    label: "Operação",
    href: "/operacao",
    desc: "análises, receitas e custo técnico",
    icon: "Activity",
    accent: "brand",
    activePaths: ["/operacao", "/analises", "/insumos", "/custeio", "/parametros"],
    children: [
      {
        href: "/analises",
        label: "Análises",
        desc: "catálogo técnico, finalidade e matriz",
        icon: "FlaskConical",
        shortcut: "A",
      },
      {
        href: "/insumos",
        label: "Insumos por análise",
        desc: "reagentes, controles e perdas",
        icon: "TestTube2",
      },
      {
        href: "/custeio",
        label: "Custeio",
        desc: "custo técnico, overhead e preço base",
        icon: "Calculator",
        shortcut: "C",
      },
      {
        href: "/parametros",
        label: "Parâmetros de custeio",
        desc: "margem, impostos, taxas e fundos do preço",
        icon: "Percent",
        showInTopNav: false,
      },
    ],
  },
  {
    id: "suprimentos",
    label: "Suprimentos",
    href: "/suprimentos",
    desc: "estoque, compras e recebimento",
    icon: "PackageSearch",
    accent: "blue",
    activePaths: [
      "/suprimentos",
      "/estoque",
      "/planejamento",
      "/pedido",
      "/compras",
      "/recebimento",
      "/notificacoes",
      "/etiquetas",
      "/scanner",
    ],
    children: [
      {
        href: "/estoque",
        label: "Estoque",
        desc: "saldos, lotes, validade e rastreio",
        icon: "Boxes",
        shortcut: "E",
      },
      {
        href: "/estoque/controle",
        label: "Controle de Estoque",
        desc: "saldos, validades, alertas e quarentena",
        icon: "SlidersHorizontal",
        shortcut: "C",
      },
      {
        href: "/planejamento",
        label: "Planejamento",
        desc: "necessidades, reservas e consumo previsto",
        icon: "CalendarClock",
        shortcut: "P",
      },
      {
        href: "/pedido",
        label: "Pedidos internos",
        desc: "pedidos do laboratório para compra",
        icon: "ClipboardList",
      },
      {
        href: "/compras",
        label: "Compras",
        desc: "solicitações, pedidos e recebimento",
        icon: "ShoppingCart",
      },
      {
        href: "/recebimento",
        label: "Recebimento",
        desc: "itens de pedidos por estágio até a chegada",
        icon: "PackageCheck",
      },
      {
        href: "/notificacoes",
        label: "Notificações",
        desc: "alertas operacionais de estoque e suprimentos",
        icon: "Bell",
      },
      {
        href: "/estoque/equipamentos",
        label: "Controle de Equipamentos",
        desc: "unidades físicas, calibrações e manutenções",
        icon: "Wrench",
        showInTopNav: false,
      },
      {
        href: "/estoque/inventario",
        label: "Inventário",
        desc: "contagem por local e lote, com ajuste de divergências",
        icon: "ClipboardCheck",
      },
      {
        href: "/etiquetas",
        label: "Etiquetas",
        desc: "etiquetas com QR code para lotes e equipamentos",
        icon: "Tag",
        showInTopNav: false,
      },
      {
        href: "/scanner/triagem",
        label: "Códigos não reconhecidos",
        desc: "triagem de códigos lidos que ainda não têm cadastro",
        icon: "ScanLine",
        showInTopNav: false,
      },
    ],
  },
  {
    id: "orcamentos",
    label: "Orçamentos",
    href: "/orcamento/demandas",
    desc: "propostas, parâmetros e histórico",
    icon: "FileText",
    accent: "amber",
    activePaths: ["/orcamento", "/projetos"],
    children: [
      {
        href: "/orcamento/demandas",
        label: "Orçamentos",
        desc: "entrada comercial e orçamentos pendentes",
        icon: "Inbox",
        shortcut: "O",
      },
      {
        href: "/orcamento/demandas/nova",
        label: "Novo orçamento",
        desc: "abre diretamente o formulário de entrada comercial",
        icon: "FileText",
      },
      {
        href: "/orcamento/historico",
        label: "Histórico de orçamentos",
        desc: "consulta de versões concluídas",
        icon: "History",
      },
      {
        href: "/projetos",
        label: "Visão por projeto",
        desc: "orçamentos, planejamentos e compras de cada projeto",
        icon: "FolderKanban",
        showInTopNav: false,
      },
      {
        href: "/orcamento/fundos",
        label: "Fundos e taxas",
        desc: "recebimentos, impostos e fundos",
        icon: "DollarSign",
      },
      {
        href: "/orcamento/parametros",
        label: "Parâmetros econômicos",
        desc: "gross-up, índices e premissas financeiras",
        icon: "Percent",
        showInTopNav: false,
      },
      {
        href: "/orcamento/modelos",
        label: "Modelos",
        desc: "templates comerciais e modelos de proposta",
        icon: "LayoutGrid",
        showInTopNav: false,
      },
      {
        href: "/orcamento/governanca",
        label: "Regras do orçamento",
        desc: "validações e trilha de controles do orçamento",
        icon: "ShieldCheck",
        showInTopNav: false,
      },
    ],
  },
  {
    id: "ajuda",
    label: "Ajuda",
    href: "/ajuda",
    desc: "central de ajuda e orientações",
    icon: "LifeBuoy",
    accent: "blue",
    activePaths: ["/ajuda"],
    children: [
      {
        href: "/ajuda",
        label: "Central de Ajuda",
        desc: "orientações de todos os módulos do app",
        icon: "LifeBuoy",
      },
    ],
  },
  {
    id: "governanca",
    label: "Governança",
    href: "/governanca",
    desc: "auditoria, backups e permissões",
    icon: "ShieldCheck",
    accent: "slate",
    activePaths: ["/governanca", "/auditoria", "/usuarios"],
    children: [
      {
        href: "/auditoria",
        label: "Auditoria",
        desc: "trilha de alterações e eventos",
        icon: "History",
      },
      {
        href: "/governanca/backups",
        label: "Backups",
        desc: "app local e banco em nuvem",
        icon: "ArchiveRestore",
        minRole: "admin",
      },
      {
        href: "/usuarios",
        label: "Usuários e permissões",
        desc: "acessos, assinaturas e matriz de permissões",
        icon: "UserCog",
        minRole: "admin",
      },
      {
        href: "/governanca/privilegios",
        label: "Privilégios",
        desc: "matriz granular de permissões por papel",
        icon: "ShieldCheck",
        minRole: "admin",
      },
    ],
  },
];

/** A caixinha manda (0124): o item só aparece com a permissão "Acessar …" da área. */
export function permiteAcesso(perfil: NavigationProfile, href: string) {
  const efetivas = perfil?.permissoes;
  if (!efetivas || efetivas.admin) return true;
  const acesso = acessoDaRota(href);
  return !acesso || efetivas.permissoes[acesso.chave] === true;
}

export function filtrarChildrenPorPerfil(children: ModuleChild[], perfil: NavigationProfile) {
  return children.filter((child) => permiteMinRole(perfil, child.minRole) && permiteAcesso(perfil, child.href));
}

export function getModulesForProfile(perfil: NavigationProfile) {
  return APP_MODULES.map((module) => ({
    ...module,
    children: filtrarChildrenPorPerfil(module.children, perfil),
  })).filter((module) => permiteMinRole(perfil, module.minRole) && module.children.length > 0);
}

export function getModuleForProfile(moduleId: AppModuleId, perfil: NavigationProfile) {
  return getModulesForProfile(perfil).find((module) => module.id === moduleId) ?? null;
}

/**
 * Aba ativa da barra do módulo: o item cujo href é o prefixo mais longo da rota
 * atual. Evita duas abas ativas quando um href é prefixo de outro
 * (ex.: /estoque e /estoque/controle).
 */
export function hrefAtivoNaBarra(items: Pick<ModuleChild, "href">[], pathname: string) {
  let melhor: string | null = null;
  for (const { href } of items) {
    const casa = pathname === href || pathname.startsWith(href + "/");
    if (casa && (melhor === null || href.length > melhor.length)) melhor = href;
  }
  return melhor;
}

export function moduleIsActive(module: Pick<AppModule, "activePaths">, pathname: string) {
  return module.activePaths.some((path) => pathname === path || pathname.startsWith(path + "/"));
}

export function getSidebarGroups(perfil: NavigationProfile): NavGroup[] {
  return getModulesForProfile(perfil).map((module) => ({
    title: module.label,
    href: module.href,
    desc: module.desc,
    accent: module.accent,
    icon: module.icon,
    activePaths: module.activePaths,
    links: [],
  }));
}

export function getCommandGroups(perfil: NavigationProfile): NavGroup[] {
  return getModulesForProfile(perfil).map((module) => ({
    title: module.label,
    accent: module.accent,
    icon: module.icon,
    links: module.children,
  }));
}
