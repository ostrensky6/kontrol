import { describe, expect, it } from "vitest";
import {
  destinoScanner,
  entidadeTipoRotaCurta,
  extrairRotaScanner,
  normalizarTipoScanner,
  parseRotaCurtaKontrol,
} from "./resolver";

describe("scanner global", () => {
  it("normaliza aliases de tipos aceitos", () => {
    expect(normalizarTipoScanner("lotes")).toBe("lote");
    expect(normalizarTipoScanner("insumos")).toBe("insumo");
    expect(normalizarTipoScanner("equip")).toBe("equipamento");
    expect(normalizarTipoScanner("patrimonio")).toBe("equipamento_unidade");
    expect(normalizarTipoScanner("equipamento_unidade")).toBe("equipamento_unidade");
    expect(normalizarTipoScanner("locais")).toBe("local");
    expect(normalizarTipoScanner("pedido")).toBeNull();
  });

  it("extrai rota curta de caminho ou URL completa", () => {
    expect(extrairRotaScanner("/s/lote/12")).toEqual({ tipo: "lote", id: "12" });
    expect(extrairRotaScanner("https://kontrol.test/s/insumo/7")).toEqual({
      tipo: "insumo",
      id: "7",
    });
  });

  it("gera destinos internos sem acionar fluxo operacional", () => {
    expect(destinoScanner("lote", 5)).toBe("/estoque/lotes/5");
    expect(destinoScanner("insumo", 5)).toBe("/estoque/insumos/5");
    expect(destinoScanner("equipamento", 5)).toBe("/estoque/equipamentos/tipos?focus=5");
    expect(destinoScanner("equipamento_unidade", 5)).toBe("/estoque/equipamentos?tab=unidades&focus=5");
    expect(destinoScanner("local", 5)).toBe("/cadastros/locais?focus=5");
  });

  it("aceita apenas tipos de rota curta do PR 2", () => {
    expect(entidadeTipoRotaCurta("lote")).toBe("lote");
    expect(entidadeTipoRotaCurta("equipamento_unidade")).toBe("equipamento_unidade");
    expect(entidadeTipoRotaCurta("pedido_compra")).toBeNull();
  });

  it("parseia rota curta Kontrol com id positivo", () => {
    expect(parseRotaCurtaKontrol("https://kontrol.test/s/equipamento_unidade/9")).toEqual({
      tipo: "equipamento_unidade",
      id: 9,
    });
    expect(parseRotaCurtaKontrol("/s/lote/0")).toBeNull();
    expect(parseRotaCurtaKontrol("/s/pedido_compra/10")).toBeNull();
  });
});
