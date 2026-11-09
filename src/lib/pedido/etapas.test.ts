import { describe, expect, it } from "vitest";

import {
  ETAPAS_PEDIDO,
  atendeFiltroEtapa,
  etapaDoPedido,
  filtroEtapaValido,
  posicaoEtapa,
  rotuloEtapa,
} from "./etapas";
import { PEDIDO_INTERNO_STATUS } from "./status";

describe("etapas do pedido", () => {
  it("todo status do fluxo cai em uma etapa", () => {
    for (const status of Object.keys(PEDIDO_INTERNO_STATUS)) {
      const etapa = etapaDoPedido({ status });
      expect(posicaoEtapa(etapa) >= 0, status).toBe(true);
      expect(rotuloEtapa(etapa), status).not.toBe("");
    }
  });

  it("segue a ordem do fluxo: solicitação → pagamento", () => {
    const sequencia = [
      "rascunho",
      "em_validacao",
      "formalizado",
      "orcamentos",
      "compra_fechada",
      "aguardando_pagamento_nf",
      "compra_concluida",
    ].map((status) => posicaoEtapa(etapaDoPedido({ status })));
    expect(sequencia).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(ETAPAS_PEDIDO).toHaveLength(6);
  });

  it("devolução fica na etapa de quem corrige", () => {
    expect(etapaDoPedido({ status: "ajuste_solicitante" })).toBe("solicitacao");
    expect(etapaDoPedido({ status: "ajuste_compras" })).toBe("administrativo");
  });

  it("material de laboratório validado ainda está na aprovação até o laboratório aprovar", () => {
    expect(etapaDoPedido({ status: "validado", natureza: "material_consumo_lab" })).toBe("aprovacao");
    expect(
      etapaDoPedido({ status: "validado", natureza: "material_consumo_lab", aprovacao_area_em: "2026-11-09T10:00:00Z" }),
    ).toBe("administrativo");
    expect(etapaDoPedido({ status: "validado", natureza: "material_consumo_geral" })).toBe("administrativo");
  });

  it("concluído e cancelado ficam fora do andamento", () => {
    expect(atendeFiltroEtapa("concluido", "andamento")).toBe(false);
    expect(atendeFiltroEtapa("cancelado", "andamento")).toBe(false);
    expect(atendeFiltroEtapa("cotacao", "andamento")).toBe(true);
    expect(atendeFiltroEtapa("cotacao", "todos")).toBe(true);
    expect(atendeFiltroEtapa("cotacao", "compra")).toBe(false);
    expect(posicaoEtapa("cancelado")).toBe(0);
    expect(rotuloEtapa("cancelado")).toBe("Cancelado");
  });

  it("filtro inválido na URL volta para em andamento", () => {
    expect(filtroEtapaValido("cotacao")).toBe("cotacao");
    expect(filtroEtapaValido("qualquer")).toBe("andamento");
    expect(filtroEtapaValido(undefined)).toBe("andamento");
    expect(filtroEtapaValido(["cotacao"])).toBe("andamento");
  });
});
