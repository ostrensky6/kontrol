/**
 * Endereço da ficha do insumo (F5). Fica num arquivo só seu para as telas do
 * navegador poderem montar o link sem carregar a montagem da ficha.
 */

/** Endereço da ficha; null quando a linha não tem insumo cadastrado. */
export function hrefFichaInsumo(insumoId: number | string | null | undefined): string | null {
  if (insumoId === null || insumoId === undefined || insumoId === "") return null;
  const id = Number(insumoId);
  return Number.isSafeInteger(id) && id > 0 ? `/estoque/insumos/${id}` : null;
}

/** Id da rota: só inteiro positivo, escrito só com dígitos. */
export function idDaFicha(valor: string): number | null {
  if (!/^\d{1,15}$/.test(valor)) return null;
  const id = Number(valor);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
