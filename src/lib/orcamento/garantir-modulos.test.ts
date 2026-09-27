import { describe, expect, it } from "vitest";
import { planejarModulosProposta } from "./garantir-modulos";

const base = { laboratorioAtivos: [] as number[], projetoAtivos: [] as number[] };

describe("planejarModulosProposta — idempotência", () => {
  it("demanda apenas laboratorial não cria projeto", () => {
    const p = planejarModulosProposta({ ...base, modalidade: "analises" });
    expect(p.laboratorio.acao).toBe("criar");
    expect(p.projeto.acao).toBe("nao_aplicavel");
  });

  it("demanda apenas projeto não cria laboratório", () => {
    const p = planejarModulosProposta({ ...base, modalidade: "projeto" });
    expect(p.projeto.acao).toBe("criar");
    expect(p.laboratorio.acao).toBe("nao_aplicavel");
  });

  it("demanda combinada planeja criar ambos quando faltam", () => {
    const p = planejarModulosProposta({ ...base, modalidade: "projeto_com_analises" });
    expect(p.laboratorio.acao).toBe("criar");
    expect(p.projeto.acao).toBe("criar");
  });

  it("já existe 1 módulo ativo → ABRIR (não cria duplicidade no segundo clique)", () => {
    const p = planejarModulosProposta({ ...base, modalidade: "analises", laboratorioAtivos: [42] });
    expect(p.laboratorio.acao).toBe("abrir");
    expect(p.laboratorio.moduloId).toBe(42);
  });

  it("múltiplos módulos ativos existentes bloqueiam nova criação", () => {
    const p = planejarModulosProposta({ ...base, modalidade: "analises", laboratorioAtivos: [1, 2] });
    expect(p.laboratorio.acao).toBe("bloqueado");
    expect(p.laboratorio.multiplos).toBe(true);
    expect(p.bloqueadoPorDuplicidade).toBe(true);
    expect(p.erros.join(" ")).toMatch(/duplicados/i);
  });

  it("projeto associado força a etapa de projeto mesmo em modalidade só de análises", () => {
    const p = planejarModulosProposta({ ...base, modalidade: "analises", projetoAssociado: true });
    expect(p.projeto.acao).toBe("criar");
  });

  it("modalidades legadas são reconhecidas (projeto + laboratório)", () => {
    for (const m of ["analises_projeto", "projeto_analises_custos"]) {
      const p = planejarModulosProposta({ ...base, modalidade: m });
      expect(p.laboratorio.aplicavel).toBe(true);
      expect(p.projeto.aplicavel).toBe(true);
    }
  });
});
