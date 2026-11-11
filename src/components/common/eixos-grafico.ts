/**
 * Eixos de todo gráfico XY do app (pedido de Antonio em 11/11/2026: gráfico
 * sem a linha dos eixos X e Y é erro). Cada eixo tem linha, marcas e título.
 * O teste `eixos-grafico.test.ts` acusa o gráfico que desligar a linha.
 */

/** Linha do eixo: a mesma cor do texto, para aparecer no claro e no escuro. */
export const LINHA_EIXO = { stroke: "var(--foreground)", strokeWidth: 1.25 } as const;

/** Marca de cada valor no eixo. */
export const MARCA_EIXO = { stroke: "var(--muted-foreground)" } as const;

const ESTILO_TITULO = { textAnchor: "middle", fontSize: 12, fill: "var(--muted-foreground)" } as const;

/** Título do eixo X, abaixo das marcas. Peça `margin.bottom` de pelo menos 22. */
export function tituloEixoX(texto: string) {
  return { value: texto, position: "insideBottom" as const, offset: -12, style: ESTILO_TITULO };
}

/** Título do eixo Y, de baixo para cima, à esquerda das marcas. */
export function tituloEixoY(texto: string) {
  return { value: texto, angle: -90, position: "insideLeft" as const, offset: 4, style: ESTILO_TITULO };
}
