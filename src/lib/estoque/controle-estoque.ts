import {
  META_SINAL,
  ROTULO_ESTOQUE_OK,
  SINAIS_INSUMO,
  contarComSinal,
  contarSemSinal,
  insumoAtendeFiltro,
  type SinalInsumo,
} from "@/lib/estoque/situacao-insumo";

/**
 * Controle do estoque dentro da Situação do estoque (organização de
 * 11/11/2026): o que a tela "Controle de Estoque" fazia e tinha ficado sem
 * lugar. Regras puras, usadas pela tela, pelo Início e pelos testes: os
 * números do Início e os da Situação saem da mesma conta.
 */

/** Aviso do sistema ligado a um insumo, com o estado de leitura de quem está logado. */
export type AvisoInsumo = {
  id: number;
  titulo: string;
  corpo: string | null;
  /** "nao_lida" = pendente; "lida" = tratado */
  status: string;
  criadoEm: string;
};

export type AvisoDb = {
  id: number;
  titulo: string | null;
  corpo: string | null;
  entidade_tipo: string | null;
  entidade_id: number | null;
  status: string | null;
  criado_em: string | null;
};

/** Nome curto demais casaria com qualquer aviso: só nomes com 3 letras ou mais ligam pelo texto. */
const MENOR_NOME_NO_TEXTO = 3;

/**
 * Avisos de um insumo: os gravados para ele (entidade "insumo") e os que
 * citam o nome dele no título ou no texto, como os de falta no planejamento
 * ("Mix PCR: falta 10 uL no planejamento #1").
 */
export function avisosDoInsumo(avisos: readonly AvisoDb[], insumoId: number, especificacao: string): AvisoInsumo[] {
  const nome = especificacao.trim().toLowerCase();
  return avisos
    .filter((aviso) => {
      if (aviso.entidade_tipo === "insumo" && Number(aviso.entidade_id) === insumoId) return true;
      if (nome.length < MENOR_NOME_NO_TEXTO) return false;
      return (aviso.titulo ?? "").toLowerCase().includes(nome) || (aviso.corpo ?? "").toLowerCase().includes(nome);
    })
    .map((aviso) => ({
      id: aviso.id,
      titulo: aviso.titulo ?? "Aviso",
      corpo: aviso.corpo,
      status: aviso.status ?? "nao_lida",
      criadoEm: aviso.criado_em ?? "",
    }));
}

/** Filtro pelos avisos do insumo: o que ainda não foi tratado, o que já foi e o que nunca teve aviso. */
export const FILTROS_AVISO = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "pendentes", rotulo: "Com aviso pendente" },
  { valor: "tratados", rotulo: "Com avisos tratados" },
  { valor: "sem_aviso", rotulo: "Sem aviso" },
] as const;

export type FiltroAviso = (typeof FILTROS_AVISO)[number]["valor"];

export function insumoAtendeAvisos(avisos: readonly Pick<AvisoInsumo, "status">[], filtro: string): boolean {
  switch (filtro) {
    case "todos":
      return true;
    case "pendentes":
      return avisos.some((aviso) => aviso.status === "nao_lida");
    case "tratados":
      // tratado é ter aviso e nenhum pendente: insumo sem aviso não entra aqui
      return avisos.length > 0 && avisos.every((aviso) => aviso.status !== "nao_lida");
    case "sem_aviso":
      return avisos.length === 0;
    default:
      return false;
  }
}

/** Criticidade é a categoria de compra do cadastro do insumo. */
export const FILTROS_CRITICIDADE = [
  { valor: "todos", rotulo: "Todas" },
  { valor: "critico", rotulo: "Crítico" },
  { valor: "operacional", rotulo: "Operacional" },
  { valor: "eventual", rotulo: "Eventual" },
] as const;

export type FiltroCriticidade = (typeof FILTROS_CRITICIDADE)[number]["valor"];

export function insumoAtendeCriticidade(categoriaCompra: string | null | undefined, filtro: string): boolean {
  return filtro === "todos" || categoriaCompra === filtro;
}

/** Filtro de situação da visão por insumo. Abre em "Precisa de atenção". */
export const FILTROS_SITUACAO_CONTROLE = [
  { valor: "atencao", rotulo: "Precisa de atenção" },
  { valor: "sem_disponivel", rotulo: "Sem estoque" },
  { valor: "reposicao", rotulo: "Repor" },
  { valor: "reposicao_pendente", rotulo: "Repor, aguardando aprovação" },
  { valor: "vencido_vencendo", rotulo: "Vencido ou vencendo" },
  { valor: "sem_validade", rotulo: "Sem validade" },
  { valor: "compra_atrasada", rotulo: "Compra atrasada" },
  { valor: "ok", rotulo: ROTULO_ESTOQUE_OK },
  { valor: "todos", rotulo: "Todos" },
] as const;

export type FiltroSituacaoControle = (typeof FILTROS_SITUACAO_CONTROLE)[number]["valor"];

export const FILTRO_SITUACAO_CONTROLE_PADRAO: FiltroSituacaoControle = "atencao";

export function filtroSituacaoControleValido(valor: unknown): FiltroSituacaoControle {
  return FILTROS_SITUACAO_CONTROLE.some((f) => f.valor === valor)
    ? (valor as FiltroSituacaoControle)
    : FILTRO_SITUACAO_CONTROLE_PADRAO;
}

export type InsumoParaControle = {
  insumoId: number;
  especificacao: string;
  sinais: readonly SinalInsumo[];
  categoriaCompra: string | null;
  avisos: readonly Pick<AvisoInsumo, "status">[];
};

export type FiltrosControle = { busca: string; situacao: string; criticidade: string; avisos: string };

/** Os quatro filtros da visão por insumo, juntos. */
export function filtrarInsumosDoControle<T extends InsumoParaControle>(itens: readonly T[], filtros: FiltrosControle): T[] {
  const busca = filtros.busca.trim().toLowerCase();
  return itens.filter((item) => {
    if (busca && !item.especificacao.toLowerCase().includes(busca) && !String(item.insumoId).includes(busca)) return false;
    if (!insumoAtendeFiltro(item.sinais, filtros.situacao)) return false;
    if (!insumoAtendeCriticidade(item.categoriaCompra, filtros.criticidade)) return false;
    return insumoAtendeAvisos(item.avisos, filtros.avisos);
  });
}

export type ResumoSinais = {
  /** insumos ativos */
  total: number;
  semEstoque: number;
  repor: number;
  reporAguardandoAprovacao: number;
  /** insumos com lote vencido */
  vencido: number;
  /** insumos com lote que vence dentro da janela */
  vencendo: number;
  /** insumos com lote vencido ou vencendo (cada insumo uma vez) */
  vencidosOuVencendo: number;
  semValidade: number;
  compraAtrasada: number;
  /** insumos sem nenhum sinal */
  emDia: number;
  /** percentual de insumos em dia, de 0 a 100 */
  saudePct: number;
};

/**
 * Contagem dos sinais do estoque. Um insumo com dois sinais conta nos dois
 * números; "em dia" e a saúde contam quem não tem nenhum.
 */
export function resumirSinais(itens: readonly { sinais: readonly SinalInsumo[] }[]): ResumoSinais {
  const total = itens.length;
  const emDia = contarSemSinal(itens);
  return {
    total,
    semEstoque: contarComSinal(itens, "sem_disponivel"),
    repor: contarComSinal(itens, "reposicao"),
    reporAguardandoAprovacao: contarComSinal(itens, "reposicao_pendente"),
    vencido: contarComSinal(itens, "vencido"),
    vencendo: contarComSinal(itens, "vencendo"),
    vencidosOuVencendo: contarComSinal(itens, "vencido", "vencendo"),
    semValidade: contarComSinal(itens, "sem_validade"),
    compraAtrasada: contarComSinal(itens, "compra_atrasada"),
    emDia,
    saudePct: total > 0 ? Math.round((emDia / total) * 100) : 0,
  };
}

/** Texto de quando a leitura do estoque veio incompleta: o número vira "sem dado", nunca zero. */
export const DETALHE_SEM_DADO_ESTOQUE = "a leitura do estoque não respondeu por inteiro";

export type NumeroDoEstoque = {
  filtro: FiltroSituacaoControle;
  label: string;
  value: number | "sem dado";
  detail: string;
  tone: "danger" | "warning" | "neutral";
};

/**
 * Os quatro números do estoque (topo da Situação; o Início usa três deles):
 * sem estoque, repor, vencidos ou vencendo e compra atrasada. Cada um abre a
 * lista por insumo com o filtro do próprio número. Sem resumo (leitura
 * incompleta), todos mostram "sem dado".
 */
export function numerosDoEstoque(resumo: ResumoSinais | null): NumeroDoEstoque[] {
  const numero = (
    filtro: FiltroSituacaoControle,
    label: string,
    valor: (r: ResumoSinais) => number,
    detalhe: (r: ResumoSinais) => string,
    tom: (r: ResumoSinais) => NumeroDoEstoque["tone"],
  ): NumeroDoEstoque =>
    resumo
      ? { filtro, label, value: valor(resumo), detail: detalhe(resumo), tone: tom(resumo) }
      : { filtro, label, value: "sem dado", detail: DETALHE_SEM_DADO_ESTOQUE, tone: "neutral" };
  return [
    numero(
      "sem_disponivel",
      "Sem estoque",
      (r) => r.semEstoque,
      () => "sem saldo disponível agora",
      (r) => (r.semEstoque ? "danger" : "neutral"),
    ),
    numero(
      "reposicao",
      "Repor",
      (r) => r.repor,
      (r) =>
        r.reporAguardandoAprovacao > 0
          ? `hora de pedir · ${r.reporAguardandoAprovacao} com pedido aguardando aprovação`
          : "hora de pedir",
      (r) => (r.repor ? "warning" : "neutral"),
    ),
    numero(
      "vencido_vencendo",
      "Vencidos ou vencendo",
      (r) => r.vencidosOuVencendo,
      (r) => `${r.vencido} com lote vencido · ${r.vencendo} vencendo` + (r.semValidade > 0 ? ` · ${r.semValidade} sem validade` : ""),
      (r) => (r.vencido ? "danger" : r.vencidosOuVencendo ? "warning" : "neutral"),
    ),
    numero(
      "compra_atrasada",
      "Compra atrasada",
      (r) => r.compraAtrasada,
      () => "abaixo do mínimo, com a compra atrasada",
      (r) => (r.compraAtrasada ? "danger" : "neutral"),
    ),
  ];
}

export type BarraSituacao = { situacao: string; insumos: number; tom: "red" | "amber" | "ok" };

/**
 * Gráfico "Insumos por situação": cada insumo entra uma vez, na situação mais
 * grave que tem; as barras somam o total de insumos ativos.
 */
export function insumosPorSituacaoPrincipal(itens: readonly { sinais: readonly SinalInsumo[] }[]): BarraSituacao[] {
  const barras: BarraSituacao[] = SINAIS_INSUMO.map((sinal) => ({
    situacao: META_SINAL[sinal].rotulo,
    insumos: itens.filter((item) => item.sinais[0] === sinal).length,
    tom: META_SINAL[sinal].tom,
  }));
  barras.push({ situacao: ROTULO_ESTOQUE_OK, insumos: contarSemSinal(itens), tom: "ok" });
  return barras.filter((barra) => barra.insumos > 0);
}

/** Filtro de validade da visão por lote. Abre em "Precisa de atenção". */
export const FILTROS_LOTE_CONTROLE = [
  { valor: "atencao", rotulo: "Precisa de atenção" },
  { valor: "vencido", rotulo: "Vencido" },
  { valor: "vencendo", rotulo: "Vence em breve" },
  { valor: "sem_validade", rotulo: "Sem validade" },
  { valor: "todos", rotulo: "Todos" },
] as const;

export type FiltroLoteControle = (typeof FILTROS_LOTE_CONTROLE)[number]["valor"];

export type LoteParaControle = { vencido: boolean; vencendo: boolean; validadeIso: string | null };

export function loteAtendeControle(lote: LoteParaControle, filtro: string): boolean {
  switch (filtro) {
    case "todos":
      return true;
    case "atencao":
      return lote.vencido || lote.vencendo || !lote.validadeIso;
    case "vencido":
      return lote.vencido;
    case "vencendo":
      return lote.vencendo;
    case "sem_validade":
      return !lote.validadeIso;
    default:
      return false;
  }
}

/** As três visões da Situação do estoque. */
export const VISOES_SITUACAO = [
  { id: "insumo", rotulo: "Por insumo" },
  { id: "lote", rotulo: "Por lote" },
  { id: "graficos", rotulo: "Gráficos" },
] as const;

export type VisaoSituacao = (typeof VISOES_SITUACAO)[number]["id"];

export function visaoSituacaoValida(valor: unknown): VisaoSituacao {
  return VISOES_SITUACAO.some((v) => v.id === valor) ? (valor as VisaoSituacao) : "insumo";
}

export const HREF_SITUACAO = "/estoque/situacao";

/** Endereço de uma visão, com o filtro de situação quando há. */
export function hrefVisaoSituacao(visao: VisaoSituacao, situacao?: FiltroSituacaoControle): string {
  const params = new URLSearchParams();
  if (visao !== "insumo") params.set("ver", visao);
  if (situacao && situacao !== FILTRO_SITUACAO_CONTROLE_PADRAO) params.set("alerta", situacao);
  const consulta = params.toString();
  return consulta ? `${HREF_SITUACAO}?${consulta}` : HREF_SITUACAO;
}

/** Endereço da lista por insumo já filtrada: é para onde cada número do estoque leva. */
export function hrefListaPorInsumo(situacao: FiltroSituacaoControle): string {
  return `${hrefVisaoSituacao("insumo", situacao)}#controle-por-insumo`;
}
