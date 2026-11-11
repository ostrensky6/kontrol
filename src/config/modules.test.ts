import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  hrefAtivoNaBarra,
  APP_MODULES,
  getCommandGroups,
  getModulesForProfile,
  moduleIsActive,
} from "./modules";

const APP_DIR = path.resolve(__dirname, "../app");

function paginaExiste(href: string) {
  const segmentos = href.split("/").filter(Boolean);
  return existsSync(path.join(APP_DIR, ...segmentos, "page.tsx"));
}

function modulo(id: string) {
  const encontrado = APP_MODULES.find((item) => item.id === id);
  if (!encontrado) throw new Error(`módulo ${id} ausente`);
  return encontrado;
}

describe("APP_MODULES", () => {
  it("todo link aponta para uma página existente", () => {
    const hrefs = APP_MODULES.flatMap((item) => item.children.map((child) => child.href));
    const quebrados = hrefs.filter(
      (href) => !href.startsWith("/cadastros/") && !paginaExiste(href),
    );
    expect(quebrados).toEqual([]);
  });

  it("não repete o mesmo link dentro de um módulo", () => {
    for (const item of APP_MODULES) {
      const hrefs = item.children.map((child) => child.href);
      expect(new Set(hrefs).size, item.id).toBe(hrefs.length);
    }
  });

  it("alcança as páginas que antes não tinham entrada na navegação", () => {
    const todos = APP_MODULES.flatMap((item) => item.children.map((child) => child.href));
    expect(todos).toEqual(
      expect.arrayContaining([
        "/projetos",
        "/parametros",
        "/estoque/inventario",
        "/estoque/leitura",
        "/etiquetas",
        "/scanner/triagem",
      ]),
    );
  });

  it("marca o módulo certo como ativo para as novas rotas", () => {
    expect(moduleIsActive(modulo("projetos"), "/projetos/7")).toBe(true);
    expect(moduleIsActive(modulo("orcamentos"), "/projetos/7")).toBe(false);
    expect(moduleIsActive(modulo("operacao"), "/parametros")).toBe(true);
    expect(moduleIsActive(modulo("suprimentos"), "/estoque/inventario")).toBe(true);
    expect(moduleIsActive(modulo("suprimentos"), "/estoque/leitura")).toBe(true);
    expect(moduleIsActive(modulo("suprimentos"), "/etiquetas")).toBe(true);
    expect(moduleIsActive(modulo("suprimentos"), "/scanner/triagem")).toBe(true);
    expect(moduleIsActive(modulo("projetos"), "/projetosx")).toBe(false);
  });

  // A caixinha manda (0124): cada área aparece só com a permissão "Acessar …".
  const comPermissoes = (papel: string, chaves: string[]) => ({
    papel,
    permissoes: { admin: false, permissoes: Object.fromEntries(chaves.map((chave) => [chave, true])) },
  });

  it("parâmetros de custeio aparecem só com a permissão da área", () => {
    const sem = comPermissoes("laboratorio", ["estoque.ver", "projetos.ver"]);
    const com = comPermissoes("laboratorio", ["estoque.ver", "projetos.ver", "configuracoes.ver"]);
    const hrefsSem = getCommandGroups(sem).flatMap((g) => g.links.map((l) => l.href));
    const hrefsCom = getCommandGroups(com).flatMap((g) => g.links.map((l) => l.href));
    expect(hrefsSem).not.toContain("/parametros");
    expect(hrefsCom).toContain("/parametros");
    expect(hrefsSem).toEqual(expect.arrayContaining(["/estoque/inventario", "/projetos"]));
  });

  it("área sem permissão some do menu, mesmo para quem tem o papel", () => {
    const hrefs = getCommandGroups(comPermissoes("gestor", ["compras.ver"])).flatMap((g) => g.links.map((l) => l.href));
    expect(hrefs).toContain("/compras");
    expect(hrefs).not.toContain("/orcamento/demandas");
    expect(hrefs).not.toContain("/estoque");
  });

  it("governança: incidentes para todos, auditoria com a caixinha; usuários e backups só do admin", () => {
    const laboratorio = getModulesForProfile(comPermissoes("laboratorio", []));
    expect(laboratorio.find((m) => m.id === "governanca")?.children.map((c) => c.href)).toEqual(["/governanca/incidentes"]);
    const gestor = getModulesForProfile(comPermissoes("gestor", ["auditoria.visualizar"]));
    const governanca = gestor.find((m) => m.id === "governanca");
    // Regras do orçamento passou para a Governança (L6) e segue a caixinha "Ver auditoria"
    expect(governanca?.children.map((c) => c.href)).toEqual(["/auditoria", "/governanca/incidentes", "/governanca/regras"]);
    const admin = getModulesForProfile({ papel: "admin", permissoes: { admin: true, permissoes: {} } });
    expect(admin.find((m) => m.id === "governanca")?.children.map((c) => c.href)).toEqual(
      expect.arrayContaining(["/auditoria", "/usuarios", "/governanca/backups"]),
    );
  });
});

const itens = [{ href: "/estoque" }, { href: "/estoque/controle" }, { href: "/pedido" }];

describe("hrefAtivoNaBarra", () => {
  it("escolhe o prefixo mais longo, deixando uma única aba ativa", () => {
    expect(hrefAtivoNaBarra(itens, "/estoque/controle")).toBe("/estoque/controle");
    expect(hrefAtivoNaBarra(itens, "/estoque/controle/123")).toBe("/estoque/controle");
    expect(hrefAtivoNaBarra(itens, "/estoque/lotes/9")).toBe("/estoque");
  });

  it("não confunde rotas com o mesmo início de nome", () => {
    expect(hrefAtivoNaBarra([{ href: "/pedido" }], "/pedidos")).toBeNull();
  });

  it("retorna null fora das abas do módulo", () => {
    expect(hrefAtivoNaBarra(itens, "/compras")).toBeNull();
  });

  it("Orçamentos: a demanda ativa só 'Orçamentos não finalizados'", () => {
    const orcamentos = APP_MODULES.find((m) => m.id === "orcamentos")!;
    expect(hrefAtivoNaBarra(orcamentos.children, "/orcamento/demandas/1")).toBe("/orcamento/demandas");
    expect(hrefAtivoNaBarra(orcamentos.children, "/orcamento/demandas/nova")).toBe("/orcamento/demandas/nova");
    expect(orcamentos.children.some((c) => c.href === "/orcamento")).toBe(false);
  });

  it("Suprimentos: uma barra só, sem link repetido, com as ferramentas do estoque fora dela", () => {
    const suprimentos = APP_MODULES.find((m) => m.id === "suprimentos")!;
    const visiveis = suprimentos.children.filter((c) => c.showInTopNav !== false);
    expect(visiveis.map((c) => c.label)).toEqual([
      "Visão geral",
      "Estoque",
      "Planejamento",
      "Pedidos",
      "Recebimento",
      "Equipamentos",
    ]);
    // os avisos vêm de todos os módulos: saíram da barra de Suprimentos e abrem pelo sino (L2)
    expect(suprimentos.children.map((c) => c.href)).not.toContain("/notificacoes");
    expect(moduleIsActive(suprimentos, "/notificacoes")).toBe(false);
    // cada rota marca exatamente o item da tarefa
    expect(hrefAtivoNaBarra(visiveis, "/suprimentos")).toBe("/suprimentos");
    expect(hrefAtivoNaBarra(visiveis, "/suprimentos/prazos")).toBe("/pedido");
    expect(hrefAtivoNaBarra(visiveis, "/compras/12")).toBe("/pedido");
    expect(hrefAtivoNaBarra(visiveis, "/estoque/controle")).toBe("/estoque");
    expect(hrefAtivoNaBarra(visiveis, "/estoque/inventario")).toBe("/estoque");
    expect(hrefAtivoNaBarra(visiveis, "/etiquetas")).toBe("/estoque");
    expect(hrefAtivoNaBarra(visiveis, "/scanner/triagem")).toBe("/estoque");
    expect(hrefAtivoNaBarra(visiveis, "/estoque/equipamentos/3")).toBe("/estoque/equipamentos");
    expect(hrefAtivoNaBarra(visiveis, "/planejamento/disputas")).toBe("/planejamento");
  });

  it("Operação mostra Análises, Insumos por análise e Custeio na barra", () => {
    const operacao = APP_MODULES.find((m) => m.id === "operacao")!;
    const visiveis = operacao.children.filter((c) => c.showInTopNav !== false).map((c) => c.href);
    expect(visiveis).toEqual(["/analises", "/insumos", "/custeio"]);
  });
});

describe("revisão de 11/11: barra lateral e lugares", () => {
  const admin = { papel: "admin", permissoes: { admin: true, permissoes: {} } };

  it("barra lateral começa em Início, tem Projetos e chama Operação de Análises e custeio", async () => {
    const { getSidebarGroups } = await import("./modules");
    expect(getSidebarGroups(admin).map((g) => g.title)).toEqual([
      "Início",
      "Orçamentos",
      "Projetos",
      "Suprimentos",
      "Análises e custeio",
      "Cadastros",
      "Governança",
      "Ajuda",
    ]);
  });

  it("Início só fica ativo na página inicial e em Notificações, que continua na busca", () => {
    expect(moduleIsActive(modulo("inicio"), "/")).toBe(true);
    expect(moduleIsActive(modulo("inicio"), "/notificacoes")).toBe(true);
    expect(modulo("inicio").children.filter((c) => c.showInTopNav !== false).map((c) => c.href)).toEqual(["/"]);
    expect(getCommandGroups(admin).flatMap((g) => g.links.map((l) => l.href))).toContain("/notificacoes");
    expect(moduleIsActive(modulo("inicio"), "/estoque")).toBe(false);
    expect(moduleIsActive(modulo("inicio"), "/orcamento/demandas")).toBe(false);
  });

  it("uma rota marca um único item da barra lateral", () => {
    const rotas = ["/", "/notificacoes", "/projetos/3", "/orcamento/parametros", "/governanca/regras", "/estoque", "/custeio", "/cadastros/insumos", "/ajuda"];
    for (const rota of rotas) {
      expect(APP_MODULES.filter((m) => moduleIsActive(m, rota)).map((m) => m.id), rota).toHaveLength(1);
    }
    expect(moduleIsActive(modulo("governanca"), "/governanca/regras")).toBe(true);
  });

  it("Orçamentos: Configurações marca as três telas e não repete na busca", () => {
    const visiveis = modulo("orcamentos").children.filter((c) => c.showInTopNav !== false);
    expect(visiveis.map((c) => c.label)).toEqual(["Orçamentos", "Histórico de orçamentos", "Fundos e taxas", "Configurações"]);
    for (const rota of ["/orcamento/parametros", "/orcamento/documento-proposta", "/orcamento/modelos", "/orcamento/modelos/planilha"]) {
      expect(hrefAtivoNaBarra(visiveis, rota), rota).toBe("/orcamento/configuracoes");
    }
    expect(hrefAtivoNaBarra(visiveis, "/orcamento/demandas/1")).toBe("/orcamento/demandas");
    const busca = getCommandGroups(admin).flatMap((g) => g.links);
    expect(busca.map((l) => l.href)).not.toContain("/orcamento/configuracoes");
    expect(busca.map((l) => l.href)).toEqual(
      expect.arrayContaining(["/", "/projetos", "/orcamento/parametros", "/orcamento/documento-proposta", "/orcamento/modelos", "/governanca/regras"]),
    );
    expect(busca.map((l) => l.label)).not.toContain("Visão por projeto");
  });

  it("Regras do orçamento não aparece em Orçamentos e some da Governança sem a caixinha", () => {
    expect(modulo("orcamentos").children.map((c) => c.href)).not.toContain("/orcamento/governanca");
    const semAuditoria = getModulesForProfile({
      papel: "coordenador",
      permissoes: { admin: false, permissoes: { "orcamentos.visualizar": true } },
    });
    expect(semAuditoria.find((m) => m.id === "governanca")?.children.map((c) => c.href)).not.toContain("/governanca/regras");
  });
});

describe("menu lateral", () => {
  it("sem acesso à visão geral de Suprimentos, o menu abre o primeiro item permitido", async () => {
    const { getSidebarGroups } = await import("./modules");
    const perfil = { papel: "laboratorio", permissoes: { admin: false, permissoes: { "pedido.ver": true } } };
    const grupo = getSidebarGroups(perfil).find((g) => g.title === "Suprimentos");
    expect(grupo?.href).toBe("/pedido");
    const comEstoque = { papel: "laboratorio", permissoes: { admin: false, permissoes: { "pedido.ver": true, "estoque.ver": true } } };
    expect(getSidebarGroups(comEstoque).find((g) => g.title === "Suprimentos")?.href).toBe("/suprimentos");
  });
});

describe("acesso por rota", () => {
  it("Regras do orçamento exige Ver auditoria no endereço novo e no antigo", async () => {
    const { acessoDaRota } = await import("./acesso-modulos");
    expect(acessoDaRota("/governanca/regras")?.chave).toBe("auditoria.visualizar");
    expect(acessoDaRota("/orcamento/governanca")?.chave).toBe("auditoria.visualizar");
    // as outras telas da Governança seguem sem caixinha de rota (incidentes é de todos)
    expect(acessoDaRota("/governanca/incidentes")).toBeNull();
    expect(acessoDaRota("/orcamento/configuracoes")?.chave).toBe("orcamentos.visualizar");
  });
});
