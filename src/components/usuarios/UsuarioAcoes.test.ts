import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const acoes = readFileSync(new URL("./UsuarioAcoes.tsx", import.meta.url), "utf8");
const tabela = readFileSync(new URL("./UsuariosTable.tsx", import.meta.url), "utf8");
const inicioGrupos = acoes.indexOf("{GRUPOS_PERMISSOES.map");
const blocoGrupos = acoes.slice(inicioGrupos, acoes.indexOf('{papel === "admin"', inicioGrupos));

describe("edição de usuário", () => {
  it("mantém identidade e ações visíveis e rola somente as permissões", () => {
    expect(acoes).toContain("max-h-[calc(100dvh-2rem)]");
    expect(acoes).toContain("grid-rows-[auto_minmax(0,1fr)_auto]");
    expect(acoes).toContain("min-h-0 overflow-y-auto");
    expect(acoes).toContain('name="nome"');
    expect(acoes).toContain('name="papel"');
    expect(acoes).toContain('name="permissoes"');
  });

  it("agrupa permissões sem desmontar os inputs", () => {
    expect(inicioGrupos).toBeGreaterThan(-1);
    expect(blocoGrupos).toContain("<details");
    expect(blocoGrupos).toContain("<summary");
    expect(blocoGrupos).toContain("permissoesModulo.map");
    expect(blocoGrupos).toContain('name="permissoes"');
    expect(blocoGrupos).toContain("sm:grid-cols-2");
    expect(acoes).toContain('role="alert"');
    expect(acoes).toContain("aria-busy={pending}");
  });

  it("expõe nome ausente e ação de correção também no mobile", () => {
    expect(tabela).toContain("Nome não informado");
    expect(acoes).toContain("Completar nome");
    expect(tabela).toMatch(/getMobileMeta=\{\(row\) => \([\s\S]*<UsuarioAcoes row=\{row\} \/>/);
  });
});
