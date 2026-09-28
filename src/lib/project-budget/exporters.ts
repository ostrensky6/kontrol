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
import { resolverIdentidadeComAviso } from "@/lib/orcamento/identidade-institucional";
import {
  RUBRICAS_PROJETO,
  calcularOrcamentoProjeto,
} from "./orcamento-projeto";

/**
 * Exportadores do orçamento de projeto (XLSX / DOCX / PDF imprimível),
 * adaptados do app ATGC Orçamentos ao modelo do Kontrol
 * (rubrica/meses_selecionados, gross-up de `calcularOrcamentoProjeto`).
 * Rodam no navegador (exceljs/docx/file-saver).
 */

export type ProjetoExportInfo = {
  numero: string | null;
  titulo: string;
  cliente_nome: string | null;
  cliente_cnpj: string | null;
  cliente_contato: string | null;
  coordenador: string | null;
  proprietario: string | null;
  responsavel: string | null;
  data_orcamento: string | null;
  status: string | null;
  project_months: number;
  escopo: string | null;
  cronograma: string | null;
  observacoes: string | null;
  /** Instituição do orçamento (GIA / UFPR ou ATGC); define o título e o criador. */
  instituicao?: string | null;
};

export type ProjetoExportItem = {
  rubrica: string;
  categoria?: string | null;
  descricao: string;
  unidade?: string | null;
  quantidade: number;
  preco_unitario: number;
  meses_selecionados?: number[] | null;
  total: number;
};

export type ProjetoCalculo = ReturnType<typeof calcularOrcamentoProjeto>;

const FONT_FAMILY = "Helvetica";
const INK = "1B3530";
const BLUE = "005EA8";
const TEAL = "0B8793";
const SOFT_FILL = "F4FBFB";
const HEADER_FILL = "E8F4F3";
const LINE = "D9E7E4";

// Documento de trabalho da equipe (custos, parâmetros e margem): o nome diz
// que é interno, para não seguir por engano no lugar da proposta.
const arquivoBase = (info: ProjetoExportInfo) =>
  `orcamento-projeto-interno-${(info.numero || info.titulo || "kontrol").replace(/[^\w-]+/g, "_")}`;

const rubricaLabel = (code: string) =>
  RUBRICAS_PROJETO[code as keyof typeof RUBRICAS_PROJETO] ?? code;

const quantidadeLabel = (item: ProjetoExportItem) =>
  item.rubrica === "PE" && item.meses_selecionados?.length
    ? `${item.meses_selecionados.length} ${item.meses_selecionados.length === 1 ? "mês" : "meses"}`
    : `${item.quantidade} ${item.unidade ?? ""}`.trim();

export async function exportProjetoXlsx(
  info: ProjetoExportInfo,
  itens: ProjetoExportItem[],
  calculo: ProjetoCalculo,
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = resolverIdentidadeComAviso(info.instituicao).identidade.creator;

  const projeto = wb.addWorksheet("Projeto");
  projeto.addRows([
    ["Número", info.numero ?? ""],
    ["Título", info.titulo],
    ["Cliente", info.cliente_nome ?? ""],
    ["CNPJ", info.cliente_cnpj ?? ""],
    ["Contato", info.cliente_contato ?? ""],
    ["Coordenador", info.coordenador ?? ""],
    ["Responsável", info.responsavel ?? ""],
    ["Status", info.status ?? ""],
    ["Meses do projeto", info.project_months],
    ["Escopo", info.escopo ?? ""],
    ["Cronograma", info.cronograma ?? ""],
    ["Observações", info.observacoes ?? ""],
  ]);

  const itemSheet = wb.addWorksheet("Itens");
  itemSheet.columns = [
    { header: "Rubrica", key: "rubrica", width: 28 },
    { header: "Grupo", key: "categoria", width: 24 },
    { header: "Descrição", key: "descricao", width: 52 },
    { header: "Unidade", key: "unidade", width: 12 },
    { header: "Quantidade", key: "quantidade", width: 16 },
    { header: "Meses PE", key: "meses", width: 22 },
    { header: "Valor unitário", key: "unitario", width: 16 },
    { header: "Total", key: "total", width: 16 },
  ];
  itens.forEach((item) =>
    itemSheet.addRow({
      rubrica: `${item.rubrica} · ${rubricaLabel(item.rubrica)}`,
      categoria: item.categoria ?? "",
      descricao: item.descricao,
      unidade: item.unidade ?? "",
      quantidade: item.quantidade,
      meses: item.meses_selecionados?.join(", ") ?? "",
      unitario: item.preco_unitario,
      total: item.total,
    }),
  );

  const resumo = wb.addWorksheet("Demonstrativo");
  resumo.addRows([
    ["Parâmetros econômicos"],
    ["Parâmetro", "Nominal (%)", "Valor", "Efetivo sobre custo (%)"],
    ...calculo.economicParameters.map((p) => [p.label, p.nominalRate, p.amount, p.effectiveRate]),
    [],
    ["Demonstrativo por rubrica"],
    ["Rubrica", "Itens", "Subtotal", "% no total final"],
    ...calculo.summaries
      .filter((s) => s.count > 0 || s.total > 0)
      .map((s) => [s.label, s.count, s.total, s.finalShare]),
    [],
    ["Subtotal (base)", calculo.subtotal],
    ["Σ parâmetros (%)", calculo.markupRate],
    ["Fator gross-up", calculo.grossUpFactor],
    ["Parâmetros econômicos", calculo.grossTotal - calculo.subtotal],
    ["Total final", calculo.grossTotal],
  ]);

  styleWorkbook(wb);
  formatCurrencyColumn(itemSheet, ["G", "H"]);
  formatCurrencyColumn(resumo, ["B", "C"]);
  resumo.getColumn(2).numFmt = "#,##0.00";
  resumo.getColumn(4).numFmt = "0.00";
  itemSheet.getColumn("E").numFmt = "#,##0.00";
  itemSheet.views = [{ state: "frozen", ySplit: 1 }];
  resumo.views = [{ state: "frozen", ySplit: 2 }];

  const buffer = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), `${arquivoBase(info)}.xlsx`);
}

export async function exportProjetoDocx(
  info: ProjetoExportInfo,
  itens: ProjetoExportItem[],
  calculo: ProjetoCalculo,
) {
  const { identidade } = resolverIdentidadeComAviso(info.instituicao);
  const doc = new Document({
    creator: identidade.creator,
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
          docParagraph(`Orçamento de projeto — ${identidade.nomeCurto}`, {
            heading: HeadingLevel.TITLE,
            bold: true,
            color: BLUE,
            size: 34,
          }),
          docParagraph("Uso interno — traz custos e parâmetros; não enviar ao cliente (a proposta é o documento do cliente).", {
            bold: true,
            color: "9A6700",
          }),
          docParagraph(`Título: ${info.titulo || "-"}`, { bold: true }),
          docParagraph(`Número: ${info.numero || "-"}`),
          docParagraph(`Cliente: ${info.cliente_nome || "-"}`),
          docParagraph(`Coordenador: ${info.coordenador || "-"}`),
          docParagraph(`Responsável: ${info.responsavel || "-"}`),
          docParagraph(`Status: ${info.status || "-"}`),
          docParagraph("Itens do orçamento", {
            heading: HeadingLevel.HEADING_1,
            bold: true,
            color: TEAL,
            size: 26,
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            borders: tableBorders(),
            rows: [
              tableRow(["Rubrica", "Descrição", "Qtd.", "Total"], true),
              ...itens.map((item) =>
                tableRow([
                  item.rubrica,
                  item.descricao,
                  quantidadeLabel(item),
                  formatCurrency(item.total),
                ]),
              ),
            ],
          }),
          docParagraph("Resumo financeiro", {
            heading: HeadingLevel.HEADING_1,
            bold: true,
            color: TEAL,
            size: 26,
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            borders: tableBorders(),
            rows: [
              tableRow(["Indicador", "Valor"], true),
              tableRow(["Subtotal (base)", formatCurrency(calculo.subtotal)]),
              tableRow(["Σ parâmetros", formatPercent(calculo.markupRate)]),
              tableRow(["Parâmetros econômicos", formatCurrency(calculo.grossTotal - calculo.subtotal)]),
              tableRow(["Total final", formatCurrency(calculo.grossTotal)], true),
            ],
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${arquivoBase(info)}.docx`);
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
    sheet.getRow(1).height = 24;
    sheet.getRow(1).font = { name: FONT_FAMILY, bold: true, color: { argb: `FF${BLUE}` }, size: 11 };
    sheet.columns.forEach((column) => {
      column.width = Math.max(column.width ?? 12, 12);
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
