/**
 * Itens incluídos no próprio formulário "Novo pedido" (relatório de ajustes de
 * Compras de 17/11/2026, ajuste 4). O formulário guarda a lista na tela e a
 * envia junto com o pedido; estas regras valem igual na tela e no servidor.
 */

/** Nomes dos campos de um item, os mesmos do formulário de item do pedido. */
export const CAMPOS_ITEM_NOVO_PEDIDO = [
  "tipo",
  "insumo_id",
  "especificacao",
  "quantidade",
  "unidade",
  "modelo",
  "volume",
  "fornecedor_sugerido",
  "orcamento_previo",
  "observacao",
  "caracteristicas",
  "exigencia_tecnica",
  "exclusividade",
  "outros_fornecedores",
] as const;

export type CampoItemNovoPedido = (typeof CAMPOS_ITEM_NOVO_PEDIDO)[number];

/** Item como o banco recebe (pedidos_internos_itens), sem o pedido. */
export type ItemNovoPedido = {
  tipo: "material" | "servico" | "equipamento";
  insumo_id: number | null;
  especificacao: string | null;
  quantidade: number | null;
  unidade: string | null;
  modelo: string | null;
  volume: string | null;
  fornecedor_sugerido: string | null;
  orcamento_previo: number | null;
  observacao: string | null;
  caracteristicas: string | null;
  exigencia_tecnica: string | null;
  exclusividade: string | null;
  outros_fornecedores: string | null;
};

/** Um pedido não passa disso num formulário só; acima é erro de envio, não pedido real. */
export const MAXIMO_ITENS_NOVO_PEDIDO = 200;

const TIPOS = ["material", "servico", "equipamento"] as const;

function texto(valor: unknown, limite?: number): string | null {
  if (valor == null || typeof valor === "object") return null;
  const limpo = String(valor).trim();
  if (!limpo) return null;
  return limite ? limpo.slice(0, limite) : limpo;
}

function numero(valor: unknown): number | null {
  if (valor == null || valor === "" || typeof valor === "object") return null;
  const n = Number(String(valor).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Converte o que veio do formulário (tudo texto) no item que o banco recebe. */
export function normalizarItemNovoPedido(bruto: Record<string, unknown>): ItemNovoPedido {
  const tipo = texto(bruto.tipo);
  const insumoId = numero(bruto.insumo_id);
  return {
    tipo: TIPOS.find((t) => t === tipo) ?? "material",
    insumo_id: insumoId != null && Number.isInteger(insumoId) && insumoId > 0 ? insumoId : null,
    especificacao: texto(bruto.especificacao),
    quantidade: numero(bruto.quantidade),
    unidade: texto(bruto.unidade),
    modelo: texto(bruto.modelo),
    volume: texto(bruto.volume),
    fornecedor_sugerido: texto(bruto.fornecedor_sugerido),
    orcamento_previo: numero(bruto.orcamento_previo),
    observacao: texto(bruto.observacao),
    caracteristicas: texto(bruto.caracteristicas, 2000),
    exigencia_tecnica: texto(bruto.exigencia_tecnica, 2000),
    exclusividade: texto(bruto.exclusividade, 2000),
    outros_fornecedores: texto(bruto.outros_fornecedores, 1000),
  };
}

/** O item pode entrar na lista: tem o que o envio para aprovação exige. */
export function faltaNoItem(item: Pick<ItemNovoPedido, "especificacao" | "quantidade" | "unidade">): string | null {
  if (!item.especificacao) return "Informe a especificação do item.";
  if (!(Number(item.quantidade) > 0)) return "Informe uma quantidade maior que zero.";
  if (!item.unidade) return "Informe a unidade do item (un, caixa, kit, mL...).";
  return null;
}

/**
 * Lista enviada pelo formulário: os itens já adicionados (JSON) e, por último,
 * o item que a pessoa preencheu sem apertar "Adicionar item", para que ele não
 * se perca ao enviar.
 */
export function lerItensNovoPedido(
  json: string | null | undefined,
  emPreenchimento: Record<string, unknown> = {},
): { itens: ItemNovoPedido[]; erro: string | null } {
  const ilegivel = { itens: [], erro: "A lista de itens não pôde ser lida. Recarregue a página e monte o pedido de novo." };
  let lista: unknown = [];
  if (json && json.trim()) {
    try {
      lista = JSON.parse(json);
    } catch {
      return ilegivel;
    }
  }
  if (!Array.isArray(lista) || lista.some((item) => !item || typeof item !== "object" || Array.isArray(item))) return ilegivel;
  const itens = (lista as Record<string, unknown>[]).map(normalizarItemNovoPedido);
  if (texto(emPreenchimento.especificacao)) itens.push(normalizarItemNovoPedido(emPreenchimento));
  if (itens.length > MAXIMO_ITENS_NOVO_PEDIDO) {
    return { itens: [], erro: `Um pedido aceita até ${MAXIMO_ITENS_NOVO_PEDIDO} itens por vez. Divida em mais de um pedido.` };
  }
  return { itens, erro: null };
}

/** O que impede gravar a lista; null quando pode. Para enviar, exige ao menos um item completo. */
export function faltaNosItens(itens: ItemNovoPedido[], paraEnviar: boolean): string | null {
  if (paraEnviar && itens.length === 0) {
    return "Inclua ao menos um material, serviço ou equipamento antes de enviar.";
  }
  if (itens.some((item) => !item.especificacao || !(Number(item.quantidade) > 0))) {
    return "Todo item precisa de especificação e de quantidade maior que zero.";
  }
  if (paraEnviar && itens.some((item) => !item.unidade)) {
    return "Todos os itens precisam de especificação, quantidade e unidade.";
  }
  return null;
}
