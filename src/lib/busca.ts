/**
 * Busca de texto única do app: sem acento e sem diferença de maiúsculas, para
 * "Ácido" achar "acido" e "TUBO" achar "tubo" em qualquer lista (painel de
 * insumos, tabelas genéricas, cadastros e seletor de análises).
 */
export function normalizarBusca(valor: unknown): string {
  if (valor == null || typeof valor === "object") return "";
  return String(valor).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** `alvo` contém `termo`, ignorando acentos e maiúsculas. Termo vazio casa com tudo. */
export function contemBusca(alvo: unknown, termo: unknown): boolean {
  const agulha = normalizarBusca(termo);
  if (!agulha) return true;
  return normalizarBusca(alvo).includes(agulha);
}
