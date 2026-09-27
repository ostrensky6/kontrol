import { describe, expect, it } from "vitest";
import {
  gerarCodigoInternoKontrol,
  isEntidadeTipo,
  normalizarCodigo,
  resolverIdentificadorInterno,
  validarEntidadeTipo,
} from "./identificadores";

describe("identificadores escaneaveis", () => {
  it("normaliza codigo para comparacao estavel", () => {
    expect(normalizarCodigo("  kontrol:lot:\t123 \n")).toBe("KONTROL:LOT:123");
    expect(normalizarCodigo("abc   123")).toBe("ABC 123");
    expect(normalizarCodigo("１２３")).toBe("123");
  });

  it("gera codigo interno Kontrol por entidade", () => {
    expect(gerarCodigoInternoKontrol("lote", 123)).toBe("KONTROL:LOT:123");
    expect(gerarCodigoInternoKontrol("insumo", 87)).toBe("KONTROL:INS:87");
    expect(gerarCodigoInternoKontrol("equipamento", 12)).toBe("KONTROL:EQP:12");
    expect(gerarCodigoInternoKontrol("equipamento_unidade", 44)).toBe("KONTROL:EQPU:44");
    expect(gerarCodigoInternoKontrol("local", 4)).toBe("KONTROL:LOC:4");
    expect(gerarCodigoInternoKontrol("pedido_compra", 55)).toBe("KONTROL:PEDC:55");
    expect(gerarCodigoInternoKontrol("pedido_interno", 56)).toBe("KONTROL:PEDI:56");
    expect(gerarCodigoInternoKontrol("planejamento", 31)).toBe("KONTROL:PLAN:31");
  });

  it("rejeita id interno invalido", () => {
    expect(() => gerarCodigoInternoKontrol("lote", 0)).toThrow("inteiro positivo");
    expect(() => gerarCodigoInternoKontrol("lote", 1.5)).toThrow("inteiro positivo");
  });

  it("valida entidade_tipo incluindo unidade fisica de equipamento", () => {
    expect(isEntidadeTipo("equipamento")).toBe(true);
    expect(isEntidadeTipo("equipamento_unidade")).toBe(true);
    expect(isEntidadeTipo("manutencao")).toBe(false);
    expect(validarEntidadeTipo("lote")).toBe("lote");
    expect(() => validarEntidadeTipo("manutencao")).toThrow("Tipo de entidade inválido");
  });

  it("resolve identificador interno Kontrol", () => {
    expect(resolverIdentificadorInterno(" kontrol:eqpu:44 ")).toEqual({
      entidadeTipo: "equipamento_unidade",
      entidadeId: 44,
    });
    expect(resolverIdentificadorInterno("KONTROL:LOT:123")).toEqual({
      entidadeTipo: "lote",
      entidadeId: 123,
    });
    expect(resolverIdentificadorInterno("KONTROL:LOT:0")).toBeNull();
    expect(resolverIdentificadorInterno("ABC123")).toBeNull();
  });
});
