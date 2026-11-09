/**
 * Natureza da despesa e objetivo do pedido (0168). As abas Solicitação,
 * Compras e Diárias da planilha da equipe viram um só fluxo com a natureza;
 * o objetivo é a coluna "Objetivo" da planilha.
 */
export const NATUREZAS_PEDIDO = [
  { valor: "material_consumo_lab", rotulo: "Material de consumo de laboratório" },
  { valor: "material_consumo_geral", rotulo: "Material de consumo geral (campo, coleta)" },
  { valor: "equipamento", rotulo: "Equipamento / material permanente" },
  { valor: "servico", rotulo: "Serviço" },
  { valor: "manutencao", rotulo: "Manutenção" },
  { valor: "diaria", rotulo: "Diária" },
  { valor: "combustivel", rotulo: "Combustível" },
  { valor: "seguro", rotulo: "Seguro" },
  { valor: "passagem", rotulo: "Passagem" },
  { valor: "locacao", rotulo: "Locação" },
  { valor: "outro", rotulo: "Outro" },
] as const;

export const OBJETIVOS_PEDIDO = [
  { valor: "projeto", rotulo: "Projeto" },
  { valor: "tese", rotulo: "Tese" },
  { valor: "manutencao_lab", rotulo: "Manutenção de laboratório" },
  { valor: "uso_geral", rotulo: "Uso geral" },
  { valor: "campo", rotulo: "Campo" },
  { valor: "outro", rotulo: "Outro" },
] as const;

export type NaturezaPedido = (typeof NATUREZAS_PEDIDO)[number]["valor"];
export type ObjetivoPedido = (typeof OBJETIVOS_PEDIDO)[number]["valor"];

const NATUREZA_ROTULO = new Map<string, string>(NATUREZAS_PEDIDO.map((n) => [n.valor, n.rotulo]));
const OBJETIVO_ROTULO = new Map<string, string>(OBJETIVOS_PEDIDO.map((o) => [o.valor, o.rotulo]));

export function rotuloNatureza(valor: string | null | undefined) {
  return valor ? NATUREZA_ROTULO.get(valor) ?? valor : null;
}

export function rotuloObjetivo(valor: string | null | undefined) {
  return valor ? OBJETIVO_ROTULO.get(valor) ?? valor : null;
}

/** Aceita só valores da lista; qualquer outra coisa vira vazio (o banco recusaria). */
export function naturezaValida(valor: string | null | undefined): NaturezaPedido | null {
  return valor && NATUREZA_ROTULO.has(valor) ? (valor as NaturezaPedido) : null;
}

export function objetivoValido(valor: string | null | undefined): ObjetivoPedido | null {
  return valor && OBJETIVO_ROTULO.has(valor) ? (valor as ObjetivoPedido) : null;
}

/** Sinônimos do insumo ("low binding; baixa retenção") em lista, sem vazios nem repetidos. */
export function separarSinonimos(valor: string | null | undefined): string[] {
  const vistos = new Set<string>();
  const lista: string[] = [];
  for (const parte of String(valor ?? "").split(/[;\n]/)) {
    const termo = parte.trim();
    const chave = termo.toLocaleLowerCase("pt-BR");
    if (!termo || vistos.has(chave)) continue;
    vistos.add(chave);
    lista.push(termo);
  }
  return lista;
}
