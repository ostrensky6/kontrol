export const APP_LOCALE = "pt-BR";
export const APP_TIME_ZONE = "America/Sao_Paulo";
export const APP_CURRENCY = "BRL";

export const numberFormatter = new Intl.NumberFormat(APP_LOCALE, {
  maximumFractionDigits: 2,
});

export const integerFormatter = new Intl.NumberFormat(APP_LOCALE, {
  maximumFractionDigits: 0,
});

export const percentFormatter = new Intl.NumberFormat(APP_LOCALE, {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});

export const currencyFormatter = new Intl.NumberFormat(APP_LOCALE, {
  style: "currency",
  currency: APP_CURRENCY,
});

export const compactCurrencyFormatter = new Intl.NumberFormat(APP_LOCALE, {
  style: "currency",
  currency: APP_CURRENCY,
  maximumFractionDigits: 0,
});

export const dateFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export const dateTimeFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  dateStyle: "short",
  timeStyle: "short",
});

export function formatNumber(value: number | null | undefined) {
  return numberFormatter.format(value ?? 0);
}

export function formatInteger(value: number | null | undefined) {
  return integerFormatter.format(value ?? 0);
}

/** Percentual pt-BR; `casas` = máximo de casas decimais (padrão 1; parâmetros econômicos usam 2). */
export function formatPercent(value: number | null | undefined, casas = 1) {
  const formatter =
    casas === 1
      ? percentFormatter
      : new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: casas, minimumFractionDigits: 0 });
  return `${formatter.format(value ?? 0)}%`;
}

export function formatCurrency(value: number | null | undefined) {
  return currencyFormatter.format(value ?? 0);
}

export function formatCompactCurrency(value: number | null | undefined) {
  return compactCurrencyFormatter.format(value ?? 0);
}

const dateOnlyFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  // "2026-10-25" é uma data de calendário (validade, emissão): o Date a lê
  // como meia-noite UTC e, no fuso de São Paulo, ela viraria 24/10.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? "—" : dateOnlyFormatter.format(date);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateFormatter.format(date);
}

/**
 * Período de calendário para listas: "22/06 a 30/06/2026" (mesmo ano),
 * "22/12/2026 a 05/01/2027" (anos diferentes) ou só a data que existir.
 * Nunca mostra a data no formato técnico do banco (2026-06-22).
 */
export function formatPeriodo(
  inicio: string | Date | null | undefined,
  fim: string | Date | null | undefined,
) {
  if (!inicio && !fim) return "—";
  if (!inicio || !fim) return formatDate(inicio ?? fim);
  const de = formatDate(inicio);
  const ate = formatDate(fim);
  if (de === "—" || ate === "—") return de === "—" ? ate : de;
  if (de === ate) return de;
  const mesmoAno = de.slice(-4) === ate.slice(-4);
  return `${mesmoAno ? de.slice(0, 5) : de} a ${ate}`;
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeFormatter.format(date);
}

const diaLocalFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Data de hoje (aaaa-mm-dd) no fuso do laboratório. Nunca derive "hoje" de
 * `toISOString()`: depois das 21h de Brasília o UTC já está no dia seguinte, e
 * o prazo, o atraso ou a validade sairiam com um dia de erro.
 */
export function hojeIso(agora: Date = new Date()): string {
  return diaLocalFormatter.format(agora);
}

/** Data (aaaa-mm-dd) daqui a `dias` dias corridos, contados no calendário do laboratório. */
export function dataIsoEmDias(dias: number, agora: Date = new Date()): string {
  const [ano, mes, dia] = hojeIso(agora).split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + Math.round(dias))).toISOString().slice(0, 10);
}

const relogioLocalFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Quanto o relógio do laboratório está à frente do UTC naquele instante, em ms (negativo no Brasil). */
function deslocamentoDoFuso(instante: number): number {
  const partes = Object.fromEntries(
    relogioLocalFormatter.formatToParts(new Date(instante)).map((parte) => [parte.type, Number(parte.value)]),
  );
  return Date.UTC(partes.year, partes.month - 1, partes.day, partes.hour, partes.minute, partes.second) - instante;
}

function partesDoDia(dia: string): [number, number, number] | null {
  const lido = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!lido) return null;
  const [ano, mes, diaDoMes] = [Number(lido[1]), Number(lido[2]), Number(lido[3])];
  const conferida = new Date(Date.UTC(ano, mes - 1, diaDoMes));
  // 2026-02-31 não existe: o calendário "corrige" para março e a conta sairia de outro dia
  if (conferida.getUTCMonth() !== mes - 1 || conferida.getUTCDate() !== diaDoMes) return null;
  return [ano, mes, diaDoMes];
}

/**
 * Instante (ISO, em UTC) em que o dia `aaaa-mm-dd` começa no fuso do
 * laboratório, para filtrar por dia uma coluna de data e hora: o dia 16 em
 * Brasília vai das 03h UTC do dia 16 às 03h UTC do dia 17. Data inválida
 * devolve null.
 */
export function inicioDoDiaIso(dia: string): string | null {
  const partes = partesDoDia(dia);
  if (!partes) return null;
  const meiaNoiteUtc = Date.UTC(partes[0], partes[1] - 1, partes[2]);
  // a segunda passada acerta o dia em que o fuso muda de deslocamento
  const primeira = meiaNoiteUtc - deslocamentoDoFuso(meiaNoiteUtc);
  return new Date(meiaNoiteUtc - deslocamentoDoFuso(primeira)).toISOString();
}

/** Instante em que o dia seguinte a `aaaa-mm-dd` começa: o limite de cima (exclusivo) do dia. */
export function fimDoDiaIso(dia: string): string | null {
  const partes = partesDoDia(dia);
  if (!partes) return null;
  const seguinte = new Date(Date.UTC(partes[0], partes[1] - 1, partes[2] + 1));
  const [ano, mes, diaDoMes] = [seguinte.getUTCFullYear(), seguinte.getUTCMonth() + 1, seguinte.getUTCDate()];
  return inicioDoDiaIso(`${ano}-${String(mes).padStart(2, "0")}-${String(diaDoMes).padStart(2, "0")}`);
}
