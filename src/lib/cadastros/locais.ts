/**
 * Hierarquia dos locais (prédio → sala → freezer → gaveta…). Funções puras.
 */
export type LocalHierarquia = { id: number; parent_id: number | null };

/**
 * Colocar `localId` dentro de `novoPaiId` criaria um ciclo? Sobe a partir do
 * novo pai; se encontrar o próprio local, sim. Um laço já existente nos dados
 * também é tratado como ciclo (falha fechada).
 */
export function criariaCicloLocal(
  locais: LocalHierarquia[],
  localId: number,
  novoPaiId: number | null,
): boolean {
  if (novoPaiId == null) return false;
  const paiDe = new Map(locais.map((local) => [Number(local.id), local.parent_id == null ? null : Number(local.parent_id)]));
  const vistos = new Set<number>();
  let atual: number | null = Number(novoPaiId);
  while (atual != null) {
    if (atual === localId) return true;
    if (vistos.has(atual)) return true;
    vistos.add(atual);
    atual = paiDe.get(atual) ?? null;
  }
  return false;
}

/** Nome do local pai para a coluna "Dentro de". */
export function nomesDosPais(
  locais: Record<string, unknown>[],
): Map<string, string> {
  const nomePorId = new Map(locais.map((local) => [String(local.id), String(local.nome ?? "")]));
  const resultado = new Map<string, string>();
  for (const local of locais) {
    if (local.parent_id == null || local.parent_id === "") continue;
    resultado.set(String(local.id), nomePorId.get(String(local.parent_id)) ?? "—");
  }
  return resultado;
}
