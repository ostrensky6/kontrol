import { describe, expect, it } from "vitest";

import { motivoSomenteConsulta } from "@/lib/cadastros/somente-consulta";

describe("motivo do Somente consulta", () => {
  it("laboratórios e áreas: só o Administrador indica a coordenação", () => {
    expect(motivoSomenteConsulta("coordenacoes", "usuarios.gerenciar")).toContain("só o Administrador define quem coordena");
  });

  it("responsáveis por etapa: só o Administrador", () => {
    expect(motivoSomenteConsulta("responsaveis", "usuarios.gerenciar")).toContain("só o Administrador");
  });

  it("os demais dizem o nome da permissão que falta", () => {
    expect(motivoSomenteConsulta("projetos", "projetos.editar")).toBe(
      "Somente consulta: editar pede a permissão “Editar projetos”. Peça ao Administrador.",
    );
    expect(motivoSomenteConsulta("clientes", "cadastros.editar")).toContain("“Editar cadastros”");
  });
});
