import ExcelJS from "exceljs";
import JSZip from "jszip";

/**
 * Abre a planilha enviada para importação.
 *
 * O ExcelJS é o leitor principal, mas recusa alguns .xlsx válidos (com
 * imagens, gráficos, tabelas dinâmicas, validações ou fórmulas compartilhadas
 * em formatos que ele não entende). Quando isso acontece, um leitor de
 * reserva abre o pacote e lê só os valores das células, ignorando todo o
 * resto, e monta uma pasta de trabalho do ExcelJS com esses valores. A
 * importação só precisa de nomes de aba e valores.
 */
export type PlanilhaCarregada = {
  workbook: ExcelJS.Workbook;
  /** "reserva" quando o ExcelJS falhou e os valores vieram do leitor simples */
  leitor: "exceljs" | "reserva";
  /** motivo da falha do ExcelJS, para o registro de erros */
  falhaPrincipal?: string;
};

export async function carregarPlanilha(conteudo: ArrayBuffer): Promise<PlanilhaCarregada> {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(conteudo);
    if (workbook.worksheets.length > 0) return { workbook, leitor: "exceljs" };
    // Sem abas lidas: tenta o leitor simples antes de desistir.
    const reserva = await lerValoresXlsx(conteudo);
    return { workbook: reserva, leitor: "reserva", falhaPrincipal: "ExcelJS não encontrou abas" };
  } catch (erro) {
    const falhaPrincipal = erro instanceof Error ? erro.message : String(erro);
    const workbook = await lerValoresXlsx(conteudo);
    return { workbook, leitor: "reserva", falhaPrincipal };
  }
}

// ---- leitor de reserva (só valores) ----

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodificarXml(texto: string) {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (inteiro, ent: string) => {
    const chave = ent.toLowerCase();
    if (chave.startsWith("#x")) return String.fromCodePoint(Number.parseInt(chave.slice(2), 16));
    if (chave.startsWith("#")) return String.fromCodePoint(Number.parseInt(chave.slice(1), 10));
    return ENTIDADES[chave] ?? inteiro;
  });
}

/** Junta o texto de todos os <t> (texto simples ou rico) de um trecho XML. */
function textoDosT(xml: string) {
  let texto = "";
  for (const m of xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) texto += decodificarXml(m[1]);
  return texto;
}

function atributo(tag: string, nome: string) {
  const m = new RegExp(`(?:^|\\s)${nome}\\s*=\\s*"([^"]*)"`).exec(tag) ?? new RegExp(`(?:^|\\s)${nome}\\s*=\\s*'([^']*)'`).exec(tag);
  return m ? decodificarXml(m[1]) : null;
}

/** "AB12" → { linha: 12, coluna: 28 } */
function referencia(ref: string) {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(ref);
  if (!m) return null;
  let coluna = 0;
  for (const letra of m[1].toUpperCase()) coluna = coluna * 26 + (letra.charCodeAt(0) - 64);
  return { linha: Number(m[2]), coluna };
}

function caminhoNoPacote(base: string, alvo: string) {
  if (alvo.startsWith("/")) return alvo.slice(1);
  const partes = base.split("/").slice(0, -1);
  for (const parte of alvo.split("/")) {
    if (parte === "..") partes.pop();
    else if (parte && parte !== ".") partes.push(parte);
  }
  return partes.join("/");
}

/** Nome de aba aceito pelo ExcelJS: sem []:*?/\, até 31 caracteres e único. */
function nomeAbaSeguro(nome: string, usados: Set<string>) {
  const base = (nome.replace(/[[\]:*?/\\]/g, " ").trim() || "Aba").slice(0, 31);
  let candidato = base;
  for (let i = 2; usados.has(candidato.toLowerCase()); i += 1) {
    const sufixo = ` (${i})`;
    candidato = `${base.slice(0, 31 - sufixo.length)}${sufixo}`;
  }
  usados.add(candidato.toLowerCase());
  return candidato;
}

export async function lerValoresXlsx(conteudo: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const zip = await JSZip.loadAsync(conteudo);
  const arquivo = (caminho: string) =>
    zip.file(caminho) ?? zip.file(Object.keys(zip.files).find((n) => n.toLowerCase() === caminho.toLowerCase()) ?? "");
  const ler = async (caminho: string) => (await arquivo(caminho)?.async("string")) ?? null;

  // Pasta principal: indicada em _rels/.rels (normalmente xl/workbook.xml).
  const relsRaiz = (await ler("_rels/.rels")) ?? "";
  const alvoWorkbook =
    [...relsRaiz.matchAll(/<Relationship\b[^>]*>/g)]
      .map((m) => m[0])
      .find((tag) => /officeDocument"?$/.test(atributo(tag, "Type") ?? ""))
      ?.match(/Target\s*=\s*"([^"]*)"/)?.[1] ?? "xl/workbook.xml";
  const caminhoWorkbook = caminhoNoPacote("", alvoWorkbook);
  const workbookXml = await ler(caminhoWorkbook);
  if (!workbookXml) throw new Error("Pacote sem workbook.xml: não é uma planilha do Excel.");

  const pasta = caminhoWorkbook.split("/").slice(0, -1).join("/");
  const relsWorkbook = (await ler(`${pasta}/_rels/${caminhoWorkbook.split("/").pop()}.rels`)) ?? "";
  const alvos = new Map<string, string>();
  for (const m of relsWorkbook.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = atributo(m[0], "Id");
    const alvo = atributo(m[0], "Target");
    if (id && alvo) alvos.set(id, caminhoNoPacote(caminhoWorkbook, alvo));
  }

  const compartilhados: string[] = [];
  const caminhoShared =
    [...relsWorkbook.matchAll(/<Relationship\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => /sharedStrings"?$/.test(atributo(tag, "Type") ?? ""))
      .map((tag) => caminhoNoPacote(caminhoWorkbook, atributo(tag, "Target") ?? ""))[0] ?? `${pasta}/sharedStrings.xml`;
  const sharedXml = await ler(caminhoShared);
  if (sharedXml) {
    for (const m of sharedXml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\b[^>]*\/>/g)) {
      compartilhados.push(m[1] ? textoDosT(m[1]) : "");
    }
  }

  const workbook = new ExcelJS.Workbook();
  const usados = new Set<string>();
  const abas = [...workbookXml.matchAll(/<(?:\w+:)?sheet\b[^>]*\/?>/g)].map((m) => m[0]);
  for (const tag of abas) {
    const nome = atributo(tag, "name") ?? "Aba";
    const rid = atributo(tag, "r:id") ?? atributo(tag, "id");
    const caminho = rid ? alvos.get(rid) : undefined;
    const xml = caminho ? await ler(caminho) : null;
    if (!xml) continue; // gráfico ou macro, não planilha
    const estado = atributo(tag, "state");
    const sheet = workbook.addWorksheet(nomeAbaSeguro(nome, usados), {
      state: estado === "hidden" || estado === "veryHidden" ? estado : "visible",
    });

    let linhaAtual = 0;
    for (const linha of xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
      const r = Number(atributo(linha[1], "r"));
      linhaAtual = Number.isInteger(r) && r > 0 ? r : linhaAtual + 1;
      let colunaAtual = 0;
      for (const celula of (linha[2] ?? "").matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const attrs = celula[1];
        const ref = referencia(atributo(attrs, "r") ?? "");
        colunaAtual = ref ? ref.coluna : colunaAtual + 1;
        const interno = celula[2] ?? "";
        const tipo = atributo(attrs, "t") ?? "n";
        const v = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(interno)?.[1];
        let valor: ExcelJS.CellValue = null;
        if (tipo === "s") valor = v != null ? (compartilhados[Number(v)] ?? null) : null;
        else if (tipo === "inlineStr") valor = textoDosT(interno);
        else if (tipo === "str" || tipo === "d") valor = v != null ? decodificarXml(v) : null;
        else if (tipo === "b") valor = v === "1";
        else if (tipo === "e") valor = null;
        else if (v != null && v.trim() !== "") {
          const numero = Number(v);
          valor = Number.isFinite(numero) ? numero : decodificarXml(v);
        }
        if (valor == null || valor === "") continue;
        sheet.getRow(ref?.linha ?? linhaAtual).getCell(colunaAtual).value = valor;
      }
    }
  }
  if (workbook.worksheets.length === 0) throw new Error("Nenhuma aba de planilha no arquivo.");
  return workbook;
}
