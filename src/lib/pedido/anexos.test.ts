import { describe, expect, it } from "vitest";
import {
  LIMITE_ENVIO_ANEXOS_BYTES,
  motivoArquivosRecusados,
  motivoTipoForaDaEtapa,
  pedidoComSolicitante,
  tiposDeDocumentoNoStatus,
} from "./anexos";

const pdf = (name: string, size: number) => ({ name, size, type: "application/pdf" });

/** Relatório de ajustes de 19/11/2026, ajuste 2. */
describe("cotação prévia e termo de referência são de quem pede", () => {
  it("enquanto o pedido está com o solicitante, os dois tipos aparecem em Registrar documento", () => {
    for (const status of ["rascunho", "ajuste_solicitante", "ajuste_compras"]) {
      expect(pedidoComSolicitante(status), status).toBe(true);
      const tipos = tiposDeDocumentoNoStatus(status).map((t) => t.rotulo);
      expect(tipos, status).toContain("Cotação prévia");
      expect(tipos, status).toContain("Termo de referência");
      expect(motivoTipoForaDaEtapa("orcamento_previo", status)).toBeNull();
    }
  });

  it("da Aprovação em diante, os dois saem da lista e o servidor recusa", () => {
    for (const status of ["em_validacao", "validado", "analise_administrativa", "orcamentos", "compra_fechada", "aguardando_pagamento_nf"]) {
      const tipos = tiposDeDocumentoNoStatus(status).map((t) => t.rotulo);
      expect(tipos, status).not.toContain("Cotação prévia");
      expect(tipos, status).not.toContain("Termo de referência");
      // os outros documentos continuam
      expect(tipos, status).toEqual(
        expect.arrayContaining(["Cotação do fornecedor", "Print", "E-mail", "Ofício", "Boleto", "Nota fiscal", "Comprovante", "Outro"]),
      );
      expect(motivoTipoForaDaEtapa("orcamento_previo", status), status).toContain("entram com o pedido");
      expect(motivoTipoForaDaEtapa("termo_referencia", status), status).toContain("entram com o pedido");
      expect(motivoTipoForaDaEtapa("proposta", status), status).toBeNull();
    }
  });
});

describe("arquivos de um envio", () => {
  it("aceita PDF, imagem, DOCX e XLSX até o limite somado", () => {
    expect(motivoArquivosRecusados([pdf("cotacao.pdf", 1024 * 1024), pdf("termo.pdf", 2 * 1024 * 1024)])).toBeNull();
    expect(motivoArquivosRecusados([pdf("exato.pdf", LIMITE_ENVIO_ANEXOS_BYTES)])).toBeNull();
    expect(motivoArquivosRecusados([{ name: "foto.png", size: 1000, type: "image/png" }])).toBeNull();
  });

  it("recusa formato fora da lista", () => {
    expect(motivoArquivosRecusados([{ name: "planilha.xls", size: 1000, type: "application/vnd.ms-excel" }])).toBe(
      "“planilha.xls” não é PDF, imagem, DOCX ou XLSX.",
    );
  });

  it("recusa quando a soma passa do que o servidor aceita num envio", () => {
    expect(LIMITE_ENVIO_ANEXOS_BYTES).toBeLessThan(4 * 1024 * 1024);
    expect(motivoArquivosRecusados([pdf("grande.pdf", 5 * 1024 * 1024)])).toBe(
      "O arquivo tem 5 MB; cabe até 3,5 MB. Reduza o PDF ou registre um link.",
    );
    expect(motivoArquivosRecusados([pdf("a.pdf", 2 * 1024 * 1024), pdf("b.pdf", 2 * 1024 * 1024)])).toContain(
      "Os arquivos somam 4 MB; cabem até 3,5 MB por envio.",
    );
  });
});
