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

describe("auditoria integrada de 16/11 (KAT-03, KAT-07, KAT-09)", () => {
  it("cada campo de senha tem rótulo ligado por htmlFor/id", () => {
    for (const campo of ["alterar-senha-nova", "alterar-senha-confirmar"]) {
      expect(acoes).toContain(`htmlFor={\`${campo}-\${row.id}\`}`);
      expect(acoes).toContain(`id={\`${campo}-\${row.id}\`}`);
    }
    expect(acoes).not.toMatch(/<label className="block[^"]*">(Nova|Confirmar) senha<\/label>/);
  });

  it("retornos das ações são anunciados (alerta no erro, status no sucesso)", () => {
    expect(acoes).toContain('role={ok ? "status" : "alert"}');
    expect(acoes).not.toMatch(/<p className=\{`text-xs \$\{state\.ok/);
    expect(acoes).not.toMatch(/\{erro && <p className=/);
  });

  it("falha técnica da ação vira mensagem no diálogo, sem derrubar a tela", () => {
    expect(acoes).toContain("semQuebrar(() => editarUsuario(");
    expect(acoes).toContain("semQuebrar(() => editarPreAprovado(");
    expect(acoes).toContain("semQuebrar(() => (row.temAcesso ? removerUsuario(fd) : excluirPreAprovado(fd)))");
    expect(acoes).toContain("semQuebrar(() => alternarSuspensao(fd))");
  });
});
