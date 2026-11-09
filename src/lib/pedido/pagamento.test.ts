import { describe, expect, it } from "vitest";

import { lerPendenciaPagamento, podeConfirmarEntrega } from "./pagamento";

describe("entrega antes do pagamento", () => {
  it("confirma entrega de serviço só com os itens físicos já recebidos", () => {
    const pedido = { status: "compra_fechada", entrega_confirmada_em: null };
    expect(podeConfirmarEntrega(pedido, [{ tipo: "servico" }])).toBe(true);
    expect(podeConfirmarEntrega(pedido, [{ tipo: "servico" }, { tipo: "material", recebido_em: null }])).toBe(false);
    expect(podeConfirmarEntrega(pedido, [{ tipo: "servico" }, { tipo: "material", recebido_em: "2026-11-09" }])).toBe(true);
    // só material: a entrega é o próprio recebimento
    expect(podeConfirmarEntrega(pedido, [{ tipo: "material", recebido_em: "2026-11-09" }])).toBe(false);
    expect(podeConfirmarEntrega({ ...pedido, entrega_confirmada_em: "x" }, [{ tipo: "servico" }])).toBe(false);
    expect(podeConfirmarEntrega({ ...pedido, status: "aguardando_pagamento_nf" }, [{ tipo: "servico" }])).toBe(false);
  });

  it("lê a pendência do banco e não inventa trava quando a leitura falha", async () => {
    const ok = { rpc: async () => ({ data: "Pagamento só depois do recebimento.", error: null }) };
    const vazio = { rpc: async () => ({ data: null, error: null }) };
    const falha = { rpc: async () => ({ data: null, error: { message: "x" } }) };
    expect(await lerPendenciaPagamento(ok, 1)).toContain("recebimento");
    expect(await lerPendenciaPagamento(vazio, 1)).toBeNull();
    expect(await lerPendenciaPagamento(falha, 1)).toBeNull();
  });
});
