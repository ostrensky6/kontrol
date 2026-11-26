/**
 * Número com o nome no singular ou no plural: "1 registro", "3 registros".
 * No lugar do "registro(s)" entre parênteses, que deixa a frase com cara de
 * formulário (rodada 11).
 */
export function quantos(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
