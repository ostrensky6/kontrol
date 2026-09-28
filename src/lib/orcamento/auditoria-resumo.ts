/**
 * Resumo legível das linhas da tabela `auditoria` (valor_anterior → valor_novo)
 * para a tela de regras e governança de Orçamentos.
 *
 * Campos jsonb (objetos e listas) são comparados por dentro — o resumo mostra
 * o subcampo que mudou (`completude_snapshot.faltante: 40 → 20`) em vez de
 * "[object Object] → [object Object]".
 */

import { APP_LOCALE, APP_TIME_ZONE } from "@/lib/formatters";

export type LinhaAuditoriaResumo = {
  id: number;
  tabela: string;
  registro_id: string | null;
  acao: string;
  usuario: string | null;
  valor_anterior: Record<string, unknown> | null;
  valor_novo: Record<string, unknown> | null;
  criado_em: string;
};

export type MudancaCampo = { campo: string; de: unknown; para: unknown };

/** Até onde descer em objetos aninhados antes de tratar o valor como um todo. */
const PROFUNDIDADE_MAXIMA = 2;
const LIMITE_TEXTO = 32;

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function truncar(texto: string, limite = LIMITE_TEXTO) {
  return texto.length > limite ? `${texto.slice(0, limite)}…` : texto;
}

/** JSON com as chaves ordenadas: o jsonb não garante a ordem das chaves. */
function normalizado(valor: unknown): string {
  const ordenar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(ordenar);
    if (ehObjeto(v)) {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((chave) => [chave, ordenar(v[chave])]),
      );
    }
    return v;
  };
  return JSON.stringify(ordenar(valor)) ?? "undefined";
}

const dataHoraComSegundos = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Carimbos ISO do banco viram data e hora locais (com segundos: autosaves mudam no mesmo minuto). */
function dataLegivel(texto: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    const [ano, mes, dia] = texto.split("-");
    return `${dia}/${mes}/${ano}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(texto)) return null;
  const data = new Date(texto);
  return Number.isNaN(data.getTime()) ? null : dataHoraComSegundos.format(data);
}

function primitivo(valor: unknown): string {
  if (valor == null || valor === "") return "-";
  if (typeof valor === "boolean") return valor ? "sim" : "não";
  if (typeof valor === "string") return dataLegivel(valor) ?? valor;
  return String(valor);
}

function ehPrimitivo(valor: unknown) {
  return valor == null || ["string", "number", "boolean"].includes(typeof valor);
}

/** Valor curto e legível: textos truncados, listas e objetos resumidos. */
export function formatarValorAuditoria(valor: unknown, limite = LIMITE_TEXTO): string {
  if (Array.isArray(valor)) {
    if (valor.length === 0) return "lista vazia";
    const quantidade = valor.length === 1 ? "1 item" : `${valor.length} itens`;
    if (!valor.every(ehPrimitivo)) return quantidade;
    const texto = `[${valor.map(primitivo).join(", ")}]`;
    return texto.length > limite ? quantidade : texto;
  }
  if (ehObjeto(valor)) {
    const chaves = Object.keys(valor);
    if (chaves.length === 0) return "vazio";
    const quantidade = chaves.length === 1 ? "1 campo" : `${chaves.length} campos`;
    if (!chaves.every((chave) => ehPrimitivo(valor[chave]))) return `{${quantidade}}`;
    const texto = `{${chaves.map((chave) => `${chave}: ${primitivo(valor[chave])}`).join(", ")}}`;
    return texto.length > limite ? `{${quantidade}}` : texto;
  }
  return truncar(primitivo(valor), limite);
}

/**
 * Campos alterados entre duas versões do registro. Objetos dos dois lados são
 * comparados por dentro (até PROFUNDIDADE_MAXIMA); diferença só na ordem das
 * chaves não conta como mudança.
 */
export function camposAlterados(
  anterior: Record<string, unknown>,
  novo: Record<string, unknown>,
  ignorar: ReadonlySet<string> = new Set(),
  prefixo = "",
  profundidade = 0,
): MudancaCampo[] {
  const chaves = [...new Set([...Object.keys(novo), ...Object.keys(anterior)])];
  const mudancas: MudancaCampo[] = [];
  for (const chave of chaves) {
    if (ignorar.has(chave)) continue;
    const de = anterior[chave];
    const para = novo[chave];
    if (normalizado(de) === normalizado(para)) continue;
    const campo = prefixo ? `${prefixo}.${chave}` : chave;
    if (ehObjeto(de) && ehObjeto(para) && profundidade < PROFUNDIDADE_MAXIMA) {
      mudancas.push(...camposAlterados(de, para, ignorar, campo, profundidade + 1));
      continue;
    }
    mudancas.push({ campo, de, para });
  }
  return mudancas;
}

/** Frase curta do que mudou: até `maximo` campos e a contagem do restante. */
export function resumoDiffAuditoria(
  acao: string,
  anterior: Record<string, unknown> | null,
  novo: Record<string, unknown> | null,
  { ignorar = new Set<string>(), maximo = 3 }: { ignorar?: ReadonlySet<string>; maximo?: number } = {},
): string {
  if (acao === "insert") return "Registro criado.";
  if (acao === "delete") return "Registro removido.";
  if (!anterior || !novo) return "Alteração sem diff disponível.";
  const mudancas = camposAlterados(anterior, novo, ignorar);
  if (mudancas.length === 0) return "Sem mudança relevante.";
  const partes = mudancas
    .slice(0, maximo)
    .map(({ campo, de, para }) => `${campo}: ${formatarValorAuditoria(de)} → ${formatarValorAuditoria(para)}`);
  const resto = mudancas.length - maximo;
  if (resto > 0) partes.push(resto === 1 ? "+1 campo" : `+${resto} campos`);
  return partes.join(" · ");
}

export type GrupoAuditoria<T extends LinhaAuditoriaResumo> = {
  /** Linhas do grupo, na ordem recebida (mais recente primeiro). */
  itens: T[];
  maisRecente: T;
  maisAntiga: T;
  /** Mudança líquida: do valor anterior da mais antiga ao novo da mais recente. */
  resumo: string;
};

/**
 * Junta alterações seguidas do mesmo registro, pelo mesmo usuário e nos mesmos
 * campos (ex.: um autosave que grava seis vezes no mesmo minuto) numa só linha.
 * Criações e remoções nunca são agrupadas. A lista deve vir do mais recente
 * para o mais antigo, como a tela lê a auditoria.
 */
export function agruparAlteracoesSeguidas<T extends LinhaAuditoriaResumo>(
  linhas: T[],
  ignorar: ReadonlySet<string> = new Set(),
): GrupoAuditoria<T>[] {
  const assinatura = (linha: T) => {
    if (linha.acao !== "update" || !linha.valor_anterior || !linha.valor_novo) return null;
    const campos = camposAlterados(linha.valor_anterior, linha.valor_novo, ignorar)
      .map((mudanca) => mudanca.campo)
      .sort()
      .join(",");
    return [linha.tabela, linha.registro_id ?? "", linha.usuario ?? "", campos].join("|");
  };

  const grupos: Array<{ chave: string | null; itens: T[] }> = [];
  for (const linha of linhas) {
    const chave = assinatura(linha);
    const atual = grupos.at(-1);
    if (chave !== null && atual && atual.chave === chave) {
      atual.itens.push(linha);
    } else {
      grupos.push({ chave, itens: [linha] });
    }
  }

  return grupos.map(({ itens }) => {
    const maisRecente = itens[0];
    const maisAntiga = itens[itens.length - 1];
    return {
      itens,
      maisRecente,
      maisAntiga,
      resumo: resumoDiffAuditoria(maisRecente.acao, maisAntiga.valor_anterior, maisRecente.valor_novo, { ignorar }),
    };
  });
}
