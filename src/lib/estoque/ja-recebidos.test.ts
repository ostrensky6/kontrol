import { beforeEach, describe, expect, it } from "vitest";

import { createMockSupabaseClient, getMockSupabaseStore, resetMockSupabaseStore } from "@/lib/testing/mock-supabase";

import { idsJaRecebidos, insumoJaRecebido, lerInsumosJaRecebidos } from "./ja-recebidos";

type Linha = Record<string, unknown>;

function loja() {
  return getMockSupabaseStore() as unknown as Record<string, Linha[]>;
}

function cliente() {
  return createMockSupabaseClient({ papel: "gestor" }) as unknown as Parameters<typeof lerInsumosJaRecebidos>[0];
}

beforeEach(() => {
  resetMockSupabaseStore();
});

/** Decisão de Antonio em 19/11/2026: insumo que nunca teve lote não é "Sem estoque". */
describe("insumos já recebidos", () => {
  it("conta quem tem ou teve lote, de qualquer status, cada insumo uma vez", () => {
    expect(
      idsJaRecebidos([
        { insumo_id: 1 },
        { insumo_id: "1" },
        { insumo_id: 7 },
        { insumo_id: null },
      ]),
    ).toEqual(new Set([1, 7]));
  });

  it("lote consumido ou descartado também prova que o insumo já chegou", async () => {
    // no banco de teste, o Mix PCR (1) só tem um lote, já consumido
    expect(loja().lotes_estoque.filter((lote) => lote.insumo_id === 1).map((lote) => lote.status)).toEqual(["consumido"]);
    const { recebidos, error } = await lerInsumosJaRecebidos(cliente());
    expect(error).toBeNull();
    expect(recebidos).toEqual(new Set([1, 900]));
  });

  it("insumo sem nenhum lote não está entre os recebidos; com o primeiro lote, passa a estar", async () => {
    const NOVO = 4242;
    expect((await lerInsumosJaRecebidos(cliente())).recebidos!.has(NOVO)).toBe(false);
    expect((await insumoJaRecebido(cliente(), NOVO)).recebidos).toEqual(new Set());

    loja().lotes_estoque.push({ id: 77, insumo_id: NOVO, codigo_lote: "PRIMEIRO", quantidade_atual: 2, status: "quarentena" });

    expect((await lerInsumosJaRecebidos(cliente())).recebidos!.has(NOVO)).toBe(true);
    expect((await insumoJaRecebido(cliente(), NOVO)).recebidos).toEqual(new Set([NOVO]));
    // a leitura de um insumo não traz os outros
    expect((await insumoJaRecebido(cliente(), 1)).recebidos).toEqual(new Set([1]));
  });

  it("leitura que falha não inventa: devolve null, e a tela trata o zerado como Sem estoque", async () => {
    const quebrado = {
      from: () => ({
        select: () => ({
          order: () => ({ range: async () => ({ data: null, error: { message: "sem resposta" } }) }),
          eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: "sem resposta" } }) }) }),
        }),
      }),
    } as unknown as Parameters<typeof lerInsumosJaRecebidos>[0];
    expect(await lerInsumosJaRecebidos(quebrado)).toEqual({ recebidos: null, error: { message: "sem resposta" } });
    expect(await insumoJaRecebido(quebrado, 1)).toEqual({ recebidos: null, error: { message: "sem resposta" } });
  });
});
