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
    expect(defaultPermissionsForRole("tecnico")).toEqual(expect.arrayContaining([
      "recebimento.registrar",
      "planejamento.executar",
    ]));
    expect(defaultPermissionsForRole("tecnico")).not.toContain("estoque.lote.aceitar");
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
    expect(defaultPermissionsForRole("tecnico")).toEqual(expect.arrayContaining([
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
    for (const papel of ["tecnico", "coordenador", "gestor"]) {
      expect(defaultPermissionsForRole(papel)).not.toContain("tecnicos.salario.ver");
      expect(normalizePermissions(papel, {})["tecnicos.salario.ver"]).toBe(false);
    }
    // concessao individual (perfis.permissoes) prevalece sobre o padrao da categoria
    expect(normalizePermissions("tecnico", { "tecnicos.salario.ver": true })["tecnicos.salario.ver"]).toBe(true);
  });

  it("valores de pessoal no orçamento: coordenador, gestor e admin por padrão; técnico não", () => {
    const pessoal = PERMISSOES.find((permissao) => permissao.key === "orcamentos.pessoal");
    expect(pessoal).toMatchObject({ label: "Valores de pessoal no orçamento", modulo: "Orçamentos" });

    for (const papel of ["coordenador", "gestor", "admin"]) {
      expect(normalizePermissions(papel, {})["orcamentos.pessoal"]).toBe(true);
    }
    expect(defaultPermissionsForRole("tecnico")).not.toContain("orcamentos.pessoal");
    expect(normalizePermissions("tecnico", {})["orcamentos.pessoal"]).toBe(false);
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
      Object.values(selectedPermissionsFromForm(explicitamenteVazio, "tecnico")).every(
        (enabled) => enabled === false,
      ),
    ).toBe(true);
    expect(selectedPermissionsFromForm(semFormularioExplicito, "tecnico")).toMatchObject(
      normalizePermissions("tecnico", {}),
    );
    expect(Object.values(selectedPermissionsFromForm(explicitamenteVazio, "admin")).every(Boolean)).toBe(true);
  });
});
