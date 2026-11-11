import type { Accent, NavGroup, NavIcon, NavLink } from "@/components/layout/SideNav";
import { getCadastrosOrdenados } from "@/lib/cadastros/config";
import { GRUPOS_CADASTROS, rotaDoGrupo } from "@/lib/cadastros/grupos";
import { acessoDaRota } from "@/config/acesso-modulos";
import { nivelPapel, papelAlcanca, type PapelUsuario } from "@/lib/auth/permissions";

export type Role = PapelUsuario;
export type NavigationProfile = {
  papel?: string | null;
  /** permissões efetivas (0124); sem elas, vale só o papel mínimo */
  permissoes?: { admin: boolean; permissoes: Record<string, boolean> } | null;
} | null;

export type AppModuleId =
  | "inicio"
  | "projetos"
  | "operacao"
  | "suprimentos"
  | "orcamentos"
  | "cadastros"
  | "ajuda"
  | "governanca";

export type ModuleChild = NavLink & {
  minRole?: Role;
  showInTopNav?: boolean;
  /** false: o item existe só na barra do módulo (ex.: "Configurações", que abre a primeira tela do grupo) */
  showInCommand?: boolean;
  /** outras rotas em que este item fica marcado na barra (ex.: /compras em Pedidos) */
  ativoTambem?: string[];
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
  return nivelPapel(papel);
}

export function permiteMinRole(perfil: NavigationProfile, minRole?: Role) {
  if (!minRole) return true;
  return papelAlcanca(perfil?.papel, minRole);
}

// cada cadastro continua na busca (Ctrl+K); na barra aparecem os 4 grupos (revisão de 11/11, 8.8)
const cadastroChildren: ModuleChild[] = getCadastrosOrdenados().map((cadastro) => ({
  href: `/cadastros/${cadastro.slug}`,
  label: cadastro.titulo,
  desc: cadastro.subtitulo,
  icon: "Database" as const,
  showInTopNav: false,
}));

const grupoCadastroChildren: ModuleChild[] = GRUPOS_CADASTROS.map((grupo) => ({
  href: rotaDoGrupo(grupo.id),
  label: grupo.label,
  desc: grupo.desc,
  icon: "Database" as const,
  ativoTambem: grupo.slugs.map((slug) => `/cadastros/${slug}`),
  showInCommand: false,
}));

export const APP_MODULES: AppModule[] = [
  {
    id: "inicio",
    label: "Início",
    href: "/",
    desc: "o que depende de você e o que precisa de atenção hoje",
    icon: "Home",
    accent: "brand",
    // os avisos vêm de todos os módulos: abrem pelo sino do topo, não por uma barra (L2)
    activePaths: ["/", "/notificacoes"],
    children: [
      {
        href: "/",
        label: "Início",
        desc: "pendências, números do dia e o que precisa de atenção",
        icon: "Home",
      },
      {
        href: "/notificacoes",
        label: "Notificações",
        desc: "avisos para você",
        icon: "Bell",
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
    activePaths: ["/orcamento"],
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
        // barra é para lugares, não para ações: o botão fica na lista de Orçamentos
        showInTopNav: false,
      },
      {
        href: "/orcamento/historico",
        label: "Histórico de orçamentos",
        desc: "consulta de versões concluídas",
        icon: "History",
      },
      {
        href: "/orcamento/fundos",
        label: "Fundos e taxas",
        desc: "recebimentos, impostos e fundos",
        icon: "DollarSign",
      },
      {
        // abre a primeira tela do grupo; as três ficam nas abas de Configurações (L5)
        href: "/orcamento/configuracoes",
        label: "Configurações",
        desc: "parâmetros econômicos, documento da proposta e modelos",
        icon: "SlidersHorizontal",
        ativoTambem: ["/orcamento/parametros", "/orcamento/documento-proposta", "/orcamento/modelos"],
        showInCommand: false,
      },
      {
        href: "/orcamento/parametros",
        label: "Parâmetros econômicos",
        desc: "gross-up, índices e premissas financeiras",
        icon: "Percent",
        showInTopNav: false,
      },
      {
        href: "/orcamento/documento-proposta",
        label: "Documento da proposta",
        desc: "dados das empresas emissoras e textos padrão",
        icon: "FileText",
        showInTopNav: false,
      },
      {
        href: "/orcamento/modelos",
        label: "Modelos e catálogo",
        desc: "templates comerciais e modelos de proposta",
        icon: "LayoutGrid",
        showInTopNav: false,
      },
    ],
  },
  {
    // o projeto liga orçamento, plano, pedido e custo: não é de um módulo só (L4)
    id: "projetos",
    label: "Projetos",
    href: "/projetos",
    desc: "orçamentos, planejamentos e compras de cada projeto",
    icon: "FolderKanban",
    accent: "amber",
    activePaths: ["/projetos"],
    children: [
      {
        href: "/projetos",
        label: "Projetos",
        desc: "orçamentos, planejamentos e compras de cada projeto",
        icon: "FolderKanban",
      },
    ],
  },
  {
    id: "suprimentos",
    label: "Suprimentos",
    href: "/suprimentos",
    desc: "estoque, pedidos e recebimento",
    icon: "PackageSearch",
    accent: "blue",
    activePaths: [
      "/suprimentos",
      "/estoque",
      "/planejamento",
      "/pedido",
      "/compras",
      "/recebimento",
      "/etiquetas",
      "/scanner",
    ],
    // Uma barra só, um link por tarefa. As ferramentas do estoque (leitura,
    // inventário, etiquetas, triagem) ficam na barra própria do Estoque; as
    // compras formais e os prazos ficam dentro de Pedidos. Os itens ocultos
    // continuam na busca (Ctrl+K).
    children: [
      {
        href: "/suprimentos",
        label: "Visão geral",
        desc: "o que temos em estoque e o que precisa de atenção",
        icon: "LayoutGrid",
      },
      {
        href: "/estoque",
        label: "Estoque",
        desc: "saldos, lotes, entradas, baixas e validade",
        icon: "Boxes",
        shortcut: "E",
        ativoTambem: ["/etiquetas", "/scanner"],
      },
      {
        href: "/planejamento",
        label: "Planejamento",
        desc: "reservas de insumo para as análises previstas",
        icon: "CalendarClock",
        shortcut: "P",
      },
      {
        href: "/pedido",
        label: "Pedidos",
        desc: "cada pedido e a etapa em que está, da solicitação ao pagamento",
        icon: "ClipboardList",
        ativoTambem: ["/compras", "/suprimentos/prazos"],
      },
      {
        href: "/recebimento",
        label: "Recebimento",
        desc: "registrar a chegada do que foi comprado",
        icon: "PackageCheck",
      },
      {
        href: "/estoque/equipamentos",
        label: "Equipamentos",
        desc: "unidades físicas, calibrações e manutenções",
        icon: "Wrench",
      },
      {
        href: "/estoque/situacao",
        label: "Situação do estoque",
        desc: "painel de alertas: saldo, compra, validade e lotes",
        icon: "SlidersHorizontal",
        showInTopNav: false,
      },
      {
        href: "/estoque/custos",
        label: "Custo do estoque",
        desc: "relatório: custo do cadastro × custo dos lotes liberados",
        icon: "SlidersHorizontal",
        showInTopNav: false,
      },
      {
        href: "/estoque/leitura",
        label: "Entrada e saída por leitura",
        desc: "código de barras do fabricante: entrada e abertura de embalagem",
        icon: "ScanLine",
        showInTopNav: false,
      },
      {
        href: "/estoque/inventario",
        label: "Inventário",
        desc: "contagem por insumo ou por lote, com ajuste de divergências",
        icon: "ClipboardCheck",
        showInTopNav: false,
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
      {
        href: "/planejamento/disputas",
        label: "Disputas de reserva",
        desc: "pedir e decidir reserva de outro plano quando falta insumo",
        icon: "ClipboardCheck",
        showInTopNav: false,
      },
      {
        href: "/compras",
        label: "Compras formais",
        desc: "registro das compras com fornecedor, ligadas aos pedidos",
        icon: "ShoppingCart",
        showInTopNav: false,
      },
      {
        href: "/suprimentos/prazos",
        label: "Prazos de compra",
        desc: "quanto tempo as compras levaram, do pedido à chegada",
        icon: "CalendarClock",
        showInTopNav: false,
      },
    ],
  },
  {
    id: "operacao",
    label: "Análises e custeio",
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
        label: "Visão geral",
        desc: "todos os cadastros e o que falta preencher",
        icon: "LayoutGrid",
        shortcut: "D",
      },
      ...grupoCadastroChildren,
      ...cadastroChildren,
    ],
  },
  {
    id: "governanca",
    label: "Governança",
    href: "/governanca",
    desc: "auditoria, incidentes, backups, erros, usuários, privilégios e regras",
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
        href: "/governanca/incidentes",
        label: "Incidentes",
        desc: "o que aconteceu, quem foi afetado e o que fazer",
        icon: "Activity",
      },
      {
        href: "/governanca/backups",
        label: "Backups",
        desc: "app local e banco em nuvem",
        icon: "ArchiveRestore",
        minRole: "admin",
      },
      {
        href: "/governanca/erros",
        label: "Erros do app",
        desc: "falhas registradas e avisos ao administrador",
        icon: "Bug",
        minRole: "admin",
      },
      {
        href: "/usuarios",
        label: "Usuários",
        desc: "acessos, funções, assinaturas e senhas",
        icon: "UserCog",
        minRole: "admin",
      },
      {
        href: "/governanca/privilegios",
        label: "Privilégios",
        desc: "o que cada função pode ver e fazer",
        icon: "ShieldCheck",
        minRole: "admin",
      },
      {
        href: "/governanca/regras",
        label: "Regras do orçamento",
        desc: "ações sensíveis do orçamento e quem alterou cada campo",
        icon: "ClipboardCheck",
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
  }
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
 * (ex.: /estoque e /estoque/situacao).
 */
export function hrefAtivoNaBarra(items: Pick<ModuleChild, "href" | "ativoTambem">[], pathname: string) {
  let melhor: { href: string; tamanho: number } | null = null;
  for (const { href, ativoTambem } of items) {
    for (const caminho of [href, ...(ativoTambem ?? [])]) {
      const casa = pathname === caminho || pathname.startsWith(caminho + "/");
      if (casa && (melhor === null || caminho.length > melhor.tamanho)) melhor = { href, tamanho: caminho.length };
    }
  }
  return melhor?.href ?? null;
}

export function moduleIsActive(module: Pick<AppModule, "activePaths">, pathname: string) {
  return module.activePaths.some((path) => pathname === path || pathname.startsWith(path + "/"));
}

export function getSidebarGroups(perfil: NavigationProfile): NavGroup[] {
  return getModulesForProfile(perfil).map((module) => ({
    title: module.label,
    // sem acesso à página inicial do módulo, o menu abre o primeiro item que a pessoa vê
    href: permiteAcesso(perfil, module.href) ? module.href : (module.children[0]?.href ?? module.href),
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
    links: module.children.filter((child) => child.showInCommand !== false),
  }));
}
