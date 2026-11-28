import { describe, expect, it } from "vitest";
import {
  campoDocumentoNovoPedido,
  ehEnderecoWeb,
  lerDocumentosNovoPedido,
  LIMITE_ENVIO_ANEXOS_BYTES,
  MAXIMO_DOCUMENTOS_NOVO_PEDIDO,
  motivoArquivosRecusados,
  motivoTipoForaDaEtapa,
  pedidoComSolicitante,
  tiposDeDocumentoNoStatus,
} from "./anexos";

const pdf = (name: string, size: number) => ({ name, size, type: "application/pdf" });

/** Relatório de ajustes de 19/11/2026, ajuste 2. */
describe("orçamento prévio e termo de referência são de quem pede", () => {
  it("enquanto o pedido está com o solicitante, os dois tipos aparecem em Registrar documento", () => {
    for (const status of ["rascunho", "ajuste_solicitante", "ajuste_compras"]) {
      expect(pedidoComSolicitante(status), status).toBe(true);
      const tipos = tiposDeDocumentoNoStatus(status).map((t) => t.rotulo);
      expect(tipos, status).toContain("Orçamento prévio");
      expect(tipos, status).toContain("Termo de referência");
      expect(motivoTipoForaDaEtapa("orcamento_previo", status)).toBeNull();
    }
  });

  it("da Aprovação em diante, os dois saem da lista e o servidor recusa", () => {
    for (const status of ["em_validacao", "validado", "analise_administrativa", "orcamentos", "compra_fechada", "aguardando_pagamento_nf"]) {
      const tipos = tiposDeDocumentoNoStatus(status).map((t) => t.rotulo);
      expect(tipos, status).not.toContain("Orçamento prévio");
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
      "“planilha.xls” não é PDF, imagem, DOCX, XLSX ou XML.",
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

/** Pedido de Antonio em 19/11/2026 18:19 (Brasília): no Novo pedido, os mesmos campos de "Registrar documento". */
describe("documentos do Novo pedido: tipo, título, arquivo, link e observação", () => {
  function formulario(documentos: Record<number, Partial<Record<"tipo" | "titulo" | "url" | "observacao", string>> & { arquivo?: File }>) {
    const dados = new FormData();
    dados.set("documentos_indices", Object.keys(documentos).join(","));
    for (const [indice, campos] of Object.entries(documentos)) {
      for (const [campo, valor] of Object.entries(campos)) {
        dados.set(campoDocumentoNovoPedido(Number(indice), campo as "tipo"), valor as string | File);
      }
    }
    return dados;
  }

  it("lê cada documento com os cinco campos; link e valor estimado entram sem arquivo", () => {
    const arquivo = new File(["x"], "termo.pdf", { type: "application/pdf" });
    const lidos = lerDocumentosNovoPedido(
      formulario({
        0: { tipo: "orcamento_previo", titulo: "Cotação do kit", url: "https://loja.exemplo/kit", observacao: "Valor estimado: R$ 1.200,00" },
        3: { tipo: "termo_referencia", arquivo },
      }),
    );
    expect(lidos).toEqual([
      { tipo: "orcamento_previo", titulo: "Cotação do kit", arquivo: null, url: "https://loja.exemplo/kit", observacao: "Valor estimado: R$ 1.200,00" },
      { tipo: "termo_referencia", titulo: "termo.pdf", arquivo, url: null, observacao: null },
    ]);
  });

  it("conjunto em branco não vira documento; sem título e sem arquivo, vale o nome do tipo", () => {
    const lidos = lerDocumentosNovoPedido(
      formulario({
        0: { tipo: "orcamento_previo", titulo: "  ", url: "", observacao: "" },
        1: { tipo: "orcamento_previo", url: "https://loja.exemplo/ponteira" },
      }),
    );
    expect(lidos).toEqual([
      { tipo: "orcamento_previo", titulo: "Orçamento prévio", arquivo: null, url: "https://loja.exemplo/ponteira", observacao: null },
    ]);
  });

  it("só aceita os tipos de quem pede e respeita o máximo de documentos", () => {
    const muitos = Object.fromEntries(
      Array.from({ length: MAXIMO_DOCUMENTOS_NOVO_PEDIDO + 3 }, (_, i) => [i, { tipo: "nota_fiscal", titulo: `Doc ${i}` }]),
    );
    const lidos = lerDocumentosNovoPedido(formulario(muitos));
    expect(lidos).toHaveLength(MAXIMO_DOCUMENTOS_NOVO_PEDIDO);
    expect(new Set(lidos.map((d) => d.tipo))).toEqual(new Set(["orcamento_previo"]));
  });

  it("formulário sem a lista de documentos não grava nenhum", () => {
    expect(lerDocumentosNovoPedido(new FormData())).toEqual([]);
  });
});

describe("link ou referência externa", () => {
  it("só endereço http(s) vira link; o resto fica como texto", () => {
    expect(ehEnderecoWeb("https://loja.exemplo/kit?id=1")).toBe(true);
    expect(ehEnderecoWeb("http://loja.exemplo")).toBe(true);
    for (const valor of ["e-mail de 12/11", "javascript:alert(1)", "www.loja.exemplo", "", null, "https://loja.exemplo com espaço"]) {
      expect(ehEnderecoWeb(valor), String(valor)).toBe(false);
    }
  });
});
