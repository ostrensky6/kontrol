import type { Coluna } from "@/lib/cadastros/config";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "@/lib/formatters";
import { VALOR_MASCARADO, estaMascarado } from "@/lib/cadastros/mascara";

export type Registro = Record<string, unknown>;

export function fmt(value: unknown, tipo?: Coluna["tipo"]) {
  if (value == null || value === "") return "—";
  // valor sigiloso já mascarado no servidor (ex.: salário sem permissão)
  if (estaMascarado(value)) return VALOR_MASCARADO;
  // texto no lugar de número (ex.: "Sem custo") aparece como veio
  if (
    typeof value === "string" &&
    (tipo === "currency" || tipo === "number" || tipo === "percent") &&
    Number.isNaN(Number(value))
  ) {
    return value;
  }
  switch (tipo) {
    case "currency":
      return formatCurrency(Number(value));
    case "percent":
      return formatPercent(Number(value));
    case "number":
      return formatNumber(Number(value));
    case "date":
      return formatDate(String(value));
    case "checkbox":
      return value ? "Sim" : "Não";
    default:
      return String(value);
  }
}
