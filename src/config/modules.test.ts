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
    expect(moduleIsActive(modulo("orcamentos"), "/projetos/7")).toBe(true);
    expect(moduleIsActive(modulo("operacao"), "/parametros")).toBe(true);
    expect(moduleIsActive(modulo("suprimentos"), "/estoque/inventario")).toBe(true);
    expect(moduleIsActive(modulo("suprimentos"), "/estoque/leitura")).toBe(true);
    expect(moduleIsActive(modulo("suprimentos"), "/etiquetas")).toBe(true);
    expect(moduleIsActive(modulo("suprimentos"), "/scanner/triagem")).toBe(true);
    expect(moduleIsActive(modulo("orcamentos"), "/projetosx")).toBe(false);
  });

  // A caixinha manda (0124): cada área aparece só com a permissão "Acessar …".
  const comPermissoes = (papel: string, chaves: string[]) => ({
    papel,
    permissoes: { admin: false, permissoes: Object.fromEntries(chaves.map((chave) => [chave, true])) },
  });

  it("parâmetros de custeio aparecem só com a permissão da área", () => {
    const sem = comPermissoes("tecnico", ["estoque.ver", "projetos.ver"]);
    const com = comPermissoes("tecnico", ["estoque.ver", "projetos.ver", "configuracoes.ver"]);
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

  it("governança aparece com a auditoria liberada; usuários e backups seguem só do admin", () => {
    expect(getModulesForProfile(comPermissoes("tecnico", [])).map((m) => m.id)).not.toContain("governanca");
    const gestor = getModulesForProfile(comPermissoes("gestor", ["auditoria.visualizar"]));
    const governanca = gestor.find((m) => m.id === "governanca");
    expect(governanca?.children.map((c) => c.href)).toEqual(["/auditoria"]);
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

  it("Operação mostra Análises, Insumos por análise e Custeio na barra", () => {
    const operacao = APP_MODULES.find((m) => m.id === "operacao")!;
    const visiveis = operacao.children.filter((c) => c.showInTopNav !== false).map((c) => c.href);
    expect(visiveis).toEqual(["/analises", "/insumos", "/custeio"]);
  });
});
