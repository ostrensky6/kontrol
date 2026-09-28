import ExcelJS from "exceljs";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
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
import { formatCurrency, formatDate } from "@/lib/formatters";
import { rotuloModalidade } from "./orcamento-economico";
import type { PropostaFinalExport } from "./proposta-final-export";
import { rotuloStatusVersaoFinal } from "./rotulos-status";

const FONT_FAMILY = "Helvetica";
const INK = "1B3530";
const BLUE = "1A5292";
const HEADER_FILL = "E8F4F3";
const SOFT_FILL = "F4FBFB";
const LINE = "D9E7E4";

const arquivoNumero = (numero: string) => (numero || "kontrol").replace(/[^\w-]+/g, "_");

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
  // planilha interna: custo técnico, parâmetros e margem
  saveAs(new Blob([buffer]), `orcamento-interno-${arquivoNumero(info.numero)}.xlsx`);
}

/**
 * DOCX que vai ao cliente: o mesmo conteúdo da folha impressa. Custos técnicos,
 * parâmetros e margem ficam só no app (modo interno) e na planilha interna.
 */
export async function exportOrcamentoFinalDocx(dados: PropostaFinalExport) {
  const { info, economico } = dados;
  const cor = info.identidade.corPrincipal.slice(1);
  const secao = (titulo: string) =>
    docParagraph(titulo, { heading: HeadingLevel.HEADING_2, bold: true, color: cor, size: 24 });
  const linhasCliente = [
    info.clienteNome || "-",
    info.clienteCnpj ? `CNPJ/CPF: ${info.clienteCnpj}` : null,
    info.clienteContato ? `Contato: ${info.clienteContato}` : null,
  ].filter((linha): linha is string => Boolean(linha));
  const dias = Number(info.validadeDias ?? 0);
  const assinatura = (titulo: string, nome: string) => [
    docParagraph(" "),
    docParagraph("______________________________________________"),
    docParagraph(titulo, { size: 18, color: "475569" }),
    docParagraph(nome, { bold: true }),
    docParagraph("Data: ____/____/________", { size: 18, color: "475569" }),
  ];

  const doc = new Document({
    creator: info.identidade.creator,
    title: `${info.identidade.tituloDocumento} ${info.numero}`,
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
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    font: FONT_FAMILY,
                    size: 16,
                    color: "475569",
                    children: [
                      `${info.identidade.nomeLegal} · Proposta ${info.numero} · Página `,
                      PageNumber.CURRENT,
                      " de ",
                      PageNumber.TOTAL_PAGES,
                    ],
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          docParagraph(info.identidade.nomeLegal, { color: "475569" }),
          docParagraph("Proposta comercial", { heading: HeadingLevel.TITLE, bold: true, color: cor, size: 36 }),
          docParagraph(`Proposta nº ${info.numero} · Versão ${info.versao} · ${rotuloStatusVersaoFinal(info.status)}`),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            borders: tableBorders(),
            rows: [
              tableRow(["Valor total", "Emissão", "Válida até"], true),
              tableRow([formatCurrency(economico.totalFinal), formatDate(info.emitidoEm), formatDate(info.validade)]),
            ],
          }),

          secao("Proponente"),
          docParagraph(info.identidade.nomeLegal, { bold: true }),
          secao("Cliente"),
          ...linhasCliente.map((linha, i) => docParagraph(linha, { bold: i === 0 })),

          secao("Objeto"),
          docParagraph(info.demandaTitulo || "-", { bold: true }),
          ...(info.modalidade ? [docParagraph(rotuloModalidade(info.modalidade), { color: "475569" })] : []),
          docParagraph(info.escopo || "-"),

          secao("Serviços e valores"),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            borders: tableBorders(),
            rows: [
              tableRow(["Componente", "Descrição", "Qtd.", "Valor"], true),
              ...dados.composicaoComercial.map((l) =>
                tableRow([l.componente, l.descricao, String(l.quantidade), formatCurrency(l.valorComercial)]),
              ),
              tableRow(["", "", "Total", formatCurrency(economico.totalFinal)], true),
            ],
          }),

          secao("Condições comerciais"),
          docParagraph(
            dias > 0
              ? `Valores válidos por ${dias} dias a partir da emissão.`
              : `Valores válidos até ${formatDate(info.validade)}.`,
          ),
          docParagraph("Alterações de escopo, quantidade de amostras, premissas técnicas ou cronograma podem exigir nova versão da proposta."),

          ...assinatura("Pela proponente", info.identidade.nomeLegal),
          ...assinatura("De acordo, pelo cliente", info.clienteNome || "Nome e cargo"),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `proposta-${arquivoNumero(info.numero)}.docx`);
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
