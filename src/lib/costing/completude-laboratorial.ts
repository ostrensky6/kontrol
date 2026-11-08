import type { Breakdown, ProvenienciaDimensional } from "./engine";

const finito = (valor: number | null): valor is number =>
  typeof valor === "number" && Number.isFinite(valor);

const coerente = (valor: number, esperado: number) =>
  Number.isFinite(esperado) &&
  Math.abs(valor - esperado) <= 1e-9 * Math.max(1, Math.abs(valor), Math.abs(esperado));

function linhaComBase(p: ProvenienciaDimensional) {
  const { insumo_id, fator_conversao: fator, custo_unitario_estoque: estoque,
    custo_unitario_consumo: consumo, quantidade_consumo: qtd, quantidade_estoque: qtdEstoque } = p;
  return insumo_id != null && Number.isInteger(insumo_id) && insumo_id > 0
    && [p.unidade_estoque, p.unidade_consumo, p.fonte_custo, p.referencia_custo]
      .every((texto) => typeof texto === "string" && texto.trim().length > 0)
    && finito(fator) && fator > 0
    && finito(estoque) && estoque >= 0
    && finito(consumo) && consumo >= 0
    && finito(qtd) && qtd > 0
    && finito(qtdEstoque) && qtdEstoque > 0
    && coerente(consumo, estoque / fator)
    && coerente(qtdEstoque, qtd / fator);
}

/** Para custo novo: usa somente as linhas selecionadas pelo motor.
 * Coerência aritmética não comprova a procedência do fator (inclusive 1).
 */
export function custeioLaboratorialCompleto(b: Breakdown | null | undefined): b is Breakdown {
  const linhas = b?.provenienciaDimensional;
  return Array.isArray(linhas)
    && (linhas.length > 0 || b?.reagentes === 0)
    && linhas.every(linhaComBase);
}
