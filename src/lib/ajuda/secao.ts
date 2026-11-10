// Como cada seção da Ajuda aparece: o título diz o tipo, e o tipo escolhe
// o ícone e o formato da lista (passos numerados, cuidados em destaque).

import { AJUDA_TOPICOS, type AjudaTopico } from "./topics";

export type TipoSecaoAjuda = "passos" | "praticas" | "atencao" | "serve" | "info";

const semAcento = (texto: string) => texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Tipo da seção pelo título. Título fora dos padrões cai em "info". */
export function tipoDaSecao(titulo: string): TipoSecaoAjuda {
  const t = semAcento(titulo);
  if (/^passo a passo|^como usar|^como fazer/.test(t)) return "passos";
  if (/^boas praticas/.test(t)) return "praticas";
  if (/atencao|excec|cuidado|bloque|trava|se nao |quando nao /.test(t)) return "atencao";
  if (/^para que serve|^o que voce/.test(t)) return "serve";
  return "info";
}

/** Âncora estável da seção dentro do tópico (para o índice "Nesta página"). */
export function ancoraDaSecao(topicoId: string, indice: number) {
  return `ajuda-${topicoId}-${indice + 1}`;
}

/** Tópico pedido na URL (/ajuda?topico=pedido). Id desconhecido não escolhe nada. */
export function topicoDaUrl(valor: string | null | undefined): AjudaTopico | null {
  if (!valor) return null;
  return AJUDA_TOPICOS.find((topico) => topico.id === valor) ?? null;
}

/** Link direto para um tópico da Central de Ajuda. */
export function hrefAjuda(topicoId: string) {
  return `/ajuda?topico=${encodeURIComponent(topicoId)}`;
}

/** Ordem importa: a primeira regra que casar com a rota vence. */
const TOPICO_DA_ROTA: Array<[prefixo: string, topicoId: string]> = [
  ["/orcamento", "orcamento-demandas"],
  ["/estoque", "estoque"],
  ["/suprimentos", "suprimentos"],
  ["/pedido", "pedido"],
  ["/aprovar", "pedido"],
  ["/recebimento", "pedido"],
  ["/compras", "compras"],
  ["/planejamento", "planejamento"],
  ["/custeio", "custeio"],
  ["/parametros", "custeio"],
  ["/analises", "analises"],
  ["/insumos", "insumos-por-analise"],
  ["/cadastros", "cadastros"],
  ["/projetos", "cadastros"],
  ["/governanca/incidentes", "incidentes"],
  ["/governanca/backups", "backups"],
  ["/governanca", "privilegios"],
  ["/notificacoes", "notificacoes"],
  ["/usuarios", "usuarios"],
  ["/auditoria", "auditoria"],
];

/** Tópico da Central de Ajuda que explica a tela aberta. */
export function topicoParaRota(pathname: string): string {
  return TOPICO_DA_ROTA.find(([prefixo]) => pathname.startsWith(prefixo))?.[1] ?? "navegacao-geral";
}
