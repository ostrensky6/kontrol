import { describe, expect, it } from "vitest";
import {
  chaveCodigoBarras,
  codigoBarrasValido,
  lerGs1,
  separarCodigosBarras,
  variantesCodigoBarras,
} from "./codigo-barras";

describe("código de barras do fabricante", () => {
  it("EAN-13 lido pelo leitor USB é a própria chave", () => {
    expect(chaveCodigoBarras(" 7891234567895\n")).toBe("7891234567895");
    expect(lerGs1("7891234567895")).toBeNull();
  });

  it("GTIN-14 com zero à esquerda vira o EAN-13 impresso", () => {
    expect(chaveCodigoBarras("07891234567895")).toBe("7891234567895");
  });

  it("GS1 DataMatrix com lote e validade usa só o GTIN como chave", () => {
    const cru = "0107891234567895172701311" + "0L123AB";
    expect(lerGs1(cru)).toEqual({ gtin: "07891234567895", validade: "2027-01-31", lote: "L123AB" });
    expect(chaveCodigoBarras(cru)).toBe("7891234567895");
  });

  it("GS1 com FNC1 (GS) entre campos variáveis e com parênteses", () => {
    const comGs = "0107891234567895" + "10LOTE9\u001d" + "17261200";
    expect(lerGs1(comGs)).toEqual({ gtin: "07891234567895", validade: "2026-12-31", lote: "LOTE9" });
    expect(lerGs1("(01)07891234567895(17)270615(10)X1")).toEqual({
      gtin: "07891234567895",
      validade: "2027-06-15",
      lote: "X1",
    });
    expect(lerGs1("]d2010789123456789517270615")?.validade).toBe("2027-06-15");
  });

  it("dois lotes do mesmo produto caem na mesma chave", () => {
    expect(chaveCodigoBarras("01078912345678951727013110AAA")).toBe(
      chaveCodigoBarras("01078912345678951728063010BBB"),
    );
  });

  it("variantes cobrem EAN-13, GTIN-14 e UPC", () => {
    expect(variantesCodigoBarras("7891234567895")).toEqual(
      expect.arrayContaining(["7891234567895", "07891234567895"]),
    );
    expect(variantesCodigoBarras("036000291452")).toEqual(
      expect.arrayContaining(["036000291452", "0036000291452", "00036000291452"]),
    );
    expect(variantesCodigoBarras("ab-12")).toEqual(["AB-12"]);
  });

  it("lista da planilha separa por ponto e vírgula, vírgula ou linha, sem repetir", () => {
    expect(separarCodigosBarras("7891234567895; 07891234567895\nXYZ-1, xyz-1")).toEqual([
      "7891234567895",
      "XYZ-1",
    ]);
    expect(separarCodigosBarras("")).toEqual([]);
    expect(separarCodigosBarras(null)).toEqual([]);
  });

  it("recusa código vazio ou longo demais", () => {
    expect(codigoBarrasValido("   ")).toBe(false);
    expect(codigoBarrasValido("1".repeat(121))).toBe(false);
    expect(codigoBarrasValido("7891234567895")).toBe(true);
  });
});
