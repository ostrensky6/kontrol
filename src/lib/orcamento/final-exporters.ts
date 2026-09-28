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
import type { ModeloDocumentoProposta } from "./documento-proposta";
import type { PropostaFinalExport } from "./proposta-final-export";
import type { DocTexto, NoInline, NoParagrafo } from "./texto-rico";

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
 * DOCX que vai ao cliente: o mesmo modelo da folha A4 (documento-proposta.ts).
 * Custos técnicos, parâmetros e margem ficam só no app e na planilha interna;
 * o nome do Kontrol não aparece (é ferramenta interna).
 */
export async function exportOrcamentoFinalDocx(modelo: ModeloDocumentoProposta) {
  const { empresa, cliente } = modelo;
  const cor = modelo.identidade.corPrincipal.slice(1);
  const cinza = "475569";
  const secao = (numero: number | null, titulo: string) =>
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 240, after: 100 },
      children: [
        new TextRun({
          text: `${numero != null ? `${numero}. ` : ""}${titulo}`,
          font: FONT_FAMILY,
          bold: true,
          allCaps: true,
          color: cor,
          size: 20,
        }),
      ],
    });
  const dado = (rotulo: string, valor: string | null | undefined) =>
    valor
      ? [
          new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({ text: `${rotulo}: `, font: FONT_FAMILY, color: cinza, size: 20 }),
              new TextRun({ text: valor, font: FONT_FAMILY, color: INK, size: 20 }),
            ],
          }),
        ]
      : [];
  const assinatura = (titulo: string, nome: string) => [
    docParagraph(" "),
    docParagraph("______________________________________________"),
    docParagraph(nome, { bold: true }),
    docParagraph(titulo, { size: 18, color: cinza }),
    docParagraph("Data: ____/____/________", { size: 18, color: cinza }),
  ];
  const identificacao = [empresa.nomeLegal, empresa.cnpj ? `CNPJ ${empresa.cnpj}` : null, `Proposta ${modelo.numero}`]
    .filter(Boolean)
    .join(" · ");
  const servicos = modelo.servicos.grupos.flatMap((grupo) => [
    tableRow([grupo.titulo, "", "", formatCurrency(grupo.subtotal)], "grupo"),
    ...grupo.itens.map((item) =>
      tableRow([item.descricao, item.quantidade, formatCurrency(item.valorUnitario), formatCurrency(item.valorTotal)]),
    ),
  ]);

  const doc = new Document({
    creator: empresa.nomeLegal,
    title: `Proposta comercial ${modelo.numero} - ${empresa.nomeLegal}`,
    styles: {
      default: {
        document: {
          run: { font: FONT_FAMILY, color: INK, size: 21 },
          paragraph: { alignment: AlignmentType.JUSTIFIED, spacing: { after: 100 } },
        },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 850, right: 850, bottom: 1000, left: 850 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    font: FONT_FAMILY,
                    size: 15,
                    color: cinza,
                    children: [`${identificacao} · Página `, PageNumber.CURRENT, " de ", PageNumber.TOTAL_PAGES],
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          docParagraph(empresa.nomeLegal, { bold: true, size: 24 }),
          ...[
            empresa.cnpj ? `CNPJ ${empresa.cnpj}` : null,
            empresa.endereco,
            [empresa.telefone, empresa.email, empresa.site].filter(Boolean).join(" · ") || null,
          ]
            .filter((linha): linha is string => Boolean(linha))
            .map((linha) => docParagraph(linha, { size: 18, color: cinza })),
          docParagraph("Proposta comercial", { heading: HeadingLevel.TITLE, bold: true, color: cor, size: 36 }),
          docParagraph(
            modelo.rascunho
              ? "Prévia, ainda não emitida"
              : `Proposta nº ${modelo.numero} · Versão ${modelo.versao} · ${modelo.statusRotulo}`,
          ),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            borders: tableBorders(),
            rows: [
              tableRow(["Valor total (impostos inclusos)", "Emissão", "Válida até"], "cabecalho"),
              tableRow([formatCurrency(modelo.resumo.total), formatDate(modelo.emitidoEm), formatDate(modelo.validoAte)]),
            ],
          }),

          secao(null, "Cliente"),
          docParagraph(cliente.nome, { bold: true }),
          ...dado("CNPJ/CPF", cliente.documento),
          ...dado("Endereço", cliente.endereco),
          ...dado("Contato", cliente.contato),
          ...dado("E-mail", cliente.email),
          ...dado("Telefone", cliente.telefone),

          secao(modelo.numeracao.objeto, "Objeto"),
          docParagraph(modelo.objeto.titulo, { bold: true }),
          ...(modelo.objeto.modalidade ? [docParagraph(modelo.objeto.modalidade, { color: cinza, size: 18 })] : []),
          ...paragrafosTexto(modelo.objeto.descricao),

          ...(modelo.escopo && modelo.numeracao.escopo
            ? [
                secao(modelo.numeracao.escopo, "Escopo técnico"),
                ...dado("Matriz", modelo.escopo.matriz),
                ...dado("Amostras", modelo.escopo.amostras ? `${modelo.escopo.amostras} amostras` : null),
                ...dado("Análises", modelo.escopo.analises.join(" · ") || null),
                ...dado(
                  "Prazo técnico",
                  modelo.escopo.prazoDias ? `${modelo.escopo.prazoDias} dias a partir do recebimento das amostras` : null,
                ),
              ]
            : []),

          secao(modelo.numeracao.servicos, "Serviços e valores"),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            borders: tableBorders(),
            columnWidths: [4700, 1500, 1700, 1700],
            rows: [
              tableRow(["Item", "Qtd.", "Valor unit.", "Valor total"], "cabecalho"),
              ...servicos,
              tableRow(["Total (impostos inclusos)", "", "", formatCurrency(modelo.servicos.total)], "cabecalho"),
            ],
          }),

          ...modelo.secoes.flatMap((s) => [
            secao(s.numero, s.titulo),
            ...s.linhasAutomaticas.map((linha) => docParagraph(linha)),
            ...paragrafosTexto(s.texto),
          ]),

          secao(modelo.numeracao.aceite, "Aceite"),
          docParagraph("De acordo com os termos desta proposta."),
          ...assinatura("Pela proponente", empresa.nomeLegal),
          ...assinatura("De acordo, pelo cliente", cliente.nome === "—" ? "Nome e cargo" : cliente.nome),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `proposta-${arquivoNumero(modelo.numero)}.docx`);
}

/** Texto formatado (texto-rico.ts) em parágrafos do Word. */
function paragrafosTexto(doc: DocTexto | null | undefined): Paragraph[] {
  if (!doc) return [];
  const runs = (nos: NoInline[] | undefined, extra: { bold?: boolean } = {}) =>
    (nos ?? []).map((no) =>
      no.type === "hardBreak"
        ? new TextRun({ break: 1 })
        : new TextRun({
            text: no.text,
            font: FONT_FAMILY,
            color: INK,
            size: 21,
            bold: extra.bold || no.marks?.some((m) => m.type === "bold"),
          }),
    );
  return doc.content.flatMap((bloco): Paragraph[] => {
    if (bloco.type === "heading") {
      return [new Paragraph({ spacing: { before: 120, after: 60 }, children: runs(bloco.content, { bold: true }) })];
    }
    if (bloco.type === "bulletList" || bloco.type === "orderedList") {
      return bloco.content.flatMap((item, i) =>
        item.content.map(
          (p, j) =>
            new Paragraph({
              indent: { left: 400, hanging: 260 },
              spacing: { after: 60 },
              children: [
                new TextRun({
                  text: j === 0 ? (bloco.type === "bulletList" ? "•\t" : `${i + 1}.\t`) : "\t",
                  font: FONT_FAMILY,
                  size: 21,
                }),
                ...runs(p.content),
              ],
            }),
        ),
      );
    }
    return [new Paragraph({ children: runs((bloco as NoParagrafo).content) })];
  });
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

function tableRow(values: string[], tipo: boolean | "cabecalho" | "grupo" = false) {
  const cabecalho = tipo === true || tipo === "cabecalho";
  const fill = cabecalho ? HEADER_FILL : tipo === "grupo" ? SOFT_FILL : "FFFFFF";
  return new TableRow({
    children: values.map(
      (value, i) =>
        new TableCell({
          shading: { type: ShadingType.CLEAR, fill, color: "auto" },
          margins: { top: 70, bottom: 70, left: 110, right: 110 },
          children: [
            new Paragraph({
              alignment: i > 0 && values.length === 4 ? AlignmentType.RIGHT : AlignmentType.LEFT,
              children: [
                new TextRun({
                  text: value,
                  font: FONT_FAMILY,
                  bold: cabecalho || tipo === "grupo",
                  color: cabecalho ? BLUE : INK,
                  size: 19,
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
