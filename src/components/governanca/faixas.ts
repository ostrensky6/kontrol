/**
 * Faixas alternadas por módulo (azul-claro e branco), para ver onde cada
 * módulo de privilégios começa e termina. Usada em Privilégios e no ajuste
 * individual de Usuários.
 */
export function faixaDoModulo(indice: number) {
  return indice % 2 === 0 ? "bg-brand-50/70 dark:bg-white/[0.04]" : "bg-card";
}
