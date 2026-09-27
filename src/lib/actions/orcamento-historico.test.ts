import { beforeEach, describe, expect, it, vi } from "vitest";

import { ESTADO_INICIAL } from "@/lib/erros";

const revalidatePath = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const from = vi.fn();
const rpc = vi.fn();
const exigirPapelOrcamento = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/orcamento/governanca", () => ({ exigirPapelOrcamento }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from,
    rpc,
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
    },
  })),
}));

describe("actions de historico de orcamentos", () => {
  beforeEach(() => {
    revalidatePath.mockReset();
    redirect.mockClear();
    from.mockReset();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { alterado: true }, error: null });
    exigirPapelOrcamento.mockReset();
  });

  it("vence as propostas fora da validade pela RPC do banco", async () => {
    rpc.mockResolvedValueOnce({ data: 2, error: null });
    const { atualizarOrcamentosFinaisVencidos } = await import("./orcamento-historico");

    await expect(atualizarOrcamentosFinaisVencidos()).resolves.toBe(2);
    expect(rpc).toHaveBeenCalledWith("vencer_orcamentos_finais");
    expect(from).not.toHaveBeenCalled();
  });

  it("cancela versão final com o motivo digitado", async () => {
    const { cancelarVersaoFinal } = await import("./orcamento-historico");
    const formData = new FormData();
    formData.set("versao_id", "55");
    formData.set("motivo", "Cliente cancelou");

    const estado = await cancelarVersaoFinal(ESTADO_INICIAL, formData);

    expect(estado.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("transicionar_orcamento_final", {
      p_versao_id: 55,
      p_status_destino: "cancelado",
      p_motivo: "Cliente cancelou",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento/historico");
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento");
  });

  it("exige motivo para cancelar e não chama o banco sem ele", async () => {
    const { cancelarVersaoFinal } = await import("./orcamento-historico");
    const formData = new FormData();
    formData.set("versao_id", "55");

    const estado = await cancelarVersaoFinal(ESTADO_INICIAL, formData);

    expect(estado).toEqual({ ok: false, message: "Informe o motivo do cancelamento." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("devolve a recusa do banco em vez de lançar", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "A versão OF-1-v1 desta proposta já está aprovada. Cancele-a antes de aprovar outra." },
    });
    const { classificarVersaoFinal } = await import("./orcamento-historico");
    const formData = new FormData();
    formData.set("versao_id", "77");
    formData.set("status", "aprovado");

    const estado = await classificarVersaoFinal(ESTADO_INICIAL, formData);

    expect(estado.ok).toBe(false);
    expect(estado.message).toMatch(/já está aprovada/);
  });

  it("classifica versao final e revalida fundos quando aprovado", async () => {
    const { classificarVersaoFinal } = await import("./orcamento-historico");
    const formData = new FormData();
    formData.set("versao_id", "77");
    formData.set("status", "aprovado");
    formData.set("motivo", "Cliente aprovou a proposta");

    const estado = await classificarVersaoFinal(ESTADO_INICIAL, formData);

    expect(estado.ok).toBe(true);
    expect(exigirPapelOrcamento).toHaveBeenCalledWith("classificar_final");
    expect(rpc).toHaveBeenCalledWith("transicionar_orcamento_final", {
      p_versao_id: 77,
      p_status_destino: "aprovado",
      p_motivo: "Cliente aprovou a proposta",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/orcamento/fundos");
  });

  it("sem permissão, devolve a mensagem sem chamar o banco", async () => {
    exigirPapelOrcamento.mockRejectedValueOnce(new Error("Sem permissão para classificar orçamento final."));
    const { classificarVersaoFinal } = await import("./orcamento-historico");
    const formData = new FormData();
    formData.set("versao_id", "77");
    formData.set("status", "recusado");

    const estado = await classificarVersaoFinal(ESTADO_INICIAL, formData);

    expect(estado).toEqual({ ok: false, message: "Sem permissão para classificar orçamento final." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("duplica com a identidade de operacao fornecida antes da action", async () => {
    const operacaoId = "44444444-4444-4444-8444-444444444444";
    rpc.mockResolvedValueOnce({ data: { id: 88, repetido: false }, error: null });
    const { duplicarVersaoFinal } = await import("./orcamento-historico");
    const formData = new FormData();
    formData.set("versao_id", "55");
    formData.set("validade_dias", "30");
    formData.set("operacao_id", operacaoId);

    await expect(duplicarVersaoFinal(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/orcamento/final/88",
    );

    expect(rpc).toHaveBeenCalledWith("duplicar_orcamento_final_transacional", {
      p_versao_id: 55,
      p_validade_dias: 30,
      p_operacao_id: operacaoId,
    });
  });

  it("duplicação recusada volta à proposta com a mensagem", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "A proposta OF-1-v1 já está aprovada. Cancele a aprovação antes de criar nova versão." },
    });
    const { duplicarVersaoFinal } = await import("./orcamento-historico");
    const formData = new FormData();
    formData.set("versao_id", "55");
    formData.set("operacao_id", "44444444-4444-4444-8444-444444444444");

    await expect(duplicarVersaoFinal(formData)).rejects.toThrow("NEXT_REDIRECT:/orcamento/final/55?erro=");
  });

  it("gera o planejamento e avisa quando a proposta não tem análises", async () => {
    rpc.mockResolvedValueOnce({ data: { plano_id: null, motivo: "sem_analises" }, error: null });
    const { gerarPlanejamentoDaProposta } = await import("./orcamento-historico");
    const formData = new FormData();
    formData.set("versao_id", "55");

    const estado = await gerarPlanejamentoDaProposta(ESTADO_INICIAL, formData);
    expect(estado.ok).toBe(false);
    expect(estado.message).toMatch(/não tem análises/);

    rpc.mockResolvedValueOnce({ data: { plano_id: 9, criado: true }, error: null });
    await expect(gerarPlanejamentoDaProposta(ESTADO_INICIAL, formData)).rejects.toThrow("NEXT_REDIRECT:/planejamento/9");
  });
});
