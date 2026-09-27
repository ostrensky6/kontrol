/**
 * Motivo obrigatório nos diálogos de confirmação (ConfirmActionButton e
 * ConfirmSubmitButton). Lógica pura, testada sem DOM.
 */
export type MotivoConfirmacao = {
  /** nome do campo enviado com o formulário (ex.: "motivo") */
  name: string;
  /** rótulo visível do campo (ex.: "Por que está cancelando?") */
  label: string;
  /** mínimo de caracteres, sem contar espaços nas pontas (padrão 3) */
  minLength?: number;
};

export const MOTIVO_MIN_PADRAO = 3;

/** Texto que vai para o servidor: sem espaços nas pontas. */
export function normalizarMotivo(texto: unknown): string {
  return typeof texto === "string" ? texto.trim() : "";
}

/** Mensagem de erro do motivo, ou null quando está válido. */
export function erroMotivo(texto: unknown, minLength: number = MOTIVO_MIN_PADRAO): string | null {
  const minimo = Math.max(1, Math.floor(minLength));
  const valor = normalizarMotivo(texto);
  if (!valor) return "Informe o motivo.";
  if (valor.length < minimo) return `Escreva ao menos ${minimo} caracteres.`;
  return null;
}
