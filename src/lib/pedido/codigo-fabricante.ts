/**
 * Código do fabricante (número de catálogo / part number): identifica o produto
 * sem ambiguidade. Dois produtos com o mesmo nome podem diferir em tamanho, cor
 * ou embalagem; com o mesmo código, são o mesmo produto.
 */

/** Código sem espaços, hífens, pontos e barras, em minúsculas: "K9-100" = "k9 100". */
export function normalizarCodigoFabricante(valor: unknown): string {
  if (valor == null || typeof valor === "object") return "";
  return String(valor).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\s\-./_]/g, "").toLowerCase();
}

/** Texto curto para listas e itens: "cód. K9-100", ou vazio quando não há código. */
export function rotuloCodigoFabricante(codigo: string | null | undefined): string {
  const valor = String(codigo ?? "").trim();
  return valor ? `cód. ${valor}` : "";
}

/**
 * Acha o insumo cujo código do fabricante é exatamente o digitado (ignorando
 * espaços, hífens e maiúsculas). Se dois insumos tiverem o mesmo código, não
 * escolhe nenhum: quem pede decide na lista.
 */
export function acharPorCodigoFabricante<T extends { codigoFabricante?: string | null }>(
  catalogo: T[],
  digitado: string,
): T | null {
  const alvo = normalizarCodigoFabricante(digitado);
  if (alvo.length < 3) return null;
  const achados = catalogo.filter((item) => normalizarCodigoFabricante(item.codigoFabricante) === alvo);
  return achados.length === 1 ? achados[0] : null;
}

/** Marca e código juntos para o campo "Marca/modelo" do item: "Kasvi · cód. K9-100". */
export function marcaComCodigo(fabricante: string | null | undefined, codigo: string | null | undefined): string {
  return [String(fabricante ?? "").trim(), rotuloCodigoFabricante(codigo)].filter(Boolean).join(" · ");
}
