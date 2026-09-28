import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { formatCurrency } from "@/lib/formatters";
import { exportOrcamentoFinalDocx, exportOrcamentoFinalXlsx } from "./final-exporters";
import { montarDocumentoProposta } from "./documento-proposta";
import { empresaDeRegistro } from "./empresas-emissoras";
import { resolverIdentidadeComAviso } from "./identidade-institucional";
import { montarPropostaFinalExport } from "./proposta-final-export";
import { textosDaVersao } from "./textos-proposta";
import { entradaDoSnapshot, montarVisaoInterna } from "./visao-interna";

vi.mock("file-saver", () => ({ saveAs: vi.fn() }));
const saveAsMock = vi.mocked(saveAs);

// Estrutura reconciliada (Política A): lab 80 + projeto 200, Σ 20% → total 350.
const propostaBase = {
  versao: {
    numero: "OF-2026-0001-v1",
    versao: 1,
    status: "emitido",
    criado_em: "2026-06-21T08:00:00Z",
    valido_ate: "2026-07-20",
    validade_dias: 30,
    total_final: 350,
  },
  snapshot: {
    consolidado: {
      totalLaboratorioCusto: 80,
      totalProjetoCusto: 200,
      economia: {
        politica: "A_GROSS_UP_TOTAL",
        subtotal: 280,
        somaPercentual: 20,
        fatorGrossUp: 1.25,
        totalParametros: 70,
        totalFinal: 350,
        formula: "total_final = (custo_laboratorial_tecnico + custo_direto_projeto) / (1 - Σparametros/100)",
        parametros: [{ label: "Impostos", percentual: 20, valorNominal: 70 }],
      },
    },
    orcamentos_analises: [{ orcamento_itens: [{ codigo_analise: "qPCR", n_amostras: 2, custo_unitario: 40, preco_unitario: 60 }] }],
    orcamentos_projeto: [{ orcamento_projeto_custos: [{ rubrica: "MC", quantidade: 1, custo_unitario: 200 }], orcamento_projeto_analises: [] }],
  },
  demanda: { titulo: "Demanda híbrida", instituicao: "ATGC", cliente_nome: "Cliente Final", modalidade: "projeto_com_analises", escopo_preliminar: "Escopo" },
};
const dados = montarPropostaFinalExport(propostaBase);

/** Documento do cliente montado como a página faz (visão interna + textos + empresa). */
function documento(base: typeof propostaBase, empresa: unknown = null) {
  const { identidade } = resolverIdentidadeComAviso(base.demanda.instituicao);
  return montarDocumentoProposta({
    versao: base.versao,
    demanda: base.demanda,
    visao: montarVisaoInterna(entradaDoSnapshot(base.snapshot, base.versao.total_final)),
    textos: textosDaVersao({ coluna: null, snapshot: base.snapshot, escopoLegado: base.demanda.escopo_preliminar, validadeTexto: "Valores válidos por 30 dias a partir da emissão." }),
    empresa: empresa ? empresaDeRegistro(empresa, identidade) : null,
  });
}

describe("exportOrcamentoFinalXlsx (reconciliado)", () => {
  beforeEach(() => saveAsMock.mockClear());

  it("gera workbook com composição comercial reconciliada ao total final", async () => {
    await exportOrcamentoFinalXlsx(dados);
    expect(saveAsMock).toHaveBeenCalledTimes(1);
    // planilha é interna (custo técnico e parâmetros): o nome diz isso
    expect(saveAsMock.mock.calls[0][1]).toBe("orcamento-interno-OF-2026-0001-v1.xlsx");

    const blob = saveAsMock.mock.calls[0][0] as Blob;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());

    expect(wb.worksheets.map((s) => s.name)).toEqual([
      "Proposta",
      "Resumo econômico",
      "Composição comercial",
      "Detalhamento técnico",
    ]);
    expect(wb.creator).toBe("Kontrol - ATGC");
    expect(wb.getWorksheet("Proposta")!.getCell("B1").value).toBe("ATGC Genética Ambiental Ltda.");
    // a soma dos valores comerciais deve reconciliar com o total final (350)
    const comercial = wb.getWorksheet("Composição comercial")!;
    let soma = 0;
    comercial.eachRow((row, n) => {
      if (n === 1) return; // header
      const v = row.getCell(7).value; // coluna "Valor comercial"
      if (typeof v === "number") soma += v;
    });
    // inclui a linha "Total final" (350) + linhas dos componentes (350) = 700
    expect(soma).toBe(700);
  });
});

/** Texto corrido do DOCX gerado (corpo e rodapé), sem as tags do Word. */
async function textoDoDocx(blob: Blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const partes = Object.keys(zip.files).filter((nome) => /^word\/(document|footer\d*)\.xml$/.test(nome));
  const xml = await Promise.all(partes.map((nome) => zip.file(nome)!.async("string")));
  return xml.join(" ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("exportOrcamentoFinalDocx (documento do cliente)", () => {
  beforeEach(() => saveAsMock.mockClear());

  it("gera DOCX nomeado como proposta pelo numero da versao final", async () => {
    await exportOrcamentoFinalDocx(documento(propostaBase));
    expect(saveAsMock).toHaveBeenCalledTimes(1);
    expect(saveAsMock.mock.calls[0][1]).toBe("proposta-OF-2026-0001-v1.docx");
    expect((saveAsMock.mock.calls[0][0] as Blob).size).toBeGreaterThan(1000);
  });

  it("traz só o que o cliente vê: sem margem, parâmetros nem custo técnico", async () => {
    await exportOrcamentoFinalDocx(documento(propostaBase));
    const texto = await textoDoDocx(saveAsMock.mock.calls[0][0] as Blob);

    for (const interno of [
      "Resumo econômico",
      "Parâmetros econômicos",
      "Subtotal técnico",
      "Soma dos parâmetros",
      "gross-up",
      "total_final",
      "Participação",
      "custo técnico",
      "custo unit",
      "fator",
      "regra econômica anterior",
      "Kontrol",
    ]) {
      expect(texto.toLowerCase(), `não pode conter "${interno}"`).not.toContain(interno.toLowerCase());
    }
    // "impostos" só como aviso ao cliente de que estão inclusos, nunca como linha de parâmetro
    expect(texto.toLowerCase().replace(/impostos inclusos/g, "")).not.toContain("impostos");
  });

  it("mostra proposta, cliente, serviços, total e condições com datas legíveis", async () => {
    await exportOrcamentoFinalDocx(documento(propostaBase));
    const texto = await textoDoDocx(saveAsMock.mock.calls[0][0] as Blob);

    expect(texto).toContain("Proposta comercial");
    expect(texto).toContain("OF-2026-0001-v1");
    expect(texto).toContain("Cliente Final");
    expect(texto).toContain("Serviços e valores");
    expect(texto).toContain(formatCurrency(350).replace(/\s+/g, " "));
    expect(texto).toContain("Condições comerciais");
    expect(texto).toContain("21/06/2026");
    expect(texto).toContain("20/07/2026");
    expect(texto).not.toContain("2026-06-21T");
  });

  it("traz os dados cadastrais da empresa emissora e o nome dela como autora", async () => {
    await exportOrcamentoFinalDocx(documento(propostaBase, { nome_legal: "ATGC Genética Ambiental Ltda.", cnpj: "12.345.678/0001-90", endereco: "Rua A, 1 - Curitiba/PR" }));
    const blob = saveAsMock.mock.calls[0][0] as Blob;
    const texto = await textoDoDocx(blob);
    expect(texto).toContain("CNPJ 12.345.678/0001-90");
    expect(texto).toContain("Rua A, 1 - Curitiba/PR");
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const core = await zip.file("docProps/core.xml")!.async("string");
    expect(core).toContain("ATGC Genética Ambiental Ltda.");
    expect(core).not.toContain("Kontrol");
  });

  it("gera XLSX GIA com criador e instituição GIA", async () => {
    const gia = montarPropostaFinalExport({
      ...propostaBase,
      demanda: { titulo: "Demanda GIA", instituicao: "GIA / UFPR", cliente_nome: "Cliente Final", modalidade: "analises", escopo_preliminar: "Escopo" },
    });
    await exportOrcamentoFinalXlsx(gia);
    const blob = saveAsMock.mock.calls[0][0] as Blob;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    expect(wb.creator).toBe("Kontrol - GIA");
    expect(wb.getWorksheet("Proposta")!.getCell("B1").value).toBe("Grupo Integrado de Aquicultura e Estudos Ambientais");
  });
});
