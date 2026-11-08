/** Insumos gravados sem preço no custo congelado de um item de orçamento. */
export function insumosSemCustoDoSnapshot(snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const lista = (snapshot as Record<string, unknown>).insumos_sem_custo;
  return Array.isArray(lista) ? lista.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}

/** Junta os insumos sem preço de todos os itens, sem repetir. */
export function insumosSemCustoDosItens(itens: { valor_snapshot?: unknown }[]): string[] {
  return [...new Set(itens.flatMap((item) => insumosSemCustoDoSnapshot(item.valor_snapshot)))];
}
