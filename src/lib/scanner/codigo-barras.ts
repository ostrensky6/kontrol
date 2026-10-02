/**
 * Código de barras do fabricante (EAN/UPC/GTIN, Code 128, GS1 DataMatrix).
 *
 * O mesmo produto pode chegar com o código em formas diferentes: o leitor
 * USB digita só os números, a câmera devolve o texto GS1 completo com lote e
 * validade ("01 07891234567895 17 270131 10 L123"), e o GTIN-14 tem um zero a
 * mais que o EAN-13 impresso. Aqui tudo isso vira uma chave estável para
 * vincular o código ao insumo, e a validade do GS1 (quando vier) é
 * aproveitada para preencher a entrada.
 */
import { normalizarCodigo } from "@/lib/scanner/identificadores";

const GS = "\u001d";

/** AIs GS1 de tamanho fixo que interessam (dados de produto e datas). */
const AI_FIXOS: Record<string, number> = {
  "00": 18,
  "01": 14,
  "02": 14,
  "11": 6,
  "12": 6,
  "13": 6,
  "15": 6,
  "16": 6,
  "17": 6,
};
/** AIs de tamanho variável terminados por FNC1 (GS) ou pelo fim do texto. */
const AI_VARIAVEIS = new Set(["10", "21", "22", "240", "241", "90", "91", "92", "93", "94", "95", "96", "97", "98", "99"]);

export type Gs1 = {
  gtin: string | null;
  validade: string | null;
  lote: string | null;
};

function dataGs1(aammdd: string): string | null {
  if (!/^\d{6}$/.test(aammdd)) return null;
  const ano = 2000 + Number(aammdd.slice(0, 2));
  const mes = Number(aammdd.slice(2, 4));
  let dia = Number(aammdd.slice(4, 6));
  if (mes < 1 || mes > 12) return null;
  // GS1: dia 00 = último dia do mês
  if (dia === 0) dia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCMonth() !== mes - 1) return null;
  return data.toISOString().slice(0, 10);
}

/**
 * Lê um texto GS1 (com parênteses "(01)…(17)…" ou cru, com FNC1/GS entre
 * campos variáveis). Devolve null quando o texto não parece GS1.
 */
export function lerGs1(bruto: string): Gs1 | null {
  let texto = bruto.trim().replace(/^\](?:C1|d2|Q3|e0)/, "");
  if (!texto) return null;

  const campos = new Map<string, string>();
  if (texto.startsWith("(")) {
    const re = /\((\d{2,4})\)([^(]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto))) campos.set(m[1], m[2].replace(new RegExp(GS, "g"), "").trim());
    if (campos.size === 0) return null;
  } else {
    texto = texto.replace(/^\u001d+/, "");
    // Sem parênteses só tratamos como GS1 quando começa por (01)+14 dígitos e
    // tem mais coisa depois: um EAN-13 ou GTIN-14 sozinho é só o código.
    if (!/^01\d{14}[\s\S]/.test(texto)) return null;
    let i = 0;
    while (i < texto.length) {
      if (texto[i] === GS) {
        i += 1;
        continue;
      }
      const ai2 = texto.slice(i, i + 2);
      const ai3 = texto.slice(i, i + 3);
      if (AI_FIXOS[ai2] != null) {
        const tamanho = AI_FIXOS[ai2];
        campos.set(ai2, texto.slice(i + 2, i + 2 + tamanho));
        i += 2 + tamanho;
        continue;
      }
      const ai = AI_VARIAVEIS.has(ai3) ? ai3 : AI_VARIAVEIS.has(ai2) ? ai2 : null;
      if (!ai) break;
      const inicio = i + ai.length;
      const fim = texto.indexOf(GS, inicio);
      campos.set(ai, texto.slice(inicio, fim === -1 ? undefined : fim));
      i = fim === -1 ? texto.length : fim + 1;
    }
  }

  const gtin = campos.get("01") ?? campos.get("02") ?? null;
  if (!gtin || !/^\d{14}$/.test(gtin)) return null;
  return {
    gtin,
    validade: dataGs1(campos.get("17") ?? ""),
    lote: campos.get("10")?.trim() || null,
  };
}

/**
 * Chave do código para vincular ao insumo: o GTIN quando o texto é GS1 (lote e
 * validade mudam a cada compra e não identificam o produto), senão o próprio
 * código normalizado.
 */
export function chaveCodigoBarras(bruto: string): string {
  const gs1 = lerGs1(bruto);
  const codigo = normalizarCodigo(gs1?.gtin ?? bruto);
  // GTIN-14 com zero à esquerda é o EAN-13 impresso na embalagem
  return /^0\d{13}$/.test(codigo) ? codigo.slice(1) : codigo;
}

/**
 * Formas equivalentes do mesmo código numérico para a busca: EAN-13 impresso
 * "7891234567895" e GTIN-14 "07891234567895" são o mesmo produto.
 */
export function variantesCodigoBarras(bruto: string): string[] {
  const chave = chaveCodigoBarras(bruto);
  const variantes = new Set([chave, normalizarCodigo(bruto)]);
  if (/^\d{8,14}$/.test(chave)) {
    const semZeros = chave.replace(/^0+/, "");
    for (const tamanho of [8, 12, 13, 14]) {
      if (semZeros.length <= tamanho) variantes.add(semZeros.padStart(tamanho, "0"));
    }
  }
  return [...variantes].filter(Boolean);
}

/** Lista digitada ou da planilha ("789…; 789…" ou uma por linha) sem repetidos. */
export function separarCodigosBarras(texto: unknown): string[] {
  const vistos = new Set<string>();
  const codigos: string[] = [];
  for (const parte of String(texto ?? "").split(/[;,\n\r|]+/)) {
    const codigo = parte.trim();
    if (!codigo) continue;
    const chave = chaveCodigoBarras(codigo);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    codigos.push(chave);
  }
  return codigos;
}

export const CODIGO_BARRAS_MAX = 120;

export function codigoBarrasValido(codigo: string) {
  const chave = chaveCodigoBarras(codigo);
  return chave.length > 0 && chave.length <= CODIGO_BARRAS_MAX;
}
