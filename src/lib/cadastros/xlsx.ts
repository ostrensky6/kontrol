import ExcelJS from "exceljs";
import { CADASTROS, getCadastrosOrdenados, type CadastroConfig, type Campo } from "@/lib/cadastros/config";
import {
  CODIGOS_BARRAS_KEY,
  CODIGOS_BARRAS_LABEL,
  QUANTIDADE_INSUMO_KEY,
  QUANTIDADE_INSUMO_LABEL,
  TECH_ID_HEADER,
  TECH_SUFFIX,
} from "@/lib/cadastros/importacao";
import { projetarQuantidadeInsumos, type LoteInsumo } from "@/lib/cadastros/insumos";
import { VALOR_MASCARADO, estaMascarado } from "@/lib/cadastros/mascara";
import { lerLinhasCadastro } from "@/lib/cadastros/salario";
import { podeVerSalario } from "@/lib/auth/permissao-efetiva";
import { createClientUntyped } from "@/lib/supabase/server";
import { codigosBarrasPorInsumo } from "@/lib/scanner/vinculos-codigo";

export { TECH_ID_HEADER, TECH_SUFFIX };

export type CadastroRow = Record<string, unknown>;

export const INSTRUCOES_SHEET = "Instruções";
const TITULO_OBRIGATORIAS = "Colunas obrigatórias por aba";

const NOTA_QUANTIDADE_INSUMO =
  "Só para itens novos: número inteiro de embalagens fechadas que entram no estoque ao criar o insumo. " +
  "Para itens existentes a coluna é apenas informativa e é ignorada; entradas e baixas são feitas em Estoque.";

export function safeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function dateFromInput(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateToInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function opcoesParaCampos(
  campos: Campo[],
  rows: CadastroRow[] = [],
): Promise<Record<string, Map<string, string>>> {
  const supabase = await createClientUntyped();
  const opcoes: Record<string, Map<string, string>> = {};

  for (const campo of campos) {
    if (campo.opcoes) {
      opcoes[campo.name] = new Map(campo.opcoes.map((o) => [String(o.value), o.label]));
    }
    if (campo.opcoesDe) {
      const { data } = await supabase.from(campo.opcoesDe).select("id, nome").order("nome");
      opcoes[campo.name] = new Map(
        (data ?? []).map((r) => [
          String((r as unknown as { id: number }).id),
          String((r as unknown as { nome: string | null }).nome ?? ""),
        ]),
      );
    }
  }

  if (opcoes.tipo_insumo_id) {
    const tipoIdPorNome = new Map(
      [...opcoes.tipo_insumo_id.entries()].map(([id, label]) => [label.trim().toLowerCase(), id]),
    );
    for (const row of rows) {
      if (row.tipo_insumo_id != null || row.nome_item == null) continue;
      const id = tipoIdPorNome.get(String(row.nome_item).trim().toLowerCase());
      if (id) row.tipo_insumo_id = id;
    }
  }

  return opcoes;
}

export function valueForCell(value: unknown, campo?: Campo, opcoes?: Map<string, string>) {
  if (value == null || value === "") return null;
  if (estaMascarado(value)) return VALOR_MASCARADO;
  if (campo?.tipo === "checkbox") return value ? "Sim" : "Não";
  if (campo?.tipo === "select" && opcoes) return opcoes.get(String(value)) ?? value;
  if (campo?.tipo === "date") return dateFromInput(value) ?? value;
  if (campo?.tipo === "percent") {
    const n = Number(value);
    return Number.isFinite(n) ? n / 100 : value;
  }
  if (campo && ["number", "currency", "percent"].includes(campo.tipo)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  return value;
}

export function workbookColumns(cfg: CadastroConfig, rows: CadastroRow[]) {
  const campos = cfg.campos.filter((campo) => campo.exportar !== false);
  const labels = new Map<string, string>([
    ["id", TECH_ID_HEADER],
    ...campos.map((campo) => [campo.name, campo.label] as const),
    ...(cfg.colunasXlsx ?? []).map((coluna) => [coluna.key, coluna.label] as const),
  ]);
  const iniciais = cfg.colunasXlsx?.map((coluna) => coluna.key) ?? [];
  const keys = [
    "id",
    ...iniciais,
    ...campos
      .flatMap((campo) =>
        campo.tipo === "select" && campo.opcoesDe
          ? [campo.name, `${campo.name}${TECH_SUFFIX}`]
          : [campo.name],
      )
      .filter((key) => !iniciais.includes(key)),
    ...Object.keys(rows[0] ?? {}).filter(
      (key) =>
        key !== "id" &&
        !cfg.campos.some((campo) => campo.name === key) &&
        !cfg.campos.some((campo) => `${campo.name}${TECH_SUFFIX}` === key) &&
        !iniciais.includes(key),
    ),
  ];

  return keys.map((key) => ({
    key,
    header: key.endsWith(TECH_SUFFIX)
      ? `${labels.get(key.slice(0, -TECH_SUFFIX.length)) ?? key.slice(0, -TECH_SUFFIX.length)} ID`
      : labels.get(key) ?? key,
    width: Math.min(Math.max((labels.get(key) ?? key).length + 4, 12), 36),
  }));
}

export function applyWorksheetFormatting(
  sheet: ExcelJS.Worksheet,
  cfg: CadastroConfig,
  rowCount: number,
) {
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F172A" },
  };
  sheet.getRow(1).alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rowCount + 1), column: sheet.columnCount },
  };

  const campoPorNome = new Map(cfg.campos.map((campo) => [campo.name, campo]));
  const colunaXlsxPorChave = new Map((cfg.colunasXlsx ?? []).map((coluna) => [coluna.key, coluna]));
  for (const column of sheet.columns) {
    column.alignment = { vertical: "top", wrapText: true };
    const key = String(column.key ?? "");
    const campo = campoPorNome.get(key.endsWith(TECH_SUFFIX) ? key.slice(0, -TECH_SUFFIX.length) : key);
    const tipo = campo?.tipo ?? colunaXlsxPorChave.get(key)?.tipo;
    if (key.endsWith(TECH_SUFFIX)) column.hidden = true;
    if (tipo === "currency") column.numFmt = '"R$" #,##0.00';
    if (tipo === "number") column.numFmt = "#,##0.###";
    if (tipo === "percent") column.numFmt = "0.0%";
    if (tipo === "date") column.numFmt = "dd/mm/yyyy";
  }

  if (cfg.slug === "insumos") {
    const colunaQuantidade = sheet.columns.find((column) => column.key === QUANTIDADE_INSUMO_KEY);
    if (colunaQuantidade?.number) {
      sheet.getRow(1).getCell(colunaQuantidade.number).note = NOTA_QUANTIDADE_INSUMO;
    }
  }
}

/** Linhas da aba "Instruções" (texto curto, pt-BR). */
export function instrucoesImportacao(cadastros: CadastroConfig[]): string[] {
  const linhas = [
    "Como usar esta planilha",
    "",
    "• Cada aba corresponde a um cadastro. Você pode enviar só as abas que quiser importar (por exemplo, apenas Insumos); abas ausentes são ignoradas.",
    "• A importação só adiciona e atualiza: nenhum registro é excluído do Kontrol, mesmo que a linha seja apagada da planilha.",
    "• Para atualizar, mantenha a coluna ID. Linhas sem ID são comparadas pelo nome; se o nome não existir, um novo registro é criado.",
    "• Em registros existentes, célula vazia mantém o valor atual. Para limpar um campo, edite o registro no Kontrol.",
    "• Números aceitam o formato brasileiro (1.234,56) e datas aceitam dd/mm/aaaa.",
    `• Insumos: a coluna "${QUANTIDADE_INSUMO_LABEL}" só vale para itens novos e cria o estoque inicial (número inteiro de embalagens). Para itens existentes ela é ignorada; entradas e baixas são feitas em Estoque.`,
    `• Insumos: na coluna "${CODIGOS_BARRAS_LABEL}" separe vários códigos por ponto e vírgula. A importação só acrescenta códigos; para tirar um código, edite o insumo no Kontrol. Código já vinculado a outro insumo é ignorado com aviso.`,
    '• Colunas terminadas em "ID" e colunas ocultas são técnicas: não as altere.',
    "",
    TITULO_OBRIGATORIAS,
  ];
  for (const cfg of cadastros) {
    const obrigatorias = cfg.campos
      .filter((campo) => campo.obrigatorio && campo.exportar !== false)
      .map((campo) => campo.label);
    linhas.push(`• ${cfg.titulo}: ${obrigatorias.length ? obrigatorias.join(", ") : "nenhuma"}`);
  }
  return linhas;
}

function addInstrucoesWorksheet(workbook: ExcelJS.Workbook, cadastros: CadastroConfig[]) {
  const sheet = workbook.addWorksheet(INSTRUCOES_SHEET);
  sheet.columns = [{ key: "texto", width: 120 }];
  const linhas = instrucoesImportacao(cadastros);
  for (const texto of linhas) sheet.addRow({ texto });
  sheet.getColumn(1).alignment = { vertical: "top", wrapText: true };
  sheet.getRow(1).font = { bold: true, size: 13 };
  sheet.getRow(linhas.indexOf(TITULO_OBRIGATORIAS) + 1).font = { bold: true };
}

export async function addCadastroWorksheet(
  workbook: ExcelJS.Workbook,
  cfg: CadastroConfig,
  rows: CadastroRow[],
) {
  const sheet = workbook.addWorksheet(cfg.titulo.slice(0, 31));
  const opcoes = await opcoesParaCampos(cfg.campos, rows);
  const campoPorNome = new Map(cfg.campos.map((campo) => [campo.name, campo]));

  sheet.columns = workbookColumns(cfg, rows);
  for (const row of rows) {
    sheet.addRow(
      Object.fromEntries(
        sheet.columns.map((column) => {
          const key = String(column.key ?? "");
          if (key.endsWith(TECH_SUFFIX)) {
            const sourceKey = key.slice(0, -TECH_SUFFIX.length);
            return [key, row[sourceKey] ?? null];
          }
          return [key, valueForCell(row[key], campoPorNome.get(key), opcoes[key])];
        }),
      ),
    );
  }

  applyWorksheetFormatting(sheet, cfg, rows.length);
}

export async function buildCadastrosWorkbook(slug?: string) {
  const supabase = await createClientUntyped();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Kontrol";
  workbook.created = new Date();

  const cadastros = slug ? [CADASTROS[slug]].filter(Boolean) : getCadastrosOrdenados();
  addInstrucoesWorksheet(workbook, cadastros);
  // Sem permissão, a planilha leva "XXX" no salário (nunca o valor real);
  // reimportar "XXX" mantém o salário atual.
  const podeVerSalarioTecnicos = cadastros.some((cfg) => cfg.tabela === "tecnicos")
    ? await podeVerSalario()
    : false;
  for (const cfg of cadastros) {
    const { data, error } = await lerLinhasCadastro(supabase, cfg.tabela, {
      podeVerSalario: podeVerSalarioTecnicos,
    });
    if (error) throw new Error(error.message);
    let rows = ((data ?? []) as CadastroRow[]).map((row) => ({ ...row }));
    if (cfg.slug === "insumos") {
      const { data: lotes, error: lotesError } = await supabase
        .from("lotes_estoque")
        .select("insumo_id, status, quantidade_atual, validade, validade_apos_abertura, data_abertura");
      if (lotesError) throw new Error(lotesError.message);
      rows = projetarQuantidadeInsumos(rows, (lotes ?? []) as LoteInsumo[]);
      const codigos = await codigosBarrasPorInsumo(supabase);
      rows = rows.map((row) => ({ ...row, [CODIGOS_BARRAS_KEY]: (codigos.get(String(row.id)) ?? []).join("; ") }));
    }
    await addCadastroWorksheet(workbook, cfg, rows);
  }

  return workbook;
}
