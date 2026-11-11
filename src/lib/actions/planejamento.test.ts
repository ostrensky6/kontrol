import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMockSupabaseStore, resetMockSupabaseStore } from "@/lib/testing/mock-supabase";

const revalidatePath = vi.fn();
const redirect = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/roles", () => ({
  temPapel: vi.fn(async () => true),
  usuarioAtual: vi.fn(async () => ({ nome: "Coordenador", email: "coord@example.com", papel: "coordenador" })),
}));
// Actions contra o mock transacional (mesmas regras da migration 0111).
vi.mock("@/lib/supabase/server", async () => {
  const { createMockSupabaseClient } = await import("@/lib/testing/mock-supabase");
  return {
    createClient: vi.fn(async () => createMockSupabaseClient()),
    createClientUntyped: vi.fn(async () => createMockSupabaseClient()),
  };
});

const vazio = { ok: false };

function form(campos: Record<string, string | number>) {
  const formData = new FormData();
  for (const [chave, valor] of Object.entries(campos)) formData.set(chave, String(valor));
  return formData;
}

function semear({
  status = "rascunho",
  reservas = [] as Array<Record<string, unknown>>,
  pedidos = [] as Array<Record<string, unknown>>,
} = {}) {
  const store = getMockSupabaseStore();
  store.planejamento = [
    {
      id: 10,
      nome: "Plano teste",
      status_operacional: status,
      reserva_desatualizada: false,
      data_inicio_prevista: "2026-07-01",
      data_fim_prevista: "2026-07-10",
    },
  ];
  store.planejamento_itens = [
    { id: 100, planejamento_id: 10, codigo_analise: "qPCR_F", n_amostras: 4, n_controles: 0, repeticoes: 1, perda_percentual: 0 },
  ];
  store.reservas_estoque = reservas.map((reserva, indice) => ({ id: 500 + indice, planejamento_id: 10, insumo_id: 1, quantidade: 1, ...reserva }));
  store.pedidos_internos = pedidos.map((pedido, indice) => ({ id: 70 + indice, planejamento_id: 10, titulo: "Pedido", ...pedido }));
  store.eventos_status = [];
  return store;
}

describe("edição do planejamento", () => {
  beforeEach(() => {
    resetMockSupabaseStore();
    revalidatePath.mockReset();
    redirect.mockReset();
  });

  it("salva o contexto de plano em rascunho", async () => {
    const store = semear();
    const { atualizarPlanejamentoExecutivo } = await import("./planejamento");
    const resultado = await atualizarPlanejamentoExecutivo(
      vazio,
      form({ planejamento_id: 10, nome: "Plano renomeado", prioridade: "alta", data_inicio_prevista: "2026-07-02", data_fim_prevista: "2026-07-12" }),
    );
    expect(resultado).toEqual({ ok: true, message: "Contexto salvo." });
    expect(store.planejamento[0]).toMatchObject({ nome: "Plano renomeado", prioridade: "alta", data_fim_prevista: "2026-07-12" });
    expect(revalidatePath).toHaveBeenCalledWith("/planejamento/10");
  });

  it("informa quando o status impede a edição e não altera nada", async () => {
    const store = semear({ status: "em_execucao" });
    const { atualizarPlanejamentoExecutivo } = await import("./planejamento");
    const resultado = await atualizarPlanejamentoExecutivo(vazio, form({ planejamento_id: 10, nome: "Outro nome" }));
    expect(resultado.ok).toBe(false);
    expect(resultado.message).toBe("Plano em execução: só é possível editar em rascunho ou reservado.");
    expect(store.planejamento[0].nome).toBe("Plano teste");
  });

  it("recusa período invertido", async () => {
    semear();
    const { atualizarPlanejamentoExecutivo } = await import("./planejamento");
    const resultado = await atualizarPlanejamentoExecutivo(
      vazio,
      form({ planejamento_id: 10, data_inicio_prevista: "2026-07-10", data_fim_prevista: "2026-07-01" }),
    );
    expect(resultado).toEqual({ ok: false, message: "O fim previsto não pode ser anterior ao início previsto." });
  });

  it("edita um item existente", async () => {
    const store = semear();
    const { atualizarItem } = await import("./planejamento");
    const resultado = await atualizarItem(
      vazio,
      form({ item_id: 100, planejamento_id: 10, n_amostras: 8, n_controles: 2, repeticoes: 3, perda_percentual: 5 }),
    );
    expect(resultado).toEqual({ ok: true, message: "Item salvo." });
    expect(store.planejamento_itens[0]).toMatchObject({ n_amostras: 8, n_controles: 2, repeticoes: 3, perda_percentual: 5 });
  });

  it("valida os números do item", async () => {
    semear();
    const { atualizarItem, adicionarItem } = await import("./planejamento");
    expect((await atualizarItem(vazio, form({ item_id: 100, planejamento_id: 10, n_amostras: 0 }))).message)
      .toBe("Informe o número de amostras (maior que zero).");
    expect((await atualizarItem(vazio, form({ item_id: 100, planejamento_id: 10, n_amostras: 1, perda_percentual: 150 }))).message)
      .toBe("% de perda deve ficar entre 0 e 100.");
    expect((await adicionarItem(vazio, form({ planejamento_id: 10, n_amostras: 1 }))).message).toBe("Selecione a análise.");
  });

  it("alterar itens de plano reservado marca a reserva como desatualizada", async () => {
    const store = semear({ status: "reservado" });
    const { adicionarItem, iniciarPlano } = await import("./planejamento");
    const resultado = await adicionarItem(vazio, form({ planejamento_id: 10, codigo_analise: "Sanger", n_amostras: 2 }));
    expect(resultado.ok).toBe(true);
    expect(resultado.message).toContain("Reserve os insumos de novo");
    expect(store.planejamento[0].reserva_desatualizada).toBe(true);

    const inicio = await iniciarPlano(vazio, form({ planejamento_id: 10 }));
    expect(inicio).toEqual({
      ok: false,
      message: "Os itens mudaram depois da reserva. Reserve os insumos de novo antes de iniciar.",
    });
  });

  it("itens ficam somente leitura fora de rascunho/reservado", async () => {
    const store = semear({ status: "cancelado" });
    const { removerItem } = await import("./planejamento");
    const resultado = await removerItem(vazio, form({ item_id: 100, planejamento_id: 10 }));
    expect(resultado).toEqual({ ok: false, message: "Plano cancelado: só é possível editar em rascunho ou reservado." });
    expect(store.planejamento_itens).toHaveLength(1);
  });
});

describe("exclusão e cancelamento do planejamento", () => {
  beforeEach(() => {
    resetMockSupabaseStore();
    revalidatePath.mockReset();
    redirect.mockReset();
  });

  it("exige motivo", async () => {
    semear();
    const { excluirPlano, cancelarPlano } = await import("./planejamento");
    expect((await excluirPlano(vazio, form({ planejamento_id: 10, motivo: " " }))).message)
      .toBe("Informe o motivo da exclusão (mínimo 3 caracteres).");
    expect((await cancelarPlano(vazio, form({ planejamento_id: 10 }))).message)
      .toBe("Informe o motivo do cancelamento (mínimo 3 caracteres).");
  });

  it("exclui plano sem baixa, libera reservas e registra o motivo", async () => {
    const store = semear({
      status: "reservado",
      reservas: [{ status: "reservado" }, { status: "liberado" }],
      pedidos: [{ status: "cancelado" }],
    });
    const { excluirPlano } = await import("./planejamento");
    const resultado = await excluirPlano(vazio, form({ planejamento_id: 10, motivo: "Plano duplicado" }));
    expect(resultado).toEqual({ ok: true, message: "Plano excluído; 1 reserva(s) liberada(s)." });
    expect(store.planejamento).toHaveLength(0);
    expect(store.planejamento_itens).toHaveLength(0);
    expect(store.reservas_estoque).toHaveLength(0);
    expect(store.pedidos_internos[0].planejamento_id).toBeNull();
    expect(store.eventos_status).toEqual([
      expect.objectContaining({ entidade: "planejamento", entidade_id: 10, para_status: "excluido", observacao: expect.stringContaining("Plano duplicado") }),
    ]);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redireciona para a lista quando excluído da página do plano", async () => {
    semear();
    const { excluirPlano } = await import("./planejamento");
    await excluirPlano(vazio, form({ planejamento_id: 10, motivo: "Criado por engano", redirecionar_para: "/planejamento" }));
    expect(redirect).toHaveBeenCalledWith("/planejamento?excluido=10");
  });

  it("com baixa de material só cancela, preservando o histórico", async () => {
    const store = semear({ status: "reservado", reservas: [{ status: "consumido", quantidade_consumida: 1 }] });
    const { excluirPlano, cancelarPlano } = await import("./planejamento");
    const exclusao = await excluirPlano(vazio, form({ planejamento_id: 10, motivo: "Plano duplicado" }));
    expect(exclusao).toEqual({ ok: false, message: "Já houve baixa de material neste plano. Só é possível cancelar." });
    expect(store.planejamento).toHaveLength(1);

    const cancelamento = await cancelarPlano(vazio, form({ planejamento_id: 10, motivo: "Cliente desistiu" }));
    expect(cancelamento).toEqual({ ok: true, message: "Plano cancelado. O histórico foi preservado." });
    expect(store.planejamento[0].status_operacional).toBe("cancelado");
    expect(store.reservas_estoque).toHaveLength(1);
    expect(store.eventos_status.at(-1)).toMatchObject({ para_status: "cancelado", observacao: "Plano cancelado. Motivo: Cliente desistiu" });
  });

  it("lista os pedidos internos ativos que impedem a exclusão", async () => {
    const store = semear({ pedidos: [{ status: "em_validacao" }] });
    const { excluirPlano } = await import("./planejamento");
    const resultado = await excluirPlano(vazio, form({ planejamento_id: 10, motivo: "Plano duplicado" }));
    // a recusa do banco chega com as palavras do glossário (10.5)
    expect(resultado).toEqual({ ok: false, message: "Cancele antes os pedidos vinculados ao plano: #70 (em_validacao)." });
    expect(store.planejamento).toHaveLength(1);
  });

  it("não cancela plano concluído", async () => {
    semear({ status: "concluido" });
    const { cancelarPlano } = await import("./planejamento");
    const resultado = await cancelarPlano(vazio, form({ planejamento_id: 10, motivo: "Tarde demais" }));
    expect(resultado).toEqual({ ok: false, message: "Planejamento concluído não pode ser cancelado." });
  });
});
