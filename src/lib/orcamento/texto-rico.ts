/**
 * Texto formatado da proposta: subconjunto restrito do JSON do
 * ProseMirror/TipTap (doc, parágrafo, subtítulo nível 3, listas, quebra de
 * linha e texto com negrito). Funções puras, usadas no servidor (validação,
 * DOCX) e no cliente (editor, render).
 */

export type MarcaTexto = { type: "bold" };
export type NoInline = { type: "text"; text: string; marks?: MarcaTexto[] } | { type: "hardBreak" };
export type NoParagrafo = { type: "paragraph"; content?: NoInline[] };
export type NoTitulo = { type: "heading"; attrs: { level: 3 }; content?: NoInline[] };
export type NoItemLista = { type: "listItem"; content: NoParagrafo[] };
export type NoLista = { type: "bulletList" | "orderedList"; content: NoItemLista[] };
export type NoBloco = NoParagrafo | NoTitulo | NoLista;
export type DocTexto = { type: "doc"; content: NoBloco[] };

export const LIMITE_TEXTO_CARACTERES = 20000;

// Protege contra JSON aninhado demais (entrada maliciosa ou cíclica).
const PROFUNDIDADE_MAXIMA = 32;

const MARCADOR_LISTA = /^[-•]\s+/;

type Objeto = Record<string, unknown>;

function ehObjeto(valor: unknown): valor is Objeto {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function filhos(no: Objeto): unknown[] {
  return Array.isArray(no.content) ? no.content : [];
}

// push sem spread: listas grandes não estouram o limite de argumentos
function anexar<T>(destino: T[], origem: T[]) {
  for (const item of origem) destino.push(item);
}

/** Remove caracteres de controle (menos \n); \r\n e \r viram \n, tab vira espaço. */
function limparCaracteres(texto: string): string {
  const normalizado = texto.replace(/\r\n?/g, "\n").replace(/\t/g, " ");
  let saida = "";
  for (const ch of normalizado) {
    const codigo = ch.charCodeAt(0);
    const controle = (codigo < 32 && codigo !== 10) || (codigo >= 127 && codigo < 160);
    if (!controle) saida += ch;
  }
  return saida;
}

function paragrafo(content: NoInline[]): NoParagrafo {
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

function titulo(content: NoInline[]): NoTitulo {
  return content.length
    ? { type: "heading", attrs: { level: 3 }, content }
    : { type: "heading", attrs: { level: 3 } };
}

/** Texto de um nó `text`: cada \n vira hardBreak; trechos vazios somem. */
function inlineDeTexto(texto: string, negrito: boolean): NoInline[] {
  const saida: NoInline[] = [];
  limparCaracteres(texto)
    .split("\n")
    .forEach((parte, i) => {
      if (i > 0) saida.push({ type: "hardBreak" });
      if (!parte) return;
      saida.push(negrito ? { type: "text", text: parte, marks: [{ type: "bold" }] } : { type: "text", text: parte });
    });
  return saida;
}

function sanearInline(nos: unknown[], profundidade: number): NoInline[] {
  const saida: NoInline[] = [];
  if (profundidade > PROFUNDIDADE_MAXIMA) return saida;
  for (const no of nos) {
    if (!ehObjeto(no)) continue;
    if (no.type === "text") {
      if (typeof no.text !== "string") continue;
      const negrito = Array.isArray(no.marks) && no.marks.some((m) => ehObjeto(m) && m.type === "bold");
      anexar(saida, inlineDeTexto(no.text, negrito));
    } else if (no.type === "hardBreak") {
      saida.push({ type: "hardBreak" });
    } else {
      // nó desconhecido: some, mas o texto de dentro fica
      anexar(saida, sanearInline(filhos(no), profundidade + 1));
    }
  }
  return saida;
}

/**
 * Itens de uma lista. Listas aninhadas são achatadas: seus itens entram na
 * mesma lista, logo depois do item que as continha.
 */
function sanearItens(nos: unknown[], profundidade: number): NoItemLista[] {
  const itens: NoItemLista[] = [];
  if (profundidade > PROFUNDIDADE_MAXIMA) return itens;
  for (const no of nos) {
    if (!ehObjeto(no)) continue;
    // filho que não é listItem vira conteúdo de um item
    const conteudo = no.type === "listItem" ? filhos(no) : [no];
    const atual: NoParagrafo[] = [];
    const fecharItem = () => {
      if (atual.length) itens.push({ type: "listItem", content: atual.splice(0) });
    };
    for (const bloco of sanearBlocos(conteudo, profundidade + 1)) {
      if (bloco.type === "paragraph") atual.push(bloco);
      else if (bloco.type === "heading") atual.push(paragrafo(bloco.content ?? []));
      else {
        fecharItem();
        anexar(itens, bloco.content);
      }
    }
    fecharItem();
  }
  return itens;
}

function sanearBlocos(nos: unknown[], profundidade: number): NoBloco[] {
  const saida: NoBloco[] = [];
  if (profundidade > PROFUNDIDADE_MAXIMA) return saida;
  // texto solto fora de parágrafo é agrupado num parágrafo
  const soltos: NoInline[] = [];
  const fecharSoltos = () => {
    if (soltos.length) saida.push(paragrafo(soltos.splice(0)));
  };
  for (const no of nos) {
    if (!ehObjeto(no)) continue;
    const tipo = no.type;
    if (tipo === "text" || tipo === "hardBreak") {
      anexar(soltos, sanearInline([no], profundidade));
      continue;
    }
    fecharSoltos();
    if (tipo === "paragraph") {
      saida.push(paragrafo(sanearInline(filhos(no), profundidade + 1)));
    } else if (tipo === "heading") {
      saida.push(titulo(sanearInline(filhos(no), profundidade + 1)));
    } else if (tipo === "bulletList" || tipo === "orderedList") {
      const itens = sanearItens(filhos(no), profundidade + 1);
      if (itens.length) saida.push({ type: tipo === "bulletList" ? "bulletList" : "orderedList", content: itens });
    } else {
      // bloco desconhecido (blockquote, codeBlock, tabela…): desembrulha
      anexar(saida, sanearBlocos(filhos(no), profundidade + 1));
    }
  }
  fecharSoltos();
  return saida;
}

/**
 * Texto formatado a partir de qualquer valor gravado: string legada vira
 * parágrafos; documento é saneado para o subconjunto aceito; o resto vira null.
 * Acima de LIMITE_TEXTO_CARACTERES também devolve null. Nunca lança.
 */
export function normalizarTexto(valor: unknown): DocTexto | null {
  try {
    let doc: DocTexto | null;
    if (typeof valor === "string") doc = docDeTextoPlano(valor);
    else if (ehObjeto(valor) && valor.type === "doc") doc = { type: "doc", content: sanearBlocos(filhos(valor), 0) };
    else return null;
    if (doc && textoParaPlano(doc).length > LIMITE_TEXTO_CARACTERES) return null;
    return doc;
  } catch {
    return null;
  }
}

/**
 * Texto simples → documento. Linha em branco separa parágrafos; \n vira
 * quebra de linha; bloco em que todas as linhas começam com "- " ou "• " vira
 * lista com marcadores.
 */
export function docDeTextoPlano(texto: string | null | undefined): DocTexto | null {
  if (typeof texto !== "string") return null;
  const limpo = limparCaracteres(texto).trim();
  if (!limpo) return null;
  const content = limpo.split(/\n\s*\n/).map((bloco): NoBloco => {
    const linhas = bloco.split("\n").map((linha) => linha.trim());
    if (linhas.every((linha) => MARCADOR_LISTA.test(linha))) {
      return {
        type: "bulletList",
        content: linhas.map((linha) => ({
          type: "listItem",
          content: [paragrafo([{ type: "text", text: linha.replace(MARCADOR_LISTA, "") }])],
        })),
      };
    }
    const inline: NoInline[] = [];
    linhas.forEach((linha, i) => {
      if (i > 0) inline.push({ type: "hardBreak" });
      if (linha) inline.push({ type: "text", text: linha });
    });
    return paragrafo(inline);
  });
  return { type: "doc", content };
}

function ehLista(bloco: NoBloco): bloco is NoLista {
  return bloco.type === "bulletList" || bloco.type === "orderedList";
}

function temTexto(content: NoInline[] | undefined): boolean {
  return (content ?? []).some((no) => no.type === "text" && /\S/.test(no.text));
}

/** Sem documento ou sem nenhum caractere visível. */
export function textoVazio(doc: DocTexto | null | undefined): boolean {
  if (!doc) return true;
  return !doc.content.some((bloco) =>
    ehLista(bloco)
      ? bloco.content.some((item) => item.content.some((p) => temTexto(p.content)))
      : temTexto(bloco.content),
  );
}

function inlineParaPlano(content: NoInline[] | undefined): string {
  return (content ?? []).map((no) => (no.type === "text" ? no.text : "\n")).join("");
}

/** Versão em texto simples: blocos por \n, listas com "• " ou "1. ". */
export function textoParaPlano(doc: DocTexto | null | undefined): string {
  if (!doc) return "";
  const linhas: string[] = [];
  for (const bloco of doc.content) {
    if (ehLista(bloco)) {
      bloco.content.forEach((item, i) => {
        const prefixo = bloco.type === "bulletList" ? "• " : `${i + 1}. `;
        linhas.push(prefixo + item.content.map((p) => inlineParaPlano(p.content)).join("\n"));
      });
    } else {
      linhas.push(inlineParaPlano(bloco.content));
    }
  }
  return linhas.join("\n");
}
