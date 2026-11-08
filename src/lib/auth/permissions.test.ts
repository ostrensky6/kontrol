import { describe, expect, it } from "vitest";

import {
  HISTORICAL_ROLE_RECONCILIATION,
  PERMISSOES,
  defaultPermissionsForRole,
  normalizePermissions,
  selectedPermissionsFromForm,
} from "./permissions";

describe("permissoes reconciliadas", () => {
  it("preserva capacidades granulares historicas no catalogo atual", () => {
    const keys = PERMISSOES.map((permissao) => permissao.key);

    expect(keys).toEqual(expect.arrayContaining([
      "analises.ver",
      "analises.editar",
      "estoque.lote.aceitar",
      "estoque.lote.gerir",
      "orcamento.parametros.editar",
      "planejamento.executar",
      "orcamentos.fundos",
      "orcamentos.modelos",
    ]));
  });

  it("gestão de acessos não é delegável por caixinha: fica só com o admin", () => {
    const keys = PERMISSOES.map((permissao) => permissao.key as string);
    expect(keys).not.toContain("usuarios.gerenciar");
    expect(keys).not.toContain("privilegios.gerenciar");
    expect(keys).not.toContain("backups.gerenciar");
  });

  it("padrões por papel reproduzem o acesso anterior à 0124", () => {
    expect(defaultPermissionsForRole("laboratorio")).toEqual(expect.arrayContaining([
      "recebimento.registrar",
      "planejamento.executar",
    ]));
    expect(defaultPermissionsForRole("laboratorio")).not.toContain("estoque.lote.aceitar");
    expect(defaultPermissionsForRole("coordenador")).toEqual(expect.arrayContaining([
      "orcamentos.cancelar",
      "compras.cancelar",
      "estoque.lote.gerir",
    ]));
    // D5 (dono, 28/09): sem gestor, o coordenador bloqueia e descarta lotes
    expect(defaultPermissionsForRole("coordenador")).toContain("estoque.descartar_bloquear");
  });

  it("documenta que o papel administrativo historico nao foi colapsado silenciosamente", () => {
    expect(HISTORICAL_ROLE_RECONCILIATION).toContainEqual(expect.objectContaining({
      historico: "administrativo",
      atual: "sem papel dedicado",
    }));
  });

  it("mantem admin como superconjunto de todas as permissoes", () => {
    expect(defaultPermissionsForRole("admin")).toEqual(PERMISSOES.map((permissao) => permissao.key));
    expect(Object.values(normalizePermissions("admin", {})).every(Boolean)).toBe(true);
  });

  it("nao reduz os defaults funcionais ja existentes", () => {
    expect(defaultPermissionsForRole("laboratorio")).toEqual(expect.arrayContaining([
      "orcamentos.visualizar",
      "orcamentos.criar_editar",
      "compras.solicitar",
      "estoque.movimentar",
    ]));
    expect(defaultPermissionsForRole("gestor")).toEqual(expect.arrayContaining([
      "orcamentos.cancelar",
      "estoque.descartar_bloquear",
      "auditoria.visualizar",
    ]));
  });

  it("salario dos tecnicos: configuravel nas telas e, por padrao, somente admin", () => {
    const salario = PERMISSOES.find((permissao) => permissao.key === "tecnicos.salario.ver");
    expect(salario).toMatchObject({ label: "Ver salário dos técnicos", modulo: "Cadastros" });

    expect(normalizePermissions("admin", {})["tecnicos.salario.ver"]).toBe(true);
    for (const papel of ["laboratorio", "coordenador", "gestor"]) {
      expect(defaultPermissionsForRole(papel)).not.toContain("tecnicos.salario.ver");
      expect(normalizePermissions(papel, {})["tecnicos.salario.ver"]).toBe(false);
    }
    // concessao individual (perfis.permissoes) prevalece sobre o padrao da categoria
    expect(normalizePermissions("laboratorio", { "tecnicos.salario.ver": true })["tecnicos.salario.ver"]).toBe(true);
  });

  it("valores de pessoal no orçamento: coordenador, gestor e admin por padrão; técnico não", () => {
    const pessoal = PERMISSOES.find((permissao) => permissao.key === "orcamentos.pessoal");
    expect(pessoal).toMatchObject({ label: "Valores de pessoal no orçamento", modulo: "Orçamentos" });

    for (const papel of ["coordenador", "gestor", "admin"]) {
      expect(normalizePermissions(papel, {})["orcamentos.pessoal"]).toBe(true);
    }
    expect(defaultPermissionsForRole("laboratorio")).not.toContain("orcamentos.pessoal");
    expect(normalizePermissions("laboratorio", {})["orcamentos.pessoal"]).toBe(false);
    // o administrador pode tirar de um coordenador específico
    expect(normalizePermissions("coordenador", { "orcamentos.pessoal": false })["orcamentos.pessoal"]).toBe(false);
  });

  it("forca permissoes completas para formulario de admin", () => {
    const formData = new FormData();
    formData.append("permissoes", "analises.ver");

    expect(Object.values(selectedPermissionsFromForm(formData, "admin")).every(Boolean)).toBe(true);
  });

  it("distingue zero permissoes explicitas de formulario sem sentinel", () => {
    const explicitamenteVazio = new FormData();
    explicitamenteVazio.set("permissoes_presentes", "1");
    const semFormularioExplicito = new FormData();

    expect(
      Object.values(selectedPermissionsFromForm(explicitamenteVazio, "laboratorio")).every(
        (enabled) => enabled === false,
      ),
    ).toBe(true);
    expect(selectedPermissionsFromForm(semFormularioExplicito, "laboratorio")).toMatchObject(
      normalizePermissions("laboratorio", {}),
    );
    expect(Object.values(selectedPermissionsFromForm(explicitamenteVazio, "admin")).every(Boolean)).toBe(true);
  });
});

describe("catálogo TS e níveis operacionais legados", () => {
  it("inclui Supervisor sem conceder defaults ou papel mínimo", async () => {
    const { PAPEIS, papelAlcanca } = await import("./permissions");
    expect(PAPEIS.map((papel) => papel.label).sort()).toEqual(
      ["Administrador", "Cadastro", "Compra", "Coordenador", "Gestor", "Laboratório", "Supervisor"].sort(),
    );
    expect(PAPEIS.map((papel) => papel.value)).not.toContain("tecnico");
    expect(defaultPermissionsForRole("supervisor")).toEqual([]);
    expect(papelAlcanca("supervisor", "gestor")).toBe(false);
    expect(papelAlcanca("laboratorio", "supervisor")).toBe(false);
  });

  it("Laboratório herda exatamente o padrão do antigo Técnico, que segue como apelido", () => {
    expect(defaultPermissionsForRole("tecnico")).toEqual(defaultPermissionsForRole("laboratorio"));
  });

  it("nível: Laboratório = Compra = Cadastro < Coordenador < Gestor < Administrador", async () => {
    const { nivelPapel, papelAlcanca } = await import("./permissions");
    expect(nivelPapel("laboratorio")).toBe(nivelPapel("compra"));
    expect(nivelPapel("compra")).toBe(nivelPapel("cadastro"));
    expect(nivelPapel("tecnico")).toBe(nivelPapel("laboratorio"));
    expect(nivelPapel("cadastro")).toBeLessThan(nivelPapel("coordenador"));
    expect(nivelPapel("coordenador")).toBeLessThan(nivelPapel("gestor"));
    expect(nivelPapel("gestor")).toBeLessThan(nivelPapel("admin"));
    expect(nivelPapel("inventado")).toBe(-1);
    expect(papelAlcanca("compra", "coordenador")).toBe(false);
    expect(papelAlcanca("compra", "laboratorio")).toBe(true);
    expect(papelAlcanca("inventado", "laboratorio")).toBe(false);
  });

  it("Compra e Cadastro começam só com o que a função faz, sem salário, orçamento ou auditoria", () => {
    const compra = defaultPermissionsForRole("compra");
    expect(compra).toEqual(expect.arrayContaining(["compras.ver", "compras.solicitar", "compras.receber", "recebimento.registrar"]));
    const cadastro = defaultPermissionsForRole("cadastro");
    expect(cadastro).toEqual(expect.arrayContaining(["cadastros.ver", "cadastros.editar", "insumos.editar", "projetos.editar"]));
    for (const chave of ["tecnicos.salario.ver", "orcamentos.visualizar", "orcamentos.pessoal", "auditoria.visualizar"] as const) {
      expect(compra).not.toContain(chave);
      expect(cadastro).not.toContain(chave);
    }
  });

  it("a migration 0146 grava a mesma marcação inicial de Compra e Cadastro que o app usa", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0146_seis_funcoes.sql"), "utf8");
    for (const papel of ["compra", "cadastro"]) {
      const linha = new RegExp(`\\('${papel}', '(\\{[^']+\\})'::jsonb`).exec(sql);
      expect(linha, papel).not.toBeNull();
      const gravado = JSON.parse(linha![1]) as Record<string, boolean>;
      const padrao = new Set(defaultPermissionsForRole(papel));
      expect(Object.keys(gravado).sort()).toEqual(PERMISSOES.map((p) => p.key).sort());
      for (const [chave, pode] of Object.entries(gravado)) expect(pode, `${papel} ${chave}`).toBe(padrao.has(chave as never));
    }
    // aditiva: troca CHECK, não remove tabela, coluna, RLS nem trigger
    const semComentarios = sql.replace(/--.*$/gm, "");
    expect(semComentarios).not.toMatch(/drop\s+(table|column|policy|trigger|function|schema)/i);
    expect(semComentarios).not.toMatch(/\btruncate\b|disable\s+row\s+level/i);
    expect(sql).toContain("when 'tecnico' then 0");
  });
});
