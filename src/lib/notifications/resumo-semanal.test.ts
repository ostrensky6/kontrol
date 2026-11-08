import { describe, expect, it, vi } from "vitest";
import { ehSegundaEmBrasilia, gerarResumoSemanal, textoResumo, type ClienteResumo } from "./resumo-semanal";

const SEGUNDA = new Date("2026-11-09T13:15:00Z"); // 10:15 em Brasília

function cliente(opcoes: { jaTem?: number } = {}) {
  const insert = vi.fn(async (..._a: unknown[]) => ({ error: null }));
  const contagens: Record<string, number> = { notificacoes: opcoes.jaTem ?? 0, pedidos_internos: 2, v_equipamento_avisos: 1 };
  const c = {
    from: (tabela: string) => {
      const resposta = tabela === "v_alertas_estoque"
        ? { data: [{ tipo: "reposicao", insumo_id: 1 }, { tipo: "reposicao", insumo_id: 1 }, { tipo: "vencido", insumo_id: 2 }], error: null }
        : { data: [], error: null, count: contagens[tabela] ?? 0 };
      const f: Record<string, unknown> = {
        eq: () => f, gte: () => f, in: () => f,
        then: (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok),
      };
      return { select: () => f, insert: (v: Record<string, unknown>) => insert(tabela, v) };
    },
  };
  return { c: c as unknown as ClienteResumo, insert };
}

describe("resumo semanal", () => {
  it("texto lista só o que está pendente", () => {
    expect(textoResumo({ alertas: { reposicao: 1, vencido: 2 }, pedidosEmValidacao: 3, equipamentosVencidos: 0, equipamentosProximos: 1 }))
      .toBe("1 insumo abaixo do mínimo; 2 insumos vencidos; 3 pedidos internos aguardando validação; 1 manutenção/calibração perto de vencer sem encaminhamento.");
    expect(textoResumo({ alertas: {}, pedidosEmValidacao: 0, equipamentosVencidos: 0, equipamentosProximos: 0 })).toBe("Nada pendente nesta semana.");
  });

  it("segunda-feira no horário de Brasília", () => {
    expect(ehSegundaEmBrasilia(SEGUNDA)).toBe(true);
    expect(ehSegundaEmBrasilia(new Date("2026-11-10T02:00:00Z"))).toBe(true); // ainda segunda 23h em Brasília
    expect(ehSegundaEmBrasilia(new Date("2026-11-10T13:00:00Z"))).toBe(false);
  });

  it("grava um aviso para coordenador ou acima, uma vez por semana", async () => {
    const { c, insert } = cliente();
    expect(await gerarResumoSemanal(c, SEGUNDA)).toEqual({ gerado: true });
    expect(insert).toHaveBeenCalledWith("notificacoes", expect.objectContaining({
      tipo: "sistema", entidade_tipo: "resumo_semanal", papel_destino: "coordenador",
      corpo: expect.stringContaining("1 insumo abaixo do mínimo"),
    }));
    const outro = cliente({ jaTem: 1 });
    expect(await gerarResumoSemanal(outro.c, SEGUNDA)).toEqual({ gerado: false, motivo: "ja_enviado" });
    expect(outro.insert).not.toHaveBeenCalled();
  });

  it("fora da segunda não faz nada", async () => {
    const { c, insert } = cliente();
    expect((await gerarResumoSemanal(c, new Date("2026-11-11T13:00:00Z"))).gerado).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });
});
