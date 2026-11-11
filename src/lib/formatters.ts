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
