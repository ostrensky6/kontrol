/**
 * Foco ao abrir diálogo ou gaveta: vai para o primeiro campo de preenchimento,
 * não para o primeiro botão (que costuma ser um "?" de ajuda ao lado do rótulo).
 * Sem campo editável, vale o padrão do Radix (primeiro elemento focável).
 * Em tela de toque não foca campo nenhum: o teclado abriria por cima do diálogo.
 */
export const SELETOR_PRIMEIRO_CAMPO = [
  'input:not([type="hidden"]):not([type="file"]):not([disabled]):not([readonly])',
  "select:not([disabled])",
  "textarea:not([disabled]):not([readonly])",
].join(", ");

export function focarPrimeiroCampo(evento: Event) {
  if (evento.defaultPrevented) return;
  if (typeof window === "undefined" || !window.matchMedia?.("(pointer: fine)").matches) return;
  const conteudo = (evento.currentTarget ?? evento.target) as HTMLElement | null;
  const campo = conteudo?.querySelector?.<HTMLElement>(SELETOR_PRIMEIRO_CAMPO);
  if (!campo) return;
  evento.preventDefault();
  campo.focus();
}
