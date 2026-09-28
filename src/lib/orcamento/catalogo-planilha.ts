/**
 * Planilha do catálogo de custos de projeto (Fase E): exportar para editar no Excel e importar
 * de volta com prévia. Uma aba por rubrica (PE, MC, MP, ST, VD, OU). As regras de identidade,
 * repetição e permissão ficam na RPC `catalogo_projeto_importar` (0139); aqui só a leitura das
 * células e a montagem do arquivo.
 */
import ExcelJS from "exceljs";
import { normalizarChave, parseNumeroBr, valorCelula } from "@/lib/cadastros/importacao";
import { VALOR_MASCARADO } from "@/lib/cadastros/mascara";

export const RUBRICAS_PLANILHA = ["PE", "MC", "MP", "ST", "VD", "OU"] as const;
export type RubricaPlanilha = (typeof RUBRICAS_PLANILHA)[number];

export const ABAS_CATALOGO: Record<RubricaPlanilha, string> = {
  PE: "PE - Pessoal",
  MC: "MC - Material de consumo",
  MP: "MP - Material permanente",
  ST: "ST - Serviços de terceiros",
  VD: "VD - Viagens e diárias",
  OU: "OU - Outros",
};

export const ABA_INSTRUCOES_CATALOGO = "Instruções";

type Campo = "rubrica" | "descricao" | "unidade" | "preco" | "categoria";

/** Cabeçalhos aceitos (normalizados, sem acento). O primeiro de cada lista é o que sai na exportação. */
const CABECALHOS: Record<Campo, string[]> = {
  rubrica: ["rubrica"],
  descricao: ["descricao", "item descricao", "nome"],
  unidade: ["unidade", "un", "und", "unid"],
  preco: ["valor (r$)", "valor", "valor unitario", "preco", "preco unitario", "custo unitario", "valor unitario (r$)"],
  categoria: ["grupo", "categoria"],
};

export const COLUNAS_EXPORTACAO = [
  { key: "id", header: "Item", width: 10 },
  { key: "descricao", header: "Descrição", width: 48 },
  { key: "unidade", header: "Unidade", width: 14 },
  { key: "preco", header: "Valor (R$)", width: 14 },
  { key: "categoria", header: "Grupo", width: 20 },
  { key: "atualizado", header: "Valor atualizado em", width: 20 },
] as const;

export type LinhaPlanilhaCatalogo = {
  /** Onde a linha está, para mostrar na prévia: "MC - Material de consumo, linha 5". */
  origem: string;
  rubrica: string;
  descricao: string | null;
  unidade: string | null;
  preco: number | null;
  categoria: string | null;
};

export type LeituraPlanilhaCatalogo = {
  linhas: LinhaPlanilhaCatalogo[];
  /** Linhas deixadas de fora antes da prévia (ex.: valor XXX de quem não vê pessoal). */
  ignoradas: string[];
  abas: string[];
};

function rubricaDaAba(nome: string): RubricaPlanilha | null {
  const codigo = /^\s*([a-z]{2})\b/i.exec(nome)?.[1]?.toUpperCase();
  return (RUBRICAS_PLANILHA as readonly string[]).includes(codigo ?? "") ? (codigo as RubricaPlanilha) : null;
}

function textoCelula(valor: unknown): string | null {
  if (valor == null) return null;
  const texto = (valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor)).trim();
  return texto || null;
}

function colunasDaAba(sheet: ExcelJS.Worksheet) {
  const colunas = new Map<Campo, number>();
  sheet.getRow(1).eachCell((cell, numero) => {
    const chave = normalizarChave(valorCelula(cell));
    for (const [campo, nomes] of Object.entries(CABECALHOS) as [Campo, string[]][]) {
      if (!colunas.has(campo) && nomes.includes(chave)) colunas.set(campo, numero);
    }
  });
  return colunas;
}

/**
 * Lê as abas de rubrica (pelo código no início do nome: "MC", "MC - Material de consumo"…) ou
 * qualquer aba com a coluna "Rubrica". Linhas totalmente vazias são puladas; valor inválido segue
 * como `null` para a RPC apontar o erro na prévia.
 */
export function lerPlanilhaCatalogo(workbook: ExcelJS.Workbook): LeituraPlanilhaCatalogo {
  const linhas: LinhaPlanilhaCatalogo[] = [];
  const ignoradas: string[] = [];
  const abas: string[] = [];
  workbook.eachSheet((sheet) => {
    const colunas = colunasDaAba(sheet);
    const rubricaAba = rubricaDaAba(sheet.name);
    if (!colunas.has("descricao") || (!rubricaAba && !colunas.has("rubrica"))) return;
    abas.push(sheet.name);
    sheet.eachRow((row, numero) => {
      if (numero === 1) return;
      const ler = (campo: Campo) => {
        const coluna = colunas.get(campo);
        return coluna ? valorCelula(row.getCell(coluna)) : null;
      };
      const descricao = textoCelula(ler("descricao"));
      const valorBruto = ler("preco");
      const unidade = textoCelula(ler("unidade"));
      const categoria = textoCelula(ler("categoria"));
      if (!descricao && textoCelula(valorBruto) == null && !unidade) return;
      const origem = `${sheet.name}, linha ${numero}`;
      if (textoCelula(valorBruto)?.toUpperCase() === VALOR_MASCARADO) {
        ignoradas.push(`${origem}: valor ${VALOR_MASCARADO} (sem permissão para ver pessoal) fica como está.`);
        return;
      }
      linhas.push({
        origem,
        rubrica: (textoCelula(ler("rubrica")) ?? rubricaAba ?? "").toUpperCase(),
        descricao,
        unidade,
        preco: parseNumeroBr(valorBruto),
        categoria,
      });
    });
  });
  return { linhas, ignoradas, abas };
}

/** O que vai para a RPC (sem a origem, que fica só na tela). */
export function payloadImportacao(linhas: LinhaPlanilhaCatalogo[]) {
  return linhas.map(({ rubrica, descricao, unidade, preco, categoria }) => ({
    rubrica,
    descricao,
    unidade,
    preco,
    categoria,
  }));
}

export type AcaoImportacao = "novo" | "atualizar" | "igual" | "repetido" | "sem_permissao" | "erro";

export type LinhaPreviaImportacao = {
  origem: string;
  rubrica: string;
  descricao: string | null;
  unidade: string | null;
  preco: number | null;
  precoAtual: number | null;
  itemId: string | null;
  acao: AcaoImportacao;
  mensagem: string | null;
};

type RetornoRpcImportacao = {
  linha: number;
  rubrica: string;
  descricao: string | null;
  unidade: string | null;
  preco: number | null;
  acao: string;
  catalogo_item_id: string | null;
  preco_atual: number | null;
  mensagem: string | null;
};

const ACOES_IMPORTACAO: AcaoImportacao[] = ["novo", "atualizar", "igual", "repetido", "sem_permissao", "erro"];

/** Junta o retorno da RPC (linha = posição no envio, começando em 1) com a origem na planilha. */
export function lerPreviaImportacao(
  linhas: LinhaPlanilhaCatalogo[],
  retorno: RetornoRpcImportacao[] | null | undefined,
): LinhaPreviaImportacao[] {
  return (retorno ?? []).map((r) => ({
    origem: linhas[r.linha - 1]?.origem ?? `Linha ${r.linha}`,
    rubrica: r.rubrica,
    descricao: r.descricao,
    unidade: r.unidade,
    preco: r.preco == null ? null : Number(r.preco),
    precoAtual: r.preco_atual == null ? null : Number(r.preco_atual),
    itemId: r.catalogo_item_id,
    acao: (ACOES_IMPORTACAO as string[]).includes(r.acao) ? (r.acao as AcaoImportacao) : "erro",
    mensagem: r.mensagem,
  }));
}

export type ResumoImportacao = Record<AcaoImportacao, number>;

export function resumirImportacao(linhas: Pick<LinhaPreviaImportacao, "acao">[]): ResumoImportacao {
  const resumo = Object.fromEntries(ACOES_IMPORTACAO.map((acao) => [acao, 0])) as ResumoImportacao;
  for (const linha of linhas) resumo[linha.acao] += 1;
  return resumo;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Frase da prévia ou do resultado. */
export function mensagemImportacao(resumo: ResumoImportacao, aplicado: boolean) {
  const mudancas = resumo.novo + resumo.atualizar;
  const partes = [
    plural(resumo.novo, aplicado ? "item novo criado" : "item novo", aplicado ? "itens novos criados" : "itens novos"),
    plural(resumo.atualizar, aplicado ? "valor atualizado" : "valor a atualizar", aplicado ? "valores atualizados" : "valores a atualizar"),
    plural(resumo.igual, "sem mudança", "sem mudança"),
  ];
  const fora = resumo.repetido + resumo.sem_permissao + resumo.erro;
  if (fora) partes.push(plural(fora, "linha fica de fora", "linhas ficam de fora"));
  if (aplicado) return `Planilha importada: ${partes.join(", ")}.`;
  return mudancas
    ? `Prévia: ${partes.join(", ")}. Nada foi gravado ainda.`
    : `Prévia: nada a gravar (${partes.join(", ")}).`;
}

export type ItemCatalogoExportacao = {
  id: string;
  rubrica: string;
  descricao: string;
  unidade: string | null;
  categoria: string | null;
  preco_unitario: number | null;
  preco_mascarado?: boolean | null;
  valor_atualizado_em?: string | null;
  ativo?: boolean | null;
  substituido_por?: string | null;
};

export const INSTRUCOES_CATALOGO = [
  "Como usar esta planilha",
  "",
  "• Uma aba por rubrica. Edite os valores, acrescente linhas para itens novos e importe em Orçamentos › Modelos e catálogo › Importar planilha.",
  "• Antes de gravar, o Kontrol mostra uma prévia: o que é novo, o que muda de valor e o que fica igual.",
  "• O item é reconhecido pela rubrica + descrição + unidade (maiúsculas, acentos e espaços não contam). Mudar a descrição ou a unidade cria um item novo.",
  "• Nada é apagado nem arquivado pela planilha. Para arquivar ou unificar itens, use a tela do catálogo.",
  "• Se o mesmo item aparecer duas vezes, vale a última linha.",
  "• Valores aceitam o formato brasileiro (1.234,56). A coluna Item e a data são só informativas.",
  `• Pessoal (PE) só é lido por quem tem a permissão "Valores de pessoal no orçamento"; sem ela, o valor sai como ${VALOR_MASCARADO} e fica como está.`,
  "• Os orçamentos já feitos não mudam: cada um guarda o seu valor.",
];

function dataCurta(iso: string | null | undefined) {
  if (!iso) return null;
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? null : new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate()));
}

/** Monta o arquivo: instruções + uma aba por rubrica, só itens ativos e vigentes. */
export function montarPlanilhaCatalogo(itens: ItemCatalogoExportacao[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Kontrol";
  workbook.created = new Date();

  const instrucoes = workbook.addWorksheet(ABA_INSTRUCOES_CATALOGO);
  instrucoes.columns = [{ key: "texto", width: 120 }];
  for (const texto of INSTRUCOES_CATALOGO) instrucoes.addRow({ texto });
  instrucoes.getColumn(1).alignment = { vertical: "top", wrapText: true };
  instrucoes.getRow(1).font = { bold: true, size: 13 };

  const vigentes = itens.filter((item) => item.ativo !== false && !item.substituido_por);
  for (const rubrica of RUBRICAS_PLANILHA) {
    const sheet = workbook.addWorksheet(ABAS_CATALOGO[rubrica]);
    sheet.columns = COLUNAS_EXPORTACAO.map((coluna) => ({ ...coluna }));
    const daRubrica = vigentes.filter((item) => item.rubrica === rubrica);
    for (const item of daRubrica) {
      const mascarado = item.preco_mascarado || item.preco_unitario == null;
      sheet.addRow({
        id: item.id,
        descricao: item.descricao,
        unidade: item.unidade,
        preco: mascarado ? VALOR_MASCARADO : Number(item.preco_unitario),
        categoria: item.categoria,
        atualizado: dataCurta(item.valor_atualizado_em),
      });
    }
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getColumn("preco").numFmt = '"R$" #,##0.00';
    sheet.getColumn("atualizado").numFmt = "dd/mm/yyyy";
  }
  return workbook;
}
