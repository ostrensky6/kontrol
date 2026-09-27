import ExcelJS from "exceljs";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { saveAs } from "file-saver";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { rotuloModalidade } from "./orcamento-economico";
import type { PropostaFinalExport } from "./proposta-final-export";

const pct = (v: number) => formatPercent(v, 2);

const FONT_FAMILY = "Helvetica";
const INK = "1B3530";
const BLUE = "1A5292";
const HEADER_FILL = "E8F4F3";
const SOFT_FILL = "F4FBFB";
const LINE = "D9E7E4";

const arquivoBase = (numero: string) =>
  `orcamento-final-${(numero || "kontrol").replace(/[^\w-]+/g, "_")}`;

export async function exportOrcamentoFinalXlsx(dados: PropostaFinalExport) {
  const { info, economico } = dados;
  const wb = new ExcelJS.Workbook();
  wb.creator = info.identidade.creator;

  const capa = wb.addWorksheet("Proposta");
  capa.addRows([
    ["Instituição", info.identidade.nomeLegal],
    ["Número", info.numero],
    ["Versão", info.versao],
    ["Status", info.status],
    ["Emitido em", info.emitidoEm ?? ""],
    ["Cliente", info.clienteNome ?? ""],
    ["CNPJ/CPF", info.clienteCnpj ?? ""],
    ["Contato", info.clienteContato ?? ""],
    ["Orçamento", info.demandaTitulo ?? ""],
    ["Modalidade", info.modalidade ? rotuloModalidade(info.modalidade) : ""],
    ["Validade", info.validade ?? ""],
    ["Responsável", info.responsavel ?? ""],
    ["Escopo", info.escopo ?? ""],
    ...(dados.avisoLegado ? [["Aviso", dados.avisoLegado]] : []),
  ]);

  // Visão econômica (interna).
  const econ = wb.addWorksheet("Resumo econômico");
  econ.addRows([
    ["Indicador", "Valor"],
    ["Custo laboratório (técnico)", economico.custoLaboratorioTecnico],
    ["Custo direto de projeto", economico.custoDiretoProjeto],
    ["Subtotal técnico", economico.subtotalTecnico],
    ["Soma dos parâmetros (%)", economico.somaPercentual],
    ["Fator de gross-up", economico.fatorGrossUp],
    ["Total de parâmetros", economico.totalParametros],
    ["Total final", economico.totalFinal],
    [],
    ["Parâmetro", "Percentual (%)", "Valor nominal"],
    ...economico.parametros.map((p) => [p.label, p.percentual, p.valorNominal]),
  ]);

  // Visão comercial (reconciliada): a soma dos valores comerciais = total final.
  const comercial = wb.addWorksheet("Composição comercial");
  comercial.columns = [
    { header: "Componente", key: "componente", width: 22 },
    { header: "Descrição", key: "descricao", width: 36 },
    { header: "Qtd", key: "quantidade", width: 10 },
    { header: "Custo unit. técnico", key: "custoUnitarioTecnico", width: 18 },
    { header: "Subtotal técnico", key: "subtotalTecnico", width: 18 },
    { header: "Participação", key: "participacao", width: 14 },
    { header: "Valor comercial", key: "valorComercial", width: 18 },
    { header: "Observação", key: "observacao", width: 22 },
  ];
  dados.composicaoComercial.forEach((l) =>
    comercial.addRow({
      componente: l.componente,
      descricao: l.descricao,
      quantidade: l.quantidade,
      custoUnitarioTecnico: l.custoUnitarioTecnico,
      subtotalTecnico: l.subtotalTecnico,
      participacao: `${(l.participacao * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
      valorComercial: l.valorComercial,
      observacao: l.observacao ?? "",
    }),
  );
  comercial.addRow({ descricao: "Total final", valorComercial: economico.totalFinal });

  // Detalhamento técnico (interno).
  const det = wb.addWorksheet("Detalhamento técnico");
  if (dados.exigeLaboratorio) {
    det.addRow(["Laboratório"]);
    det.addRow(["Descrição", "Amostras", "Custo unit. (técnico)", "Preço unit. (snapshot)", "Custo total"]);
    dados.detalhamento.laboratorio.forEach((i) => det.addRow([i.descricao, i.quantidade, i.custoUnitarioTecnico, i.precoSnapshot, i.custoTotal]));
    det.addRow([]);
  }
  if (dados.exigeProjeto) {
    det.addRow(["Projeto"]);
    det.addRow(["Rubrica", "Quantidade", "Custo unit. (técnico)", "Custo total", "Observação"]);
    dados.detalhamento.projeto.forEach((i) => det.addRow([i.rubrica, i.quantidade, i.custoUnitarioTecnico, i.custoTotal, i.observacao ?? ""]));
  }

  styleWorkbook(wb);
  formatCurrencyColumn(econ, ["B"]);
  formatCurrencyColumn(comercial, ["D", "E", "G"]);
  formatCurrencyColumn(det, ["C", "D", "E"]);

  const buffer = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), `${arquivoBase(info.numero)}.xlsx`);
}

export async function exportOrcamentoFinalDocx(dados: PropostaFinalExport) {
  const { info, economico } = dados;
  const doc = new Document({
    creator: info.identidade.creator,
    styles: {
      default: {
        document: {
          run: { font: FONT_FAMILY, color: INK, size: 22 },
          paragraph: { alignment: AlignmentType.JUSTIFIED, spacing: { after: 120 } },
        },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 900, right: 720, bottom: 900, left: 720 } } },
        children: [
          docParagraph(info.identidade.tituloDocumento, { heading: HeadingLevel.TITLE, bold: true, color: info.identidade.corPrincipal.slice(1), size: 34 }),
          docParagraph(`Número: ${info.numero} · Versão ${info.versao} · ${info.status}`),
          docParagraph(`Emitido em: ${info.emitidoEm || "-"} · Validade: ${info.validade || "-"}`),
          docParagraph(`Cliente: ${info.clienteNome || "-"} · Contato: ${info.clienteContato || "-"}`),
          docParagraph(`Orçamento: ${info.demandaTitulo || "-"} · Responsável: ${info.responsavel}`),
          ...(dados.avisoLegado ? [docParagraph(dados.avisoLegado, { bold: true, color: "9A6700" })] : []),
          docParagraph("Escopo", { heading: HeadingLevel.HEADING_1, bold: true, color: info.identidade.corPrincipal.slice(1), size: 26 }),
          docParagraph(info.escopo || "-"),

          // VISÃO COMERCIAL: valor comercial alocado + total final.
          docParagraph("Composição comercial", { heading: HeadingLevel.HEADING_1, bold: true, color: info.identidade.corPrincipal.slice(1), size: 26 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            borders: tableBorders(),
            rows: [
              tableRow(["Componente", "Descrição", "Qtd.", "Valor comercial"], true),
              ...dados.composicaoComercial.map((l) =>
                tableRow([l.componente, l.descricao, String(l.quantidade), formatCurrency(l.valorComercial)]),
              ),
              tableRow(["", "Total final", "", formatCurrency(economico.totalFinal)], true),
            ],
          }),
          docParagraph("Condições comerciais", { heading: HeadingLevel.HEADING_1, bold: true, color: info.identidade.corPrincipal.slice(1), size: 26 }),
          docParagraph("Valores válidos até a data indicada. Alterações de escopo, quantidade de amostras ou premissas técnicas podem exigir nova versão."),

          // VISÃO INTERNA: resumo econômico + parâmetros + detalhamento técnico.
          docParagraph("Resumo econômico (interno)", { heading: HeadingLevel.HEADING_1, bold: true, color: info.identidade.corPrincipal.slice(1), size: 26 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            borders: tableBorders(),
            rows: [
              tableRow(["Indicador", "Valor"], true),
              tableRow(["Custo laboratório (técnico)", formatCurrency(economico.custoLaboratorioTecnico)]),
              tableRow(["Custo direto de projeto", formatCurrency(economico.custoDiretoProjeto)]),
              tableRow(["Subtotal técnico", formatCurrency(economico.subtotalTecnico)]),
              tableRow(["Soma dos parâmetros", pct(economico.somaPercentual)]),
              tableRow(["Total de parâmetros", formatCurrency(economico.totalParametros)]),
              tableRow(["Total final", formatCurrency(economico.totalFinal)], true),
            ],
          }),
          ...(economico.parametros.length
            ? [
                docParagraph("Parâmetros econômicos", { heading: HeadingLevel.HEADING_1, bold: true, color: info.identidade.corPrincipal.slice(1), size: 26 }),
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  layout: TableLayoutType.FIXED,
                  borders: tableBorders(),
                  rows: [
                    tableRow(["Parâmetro", "Percentual", "Valor nominal"], true),
                    ...economico.parametros.map((p) => tableRow([p.label, pct(p.percentual), formatCurrency(p.valorNominal)])),
                  ],
                }),
              ]
            : []),
          docParagraph(economico.formula, { color: "6B7280", size: 18 }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${arquivoBase(info.numero)}.docx`);
}

function styleWorkbook(wb: ExcelJS.Workbook) {
  wb.eachSheet((sheet) => {
    sheet.properties.defaultRowHeight = 22;
    sheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.font = { name: FONT_FAMILY, size: 10, color: { argb: `FF${INK}` }, bold: rowNumber === 1 };
        cell.alignment = { vertical: "middle", horizontal: "justify", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: `FF${LINE}` } },
          left: { style: "thin", color: { argb: `FF${LINE}` } },
          bottom: { style: "thin", color: { argb: `FF${LINE}` } },
          right: { style: "thin", color: { argb: `FF${LINE}` } },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: rowNumber === 1 ? `FF${HEADER_FILL}` : "FFFFFFFF" },
        };
      });
    });
  });
}

function formatCurrencyColumn(sheet: ExcelJS.Worksheet, columns: string[]) {
  columns.forEach((column) => {
    sheet.getColumn(column).numFmt = '"R$" #,##0.00';
  });
}

function docParagraph(
  text: string,
  options: {
    heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
    bold?: boolean;
    color?: string;
    size?: number;
  } = {},
) {
  return new Paragraph({
    heading: options.heading,
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 160 },
    children: [
      new TextRun({
        text,
        font: FONT_FAMILY,
        bold: options.bold,
        color: options.color ?? INK,
        size: options.size ?? 22,
      }),
    ],
  });
}

function tableRow(values: string[], header = false) {
  return new TableRow({
    children: values.map(
      (value) =>
        new TableCell({
          shading: header
            ? { type: ShadingType.CLEAR, fill: HEADER_FILL, color: "auto" }
            : { type: ShadingType.CLEAR, fill: SOFT_FILL, color: "auto" },
          margins: { top: 90, bottom: 90, left: 120, right: 120 },
          children: [
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              children: [
                new TextRun({
                  text: value,
                  font: FONT_FAMILY,
                  bold: header,
                  color: header ? BLUE : INK,
                  size: 20,
                }),
              ],
            }),
          ],
        }),
    ),
  });
}

function tableBorders() {
  const border = { style: BorderStyle.SINGLE, color: LINE, size: 6 };
  return { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
}
