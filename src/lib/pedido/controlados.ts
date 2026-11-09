/**
 * D9 (0174): produtos controlados (clorofórmio, acetona...). A ATGC não tem
 * licença: a compra só sai pela FUNPAR, em projeto com recurso na fundação.
 * Mesma regra do banco (kontrol_private.itens_controlados_pedido): insumo
 * marcado como controlado ou, sem insumo ligado, o nome na especificação.
 */
export const NOME_CONTROLADO = /(^|[^\p{L}])(clorof[oó]rmio|chloroform|acetona|acetone)(?![\p{L}])/iu;

type ItemComInsumo = {
  especificacao: string | null;
  insumo_id?: number | null;
  insumos?: { especificacao?: string | null; controlado?: boolean | null } | null;
};

export function itensControlados(itens: ItemComInsumo[]): string[] {
  const nomes = new Set<string>();
  for (const item of itens) {
    const marcado = Boolean(item.insumos?.controlado);
    const pelaEspecificacao = !item.insumo_id && NOME_CONTROLADO.test(item.especificacao ?? "");
    if (marcado || pelaEspecificacao) {
      nomes.add((item.insumos?.especificacao ?? item.especificacao ?? "item").trim());
    }
  }
  return [...nomes];
}

export function avisoControlados(nomes: string[]): string | null {
  if (nomes.length === 0) return null;
  return `Produto controlado (${nomes.join(", ")}): a ATGC não tem licença, a compra só sai pela FUNPAR, em projeto com recurso na fundação. A fonte do recurso tem que ser a FUNPAR e a compra é encaminhada à FUNPAR (sem compra direta).`;
}

export function ehFunpar(texto: string | null | undefined) {
  return /funpar/i.test(texto ?? "");
}
