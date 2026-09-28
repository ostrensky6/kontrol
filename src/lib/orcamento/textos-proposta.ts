import { docDeTextoPlano, normalizarTexto, textoVazio, type DocTexto } from "./texto-rico";

/**
 * Textos do documento da proposta: descrição (objeto) e seções como Prazos,
 * Responsabilidades, Condições comerciais. Na elaboração vêm dos textos
 * padrão da empresa sobrepostos pelos salvos no orçamento; na versão
 * emitida, da coluna da versão, do snapshot ou, em versões antigas, do
 * escopo preliminar com a seção de condições que o documento usava antes.
 */
export type SecaoTexto = { chave: string; titulo: string; texto: DocTexto | null };
export type TextosProposta = { descricao: DocTexto | null; secoes: SecaoTexto[] };
export type SecaoPadrao = { chave: string; titulo: string; texto: unknown; ordem: number; ativo: boolean };

export const CHAVE_SECAO_REGEX = /^[a-z0-9_]{2,40}$/;

const LIMITE_TITULO = 120;
const LIMITE_SECOES = 30;

type Objeto = Record<string, unknown>;

function ehObjeto(valor: unknown): valor is Objeto {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** Título aparado e cortado no limite; vazio vira null. */
function normalizarTitulo(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const titulo = valor.trim().slice(0, LIMITE_TITULO).trim();
  return titulo || null;
}

function chaveValida(valor: unknown): valor is string {
  return typeof valor === "string" && CHAVE_SECAO_REGEX.test(valor);
}

/**
 * Textos gravados (demanda, versão ou snapshot) no formato aceito. Seções com
 * chave inválida ou sem título são descartadas; chave repetida fica com a
 * primeira; no máximo 30 seções. Não objeto vira null. Nunca lança.
 */
export function normalizarTextosProposta(valor: unknown): TextosProposta | null {
  if (!ehObjeto(valor)) return null;
  const secoes: SecaoTexto[] = [];
  const chaves = new Set<string>();
  const brutas = Array.isArray(valor.secoes) ? valor.secoes : [];
  for (const bruta of brutas) {
    if (secoes.length >= LIMITE_SECOES) break;
    if (!ehObjeto(bruta) || !chaveValida(bruta.chave) || chaves.has(bruta.chave)) continue;
    const titulo = normalizarTitulo(bruta.titulo);
    if (!titulo) continue;
    chaves.add(bruta.chave);
    secoes.push({ chave: bruta.chave, titulo, texto: normalizarTexto(bruta.texto) });
  }
  return { descricao: normalizarTexto(valor.descricao), secoes };
}

/**
 * Textos da elaboração. Sem textos salvos, a descrição vem do escopo
 * preliminar; com textos salvos, vale a descrição salva (mesmo vazia).
 * Seções: padrões ativos na ordem (a salva com a mesma chave substitui o
 * padrão, inclusive com texto vazio) e depois as salvas sem padrão ativo.
 */
export function resolverTextosDemanda(args: {
  salvos: unknown;
  padroes: SecaoPadrao[];
  escopoLegado: string | null;
}): TextosProposta {
  const salvo = normalizarTextosProposta(args.salvos);
  const salvasPorChave = new Map((salvo?.secoes ?? []).map((secao) => [secao.chave, secao]));

  // padrão com chave ou título inválido não poderia ser salvo: fica de fora
  const ativos = args.padroes
    .filter((padrao) => padrao.ativo && chaveValida(padrao.chave) && normalizarTitulo(padrao.titulo))
    .map((padrao) => ({ padrao, ordem: Number(padrao.ordem) || 0 }))
    .sort((a, b) => a.ordem - b.ordem || (a.padrao.chave < b.padrao.chave ? -1 : a.padrao.chave > b.padrao.chave ? 1 : 0))
    .map(({ padrao }) => padrao);

  const chavesAtivas = new Set<string>();
  const secoes: SecaoTexto[] = [];
  for (const padrao of ativos) {
    if (chavesAtivas.has(padrao.chave)) continue;
    chavesAtivas.add(padrao.chave);
    const salva = salvasPorChave.get(padrao.chave);
    secoes.push(
      salva
        ? { chave: salva.chave, titulo: salva.titulo, texto: salva.texto }
        : { chave: padrao.chave, titulo: normalizarTitulo(padrao.titulo) ?? padrao.chave, texto: normalizarTexto(padrao.texto) },
    );
  }
  for (const salva of salvo?.secoes ?? []) {
    if (!chavesAtivas.has(salva.chave)) secoes.push({ chave: salva.chave, titulo: salva.titulo, texto: salva.texto });
  }

  return {
    descricao: salvo ? salvo.descricao : docDeTextoPlano(args.escopoLegado),
    secoes,
  };
}

/** Seção de condições que o documento legado imprimia fixa. */
export function secaoCondicoesLegado(validadeTexto: string): SecaoTexto {
  const linhas = [
    validadeTexto.trim(),
    "Alterações de escopo, quantidade de amostras, premissas técnicas ou cronograma podem exigir nova versão da proposta.",
  ].filter(Boolean);
  return {
    chave: "condicoes",
    titulo: "Condições comerciais",
    texto: {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: linhas.map((linha) => ({
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: linha }] }],
          })),
        },
      ],
    },
  };
}

/**
 * Textos de uma versão emitida: coluna da versão (editada depois da emissão),
 * senão os do snapshot, senão o legado (escopo + condições comerciais).
 */
export function textosDaVersao(args: {
  coluna: unknown;
  snapshot: unknown;
  escopoLegado: string | null;
  validadeTexto: string;
}): TextosProposta {
  const daColuna = normalizarTextosProposta(args.coluna);
  if (daColuna) return daColuna;
  const doSnapshot = ehObjeto(args.snapshot) ? normalizarTextosProposta(args.snapshot.textos_proposta) : null;
  if (doSnapshot) return doSnapshot;
  return {
    descricao: docDeTextoPlano(args.escopoLegado),
    secoes: [secaoCondicoesLegado(args.validadeTexto)],
  };
}

/** Seções que saem no documento: só as com texto visível. */
export function secoesImprimiveis(textos: TextosProposta): SecaoTexto[] {
  return textos.secoes.filter((secao) => !textoVazio(secao.texto));
}
