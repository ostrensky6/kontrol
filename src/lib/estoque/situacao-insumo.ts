/**
 * Situação de estoque de cada insumo e de cada lote, compartilhada pelos
 * painéis de estoque (cliente e servidor).
 *
 * Um insumo pode ter vários sinais ao mesmo tempo (ex.: sem estoque e
 * reposição). Filtros e contadores usam os sinais: o insumo aparece em todos os
 * filtros e cartões dos sinais que tem. O sinal mais grave (situação principal)
 * só define o rótulo e o tom do cartão. Insumo sem nenhum sinal = estoque em dia
 * (é o que a "Saúde do estoque" conta).
 *
 * Nunca recebido (decisão de Antonio em 19/11/2026): insumo cadastrado que
 * nunca teve lote não é "Sem estoque". É um estado neutro, não um sinal: não
 * pede atenção, não conta como "em dia" e fica fora da base da saúde. Se
 * tiver outro sinal (Repor, compra atrasada), o sinal continua valendo.
 */

import { loteVencido } from "./baixa";

/** Sinais do insumo, do mais grave para o menos grave. */
export const SINAIS_INSUMO = [
  "vencido",
  "sem_validade",
  "sem_disponivel",
  "compra_atrasada",
  "reposicao",
  "reposicao_pendente",
  "vencendo",
] as const;

export type SinalInsumo = (typeof SINAIS_INSUMO)[number];
export type TomSinal = "red" | "amber";

export const META_SINAL: Record<SinalInsumo, { rotulo: string; tom: TomSinal }> = {
  vencido: { rotulo: "Lote vencido", tom: "red" },
  sem_validade: { rotulo: "Sem validade", tom: "red" },
  sem_disponivel: { rotulo: "Sem estoque", tom: "red" },
  compra_atrasada: { rotulo: "Compra atrasada", tom: "red" },
  reposicao: { rotulo: "Repor", tom: "amber" },
  reposicao_pendente: { rotulo: "Repor, aguardando aprovação", tom: "amber" },
  vencendo: { rotulo: "Vence em breve", tom: "amber" },
};

// glossário da revisão de 11/11 (10.5): o mesmo "Em dia" do filtro
export const ROTULO_ESTOQUE_OK = "Em dia";

/** Insumo cadastrado que nunca teve lote: ainda não chegou nada ao estoque. */
export const ROTULO_NUNCA_RECEBIDO = "Nunca recebido";

/** Tipo da linha de v_alertas_estoque que liga cada sinal vindo do banco. */
const SINAL_POR_TIPO_ALERTA: Record<string, SinalInsumo> = {
  vencido: "vencido",
  sem_validade: "sem_validade",
  compra_atrasada: "compra_atrasada",
  reposicao_pendente: "reposicao_pendente",
  vencimento: "vencendo",
};

type Numerico = number | string | null | undefined;

export type SaldoParaSinais = {
  disponivel?: Numerico;
  /** sugestão de compra da previsão (0130): > 0 = repor */
  qtd_sugerida_compra?: Numerico;
  /** o insumo nunca teve lote, de nenhum status: zerado assim não é "Sem estoque" */
  nunca_recebido?: boolean | null;
};

export type AlertaParaSinais = { tipo: string | null };

/**
 * Todos os sinais do insumo, em ordem de gravidade.
 * - Reposição: a previsão sugere comprar (uma regra só, 0130).
 * - Sem estoque: disponível zerado de insumo que já teve lote. O que nunca foi
 *   recebido não entra aqui.
 * - Demais: linhas de v_alertas_estoque do insumo (vencido, sem validade,
 *   vencimento, compra atrasada e reposição aguardando aprovação).
 */
export function sinaisDoInsumo(saldo: SaldoParaSinais, alertas: readonly AlertaParaSinais[]): SinalInsumo[] {
  const presentes = new Set<SinalInsumo>();
  for (const alerta of alertas) {
    const sinal = alerta.tipo ? SINAL_POR_TIPO_ALERTA[alerta.tipo] : undefined;
    if (sinal) presentes.add(sinal);
  }
  if (!saldo.nunca_recebido && Number(saldo.disponivel ?? 0) <= 0) presentes.add("sem_disponivel");
  if (Number(saldo.qtd_sugerida_compra ?? 0) > 0) presentes.add("reposicao");
  return SINAIS_INSUMO.filter((sinal) => presentes.has(sinal));
}

export type SituacaoInsumo = {
  sinais: SinalInsumo[];
  /** sinal mais grave; null = estoque em dia ou insumo nunca recebido */
  principal: SinalInsumo | null;
  /** nunca teve lote: sem sinal, o rótulo é "Nunca recebido", não "Em dia" */
  nuncaRecebido: boolean;
  rotulo: string;
  /** "slate" = em dia; "neutro" = nunca recebido e sem sinal */
  tom: TomSinal | "slate" | "neutro";
};

export function situacaoDoInsumo(saldo: SaldoParaSinais, alertas: readonly AlertaParaSinais[]): SituacaoInsumo {
  const sinais = sinaisDoInsumo(saldo, alertas);
  const principal = sinais[0] ?? null;
  const nuncaRecebido = Boolean(saldo.nunca_recebido);
  return {
    sinais,
    principal,
    nuncaRecebido,
    rotulo: principal ? META_SINAL[principal].rotulo : nuncaRecebido ? ROTULO_NUNCA_RECEBIDO : ROTULO_ESTOQUE_OK,
    tom: principal ? META_SINAL[principal].tom : nuncaRecebido ? "neutro" : "slate",
  };
}

/** Opções do filtro "Estado físico / alerta" na visão por insumo. */
export const FILTROS_INSUMO = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "sem_disponivel", rotulo: "Sem estoque" },
  { valor: "reposicao", rotulo: "Repor" },
  { valor: "reposicao_pendente", rotulo: "Repor, aguardando aprovação" },
  { valor: "vencido_vencendo", rotulo: "Vencido/Vencendo" },
  { valor: "sem_validade", rotulo: "Sem validade" },
  { valor: "compra_atrasada", rotulo: "Compra atrasada" },
  { valor: "ok", rotulo: ROTULO_ESTOQUE_OK },
  { valor: "nunca_recebido", rotulo: ROTULO_NUNCA_RECEBIDO },
] as const;

export type FiltroInsumo = (typeof FILTROS_INSUMO)[number]["valor"];

function ehSinal(valor: string): valor is SinalInsumo {
  return (SINAIS_INSUMO as readonly string[]).includes(valor);
}

/**
 * O insumo entra no filtro se tiver o sinal (não só se for o principal).
 * "Nunca recebido" é um fato do insumo, tenha ou não sinal; sem sinal, ele
 * não é "em dia" nem pede atenção.
 */
export function insumoAtendeFiltro(sinais: readonly SinalInsumo[], filtro: string, nuncaRecebido = false): boolean {
  if (filtro === "todos") return true;
  // "precisa de atenção": qualquer sinal
  if (filtro === "atencao") return sinais.length > 0;
  if (filtro === "ok") return sinais.length === 0 && !nuncaRecebido;
  if (filtro === "nunca_recebido") return nuncaRecebido;
  if (filtro === "vencido_vencendo") return sinais.includes("vencido") || sinais.includes("vencendo");
  return ehSinal(filtro) && sinais.includes(filtro);
}

/** Quantos insumos têm pelo menos um dos sinais pedidos. */
export function contarComSinal(
  itens: readonly { sinais: readonly SinalInsumo[] }[],
  ...sinais: SinalInsumo[]
): number {
  return itens.filter((item) => sinais.some((sinal) => item.sinais.includes(sinal))).length;
}

type ItemComSinais = { sinais: readonly SinalInsumo[]; nuncaRecebido?: boolean };

/** Insumos em dia: já recebidos e sem nenhum sinal. É o que a "Saúde do estoque" conta. */
export function contarSemSinal(itens: readonly ItemComSinais[]): number {
  return itens.filter((item) => item.sinais.length === 0 && !item.nuncaRecebido).length;
}

/** Insumos nunca recebidos e sem sinal: nem em dia, nem em alerta; ficam fora da base da saúde. */
export function contarNuncaRecebidosSemSinal(itens: readonly ItemComSinais[]): number {
  return itens.filter((item) => item.sinais.length === 0 && item.nuncaRecebido).length;
}

// ── Lotes ────────────────────────────────────────────────────────────────

/** Padrão de janela_vencimento_dias (mesmo COALESCE de v_alertas_estoque). */
export const JANELA_VENCIMENTO_PADRAO_DIAS = 60;

/** Valor do parâmetro janela_vencimento_dias; vazio ou inválido usa 60. */
export function janelaVencimentoDias(valor: unknown): number {
  if (valor == null || valor === "") return JANELA_VENCIMENTO_PADRAO_DIAS;
  const dias = Number(valor);
  return Number.isFinite(dias) ? Math.round(dias) : JANELA_VENCIMENTO_PADRAO_DIAS;
}

/** aaaa-mm-dd + n dias (em UTC, sem efeito de horário de verão). */
export function somarDiasIso(iso: string, dias: number): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

/**
 * Lote que ainda não venceu mas vence dentro da janela (mesma regra do
 * alerta "vencimento" de v_alertas_estoque). `validade` é a validade efetiva:
 * a menor entre a do fabricante e a após abertura.
 */
export function loteVenceEmBreve(validade: string | null | undefined, hoje: string, janelaDias: number): boolean {
  if (!validade) return false;
  const data = String(validade).slice(0, 10);
  if (loteVencido(data, hoje)) return false;
  return data <= somarDiasIso(hoje, janelaDias);
}

/** Opções do filtro na visão por lote: só o que se aplica a um lote. */
export const FILTROS_LOTE = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "vencido", rotulo: "Vencido" },
  { valor: "vencendo", rotulo: "Vence em breve" },
  { valor: "sem_validade", rotulo: "Sem validade" },
] as const;

export type FiltroLote = (typeof FILTROS_LOTE)[number]["valor"];

export type LoteParaFiltro = {
  vencido: boolean;
  vencendo: boolean;
  /** validade efetiva; null = sem validade */
  validadeIso: string | null;
};

export function loteAtendeFiltro(lote: LoteParaFiltro, filtro: string): boolean {
  switch (filtro) {
    case "todos":
      return true;
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

/** O filtro escolhido existe na visão? (ao trocar de visão, o inválido volta a "todos") */
export function filtroValidoNaVisao(filtro: string, visao: "insumo" | "lote" | "grafica"): boolean {
  const opcoes: readonly { valor: string }[] = visao === "lote" ? FILTROS_LOTE : FILTROS_INSUMO;
  return opcoes.some((opcao) => opcao.valor === filtro);
}

// ── Tabela "Saldo por insumo" (/estoque) ─────────────────────────────────

/** Condições da coluna Situação, da mais grave para a menos grave. */
export const SITUACOES_SALDO = ["sem_estoque", "repor", "reposicao_pendente"] as const;
export type SituacaoSaldo = (typeof SITUACOES_SALDO)[number];

export const ROTULO_SITUACAO_SALDO: Record<SituacaoSaldo, string> = {
  sem_estoque: "Sem estoque",
  repor: "Repor",
  reposicao_pendente: "Repor, aguardando aprovação",
};

export const ROTULO_SALDO_EM_DIA = "Em dia";

/** Opções do filtro Situação: casa pela condição, não pelo rótulo exibido. */
export const FILTROS_SALDO = [
  { value: "ok", label: ROTULO_SALDO_EM_DIA },
  { value: "repor", label: ROTULO_SITUACAO_SALDO.repor },
  { value: "reposicao_pendente", label: ROTULO_SITUACAO_SALDO.reposicao_pendente },
  { value: "sem_estoque", label: ROTULO_SITUACAO_SALDO.sem_estoque },
] as const;

export function situacoesDoSaldo({
  emMaos,
  repor,
  reposicaoPendente,
}: {
  emMaos: number;
  repor: boolean;
  reposicaoPendente: boolean;
}): SituacaoSaldo[] {
  const presentes = new Set<SituacaoSaldo>();
  if (emMaos <= 0) presentes.add("sem_estoque");
  if (repor) presentes.add("repor");
  if (reposicaoPendente) presentes.add("reposicao_pendente");
  return SITUACOES_SALDO.filter((situacao) => presentes.has(situacao));
}

/** Texto da coluna Status (busca e ordenação): "Sem estoque · Repor" ou "Em dia". */
export function rotuloDoSaldo(situacoes: readonly SituacaoSaldo[]): string {
  return situacoes.length ? situacoes.map((situacao) => ROTULO_SITUACAO_SALDO[situacao]).join(" · ") : ROTULO_SALDO_EM_DIA;
}

export function saldoAtendeFiltro(situacoes: readonly SituacaoSaldo[], filtro: unknown): boolean {
  if (filtro == null || filtro === "") return true;
  if (filtro === "ok") return situacoes.length === 0;
  return (SITUACOES_SALDO as readonly unknown[]).includes(filtro) && situacoes.includes(filtro as SituacaoSaldo);
}
