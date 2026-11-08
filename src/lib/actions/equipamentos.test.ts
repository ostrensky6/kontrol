import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  pode: vi.fn(async () => true),
  insert: vi.fn(),
  update: vi.fn(),
  existentes: [] as { id: number }[],
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/permissao-efetiva", () => ({ pode: io.pode }));
vi.mock("@/lib/supabase/server", () => ({
  createClientUntyped: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-000000000001" } } }) },
    from: (tabela: string) => {
      const leitura = { eq: () => leitura, limit: async () => ({ data: io.existentes, error: null }) };
      return {
        insert: (linha: unknown) => { io.insert(tabela, linha); return { select: async () => ({ data: [{ id: 1 }], error: null }) }; },
        update: (linha: unknown) => { io.update(tabela, linha); return { eq: () => ({ select: async () => ({ data: [{ id: 1 }], error: null }) }) }; },
        select: () => leitura,
      };
    },
  }),
}));

import {
  definirPlanoEquipamento,
  encaminharAvisoEquipamento,
  registrarManutencaoEquipamento,
} from "./equipamentos";

const form = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const inicial = { ok: false };

beforeEach(() => { vi.clearAllMocks(); io.pode.mockResolvedValue(true); io.existentes = []; });

describe("ações de equipamentos", () => {
  it("registra calibração concluída com próxima data", async () => {
    const r = await registrarManutencaoEquipamento(inicial, form({
      equipamento_unidade_id: "4", tipo: "calibracao", situacao: "concluida", data: "2026-11-01", proxima_data: "2027-11-01",
    }));
    expect(r).toEqual({ ok: true, message: "Manutenção registrada." });
    expect(io.insert).toHaveBeenCalledWith("equipamento_manutencoes", expect.objectContaining({
      equipamento_unidade_id: 4, status: "concluida", data_conclusao: "2026-11-01", proxima_data: "2027-11-01",
    }));
  });

  it("recusa próxima data anterior e não grava", async () => {
    const r = await registrarManutencaoEquipamento(inicial, form({
      equipamento_unidade_id: "4", tipo: "calibracao", situacao: "concluida", data: "2026-11-01", proxima_data: "2026-10-01",
    }));
    expect(r.ok).toBe(false);
    expect(io.insert).not.toHaveBeenCalled();
  });

  it("sem permissão não grava", async () => {
    io.pode.mockResolvedValue(false);
    const r = await encaminharAvisoEquipamento(inicial, form({
      equipamento_unidade_id: "4", tipo: "calibracao", vencimento: "2027-01-01", decisao: "agendar", observacao: "ok",
    }));
    expect(r).toMatchObject({ ok: false, message: "Sua função não permite alterar equipamentos." });
    expect(io.insert).not.toHaveBeenCalled();
  });

  it("encaminha aviso sem registro (vencimento vazio)", async () => {
    const r = await encaminharAvisoEquipamento(inicial, form({
      equipamento_unidade_id: "4", tipo: "calibracao", vencimento: "", decisao: "fora_de_uso", observacao: "Guardada",
    }));
    expect(r.ok).toBe(true);
    expect(io.insert).toHaveBeenCalledWith("equipamento_aviso_encaminhamentos", expect.objectContaining({ vencimento: null, decisao: "fora_de_uso" }));
  });

  it("plano: atualiza o existente da unidade ou cria um novo", async () => {
    await definirPlanoEquipamento(inicial, form({ equipamento_unidade_id: "4", tipo: "calibracao", periodicidade_dias: "365", antecedencia_aviso_dias: "" }));
    expect(io.insert).toHaveBeenCalledWith("equipamento_planos_manutencao", expect.objectContaining({ periodicidade_dias: 365, antecedencia_aviso_dias: null, equipamento_unidade_id: 4 }));
    io.existentes = [{ id: 9 }];
    await definirPlanoEquipamento(inicial, form({ equipamento_unidade_id: "4", tipo: "calibracao", periodicidade_dias: "180", antecedencia_aviso_dias: "30" }));
    expect(io.update).toHaveBeenCalledWith("equipamento_planos_manutencao", expect.objectContaining({ periodicidade_dias: 180, antecedencia_aviso_dias: 30 }));
  });
});
