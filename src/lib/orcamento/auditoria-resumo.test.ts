import { describe, expect, it } from "vitest";
import {
  agruparAlteracoesSeguidas,
  camposAlterados,
  formatarValorAuditoria,
  resumoDiffAuditoria,
  type LinhaAuditoriaResumo,
} from "./auditoria-resumo";

const IGNORAR = new Set(["criado_em", "atualizado_em", "completude_atualizada_em"]);

function linha(parcial: Partial<LinhaAuditoriaResumo> & { id: number }): LinhaAuditoriaResumo {
  return {
    tabela: "demandas_propostas",
    registro_id: "6",
    acao: "update",
    usuario: "rafaela@ufpr.br",
    valor_anterior: null,
    valor_novo: null,
    criado_em: "2026-09-17T14:13:00Z",
    ...parcial,
  };
}

describe("formatarValorAuditoria", () => {
  it("nunca mostra [object Object] para objetos e listas", () => {
    const valores = [{ completa: false, pendencias: ["informar o título"] }, [{ a: 1 }], { a: { b: 1 } }];
    for (const valor of valores) {
      expect(formatarValorAuditoria(valor)).not.toContain("[object Object]");
    }
  });

  it("resume objetos e listas curtos por extenso e os longos pela contagem", () => {
    expect(formatarValorAuditoria({ status: "ok", total: 3 })).toBe("{status: ok, total: 3}");
    expect(formatarValorAuditoria({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 })).toBe("{8 campos}");
    expect(formatarValorAuditoria({ completa: true, pendencias: [] })).toBe("{2 campos}");
    expect(formatarValorAuditoria(["PE", "MC"])).toBe("[PE, MC]");
    expect(formatarValorAuditoria([{ id: 1 }, { id: 2 }])).toBe("2 itens");
    expect(formatarValorAuditoria([])).toBe("lista vazia");
    expect(formatarValorAuditoria({})).toBe("vazio");
  });

  it("mantém textos, números e vazios como antes, truncando o que é longo", () => {
    expect(formatarValorAuditoria(null)).toBe("-");
    expect(formatarValorAuditoria("")).toBe("-");
    expect(formatarValorAuditoria(12.5)).toBe("12.5");
    expect(formatarValorAuditoria(true)).toBe("sim");
    expect(formatarValorAuditoria("x".repeat(40))).toBe(`${"x".repeat(32)}…`);
  });

  it("mostra carimbos de data do banco em data e hora locais", () => {
    expect(formatarValorAuditoria("2026-09-17T14:13:18.098+00:00")).toBe("17/09/2026, 11:13:18");
    expect(formatarValorAuditoria("2026-09-17")).toBe("17/09/2026");
    expect(formatarValorAuditoria("2026-09-17 é o prazo")).toBe("2026-09-17 é o prazo");
  });
});

describe("resumoDiffAuditoria", () => {
  it("desce nos campos jsonb e mostra o subcampo alterado", () => {
    const anterior = { status: "rascunho", completude_snapshot: { completa: false, faltante: 40, pendencias: ["a", "b"] } };
    const novo = { status: "rascunho", completude_snapshot: { completa: false, faltante: 20, pendencias: ["a"] } };
    expect(resumoDiffAuditoria("update", anterior, novo)).toBe(
      "completude_snapshot.faltante: 40 → 20 · completude_snapshot.pendencias: [a, b] → [a]",
    );
  });

  it("mostra objeto que surgiu onde antes não havia nada", () => {
    expect(resumoDiffAuditoria("update", { textos_proposta: null }, { textos_proposta: { intro: "Olá" } })).toBe(
      "textos_proposta: - → {intro: Olá}",
    );
  });

  it("ignora carimbos de data e diferença só na ordem das chaves", () => {
    const anterior = { atualizado_em: "1", snapshot: { a: 1, b: 2 } };
    const novo = { atualizado_em: "2", snapshot: { b: 2, a: 1 } };
    expect(resumoDiffAuditoria("update", anterior, novo, { ignorar: IGNORAR })).toBe("Sem mudança relevante.");
  });

  it("limita a três campos e conta o restante", () => {
    const anterior = { a: 1, b: 1, c: 1, d: 1, e: 1 };
    const novo = { a: 2, b: 2, c: 2, d: 2, e: 2 };
    expect(resumoDiffAuditoria("update", anterior, novo)).toBe("a: 1 → 2 · b: 1 → 2 · c: 1 → 2 · +2 campos");
  });

  it("descreve criação, remoção e alteração sem diff", () => {
    expect(resumoDiffAuditoria("insert", null, { a: 1 })).toBe("Registro criado.");
    expect(resumoDiffAuditoria("delete", { a: 1 }, null)).toBe("Registro removido.");
    expect(resumoDiffAuditoria("update", null, { a: 1 })).toBe("Alteração sem diff disponível.");
  });
});

describe("camposAlterados", () => {
  it("considera chaves que só existem de um lado", () => {
    expect(camposAlterados({ a: 1, b: 2 }, { a: 1 })).toEqual([{ campo: "b", de: 2, para: undefined }]);
  });
});

describe("agruparAlteracoesSeguidas", () => {
  const snapshot = (faltante: number, carimbo: string) => ({
    completude_snapshot: { completa: false, faltante },
    completude_atualizada_em: carimbo,
  });

  it("junta alterações seguidas do mesmo registro, usuário e campos com a mudança líquida", () => {
    const linhas = [
      linha({ id: 3, valor_anterior: snapshot(20, "t2"), valor_novo: snapshot(10, "t3"), criado_em: "2026-09-17T14:13:30Z" }),
      linha({ id: 2, valor_anterior: snapshot(30, "t1"), valor_novo: snapshot(20, "t2"), criado_em: "2026-09-17T14:13:20Z" }),
      linha({ id: 1, valor_anterior: snapshot(40, "t0"), valor_novo: snapshot(30, "t1"), criado_em: "2026-09-17T14:13:10Z" }),
    ];
    const grupos = agruparAlteracoesSeguidas(linhas, IGNORAR);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].itens.map((item) => item.id)).toEqual([3, 2, 1]);
    expect(grupos[0].maisRecente.id).toBe(3);
    expect(grupos[0].maisAntiga.id).toBe(1);
    expect(grupos[0].resumo).toBe("completude_snapshot.faltante: 40 → 10");
  });

  it("não junta criações, outro registro, outro usuário nem linhas intercaladas", () => {
    const alteracao = (id: number, extra: Partial<LinhaAuditoriaResumo> = {}) =>
      linha({ id, valor_anterior: { status: "a" }, valor_novo: { status: "b" }, ...extra });
    const grupos = agruparAlteracoesSeguidas([
      alteracao(6),
      alteracao(5, { registro_id: "7" }),
      alteracao(4, { usuario: "outra@ufpr.br" }),
      linha({ id: 3, acao: "insert", valor_novo: { status: "a" } }),
      linha({ id: 2, acao: "insert", valor_novo: { status: "a" } }),
      alteracao(1),
    ]);
    expect(grupos.map((grupo) => grupo.itens.length)).toEqual([1, 1, 1, 1, 1, 1]);
  });
});
