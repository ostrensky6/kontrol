/**
 * Glossário da revisão de 11/11 (seção 10.5, decisão 6): uma palavra para
 * cada coisa. As telas já usam as palavras novas; mensagens que vêm prontas
 * do banco (recusas das RPCs e títulos de aviso gravados pelas migrations)
 * ainda trazem as antigas. Esta tradução troca só as palavras, sem mexer na
 * regra, para que o usuário leia o mesmo nome na tela e no aviso.
 *
 * A ordem importa: as frases mais longas vêm antes das palavras soltas, e
 * cada troca preserva o gênero ("pelo pedido de compra" → "pela compra").
 */
const TROCAS: readonly [RegExp, string][] = [
  // Inventário: a campanha é a Contagem; cada leitura é um item contado
  [/(\d+|%) contagem\(ns\)/g, "$1 item(ns) contado(s)"],
  [/Campanha de invent[aá]rio/g, "Contagem"],
  [/campanha de invent[aá]rio/g, "contagem"],
  [/Campanha/g, "Contagem"],
  [/campanha/g, "contagem"],
  // nomes das permissões, como aparecem em Usuários e em Funções
  [/Aprovar pedidos internos/g, "Aprovar pedidos"],
  [/Criar pedidos internos/g, "Criar pedidos"],
  [/Receber pedidos internos/g, "Registrar chegada de pedidos"],
  [/Receber compras/g, "Registrar chegada de compras"],
  // Compra (a etapa 5 do pedido) no lugar de "compra formal" e "pedido de compra"
  [/pelo pedido de compra/g, "pela compra"],
  [/do pedido de compra/g, "da compra"],
  [/no pedido de compra/g, "na compra"],
  [/Pedido de compra/g, "Compra"],
  [/pedido de compra/g, "compra"],
  [/Compras formais/g, "Compras"],
  [/compras formais/g, "compras"],
  [/Compra formal/g, "Compra"],
  [/compra formal/g, "compra"],
  // Pedido no lugar de "pedido interno"
  [/ \(Pedido interno\)/g, ""],
  [/Pedidos internos/g, "Pedidos"],
  [/pedidos internos/g, "pedidos"],
  [/Pedido interno/g, "Pedido"],
  [/pedido interno/g, "pedido"],
  // Aprovar no lugar de "validar"
  [/Pedido validado:/g, "Pedido aprovado pelo coordenador:"],
  [/aguardando validação/g, "aguardando aprovação"],
  [/para validação/g, "para aprovação"],
  [/aos da validação de/g, "aos da aprovação de"],
  [/é validado por/g, "é aprovado por"],
  [/o Administrador valida/g, "o Administrador aprova"],
];

/** Troca as palavras antigas pelas do glossário, sem mudar o resto do texto. */
export function noGlossario(texto: string): string;
export function noGlossario(texto: string | null): string | null;
export function noGlossario(texto: string | null | undefined): string | null | undefined;
export function noGlossario(texto: string | null | undefined): string | null | undefined {
  if (!texto) return texto;
  return TROCAS.reduce((atual, [antiga, nova]) => atual.replace(antiga, nova), texto);
}
