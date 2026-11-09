/**
 * Três orçamentos em toda compra (0171, decisão D2 de 09/11/2026). A regra
 * mora no banco (gatilho na troca de status e RPC de escolha); a tela lê os
 * orçamentos e o resumo para explicar o que falta antes de oferecer o botão.
 */

export const ORCAMENTOS_EXIGIDOS = 3;

/** Etapas em que orçamentos entram, mudam ou são escolhidos. */
export const ETAPAS_DE_COTACAO = ["orcamentos", "orcamentos_recebidos"];

/** Etapas em que o quadro de orçamentos aparece (registro ou consulta). */
export const ETAPAS_COM_ORCAMENTOS = [
  "orcamentos",
  "orcamentos_recebidos",
  "aguardando_aprovacao_final",
  "aprovado_para_compra",
  "compra_fechada",
  "encaminhado_instituicao",
  "aguardando_pagamento_nf",
  "compra_concluida",
];

export type Orcamento = {
  id: number;
  fornecedor_id: number | null;
  fornecedor_nome: string;
  valor_total: number;
  prazo_entrega_dias: number | null;
  validade: string | null;
  condicoes: string | null;
  anexo_id: number | null;
  escolhida: boolean;
  escolhida_por: string | null;
  escolhida_em: string | null;
  justificativa_escolha: string | null;
  registrada_por: string | null;
  registrada_em: string | null;
};

type Tabela = {
  select: (colunas: string) => {
    eq: (coluna: string, valor: unknown) => {
      order: (coluna: string, opcoes: { ascending: boolean }) => PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
};
/** Qualquer cliente Supabase (tipado ou não); a forma da consulta fica aqui. */
type Cliente = { from: (tabela: string) => unknown };

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function textoOuNulo(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

export function normalizarOrcamentos(data: unknown): Orcamento[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((r): r is Record<string, unknown> => r != null && typeof r === "object")
    .map((r) => ({
      id: Number(r.id),
      fornecedor_id: numero(r.fornecedor_id),
      fornecedor_nome: String(r.fornecedor_nome ?? "").trim(),
      valor_total: numero(r.valor_total) ?? 0,
      prazo_entrega_dias: numero(r.prazo_entrega_dias),
      validade: textoOuNulo(r.validade),
      condicoes: textoOuNulo(r.condicoes),
      anexo_id: numero(r.anexo_id),
      escolhida: r.escolhida === true,
      escolhida_por: textoOuNulo(r.escolhida_por),
      escolhida_em: textoOuNulo(r.escolhida_em),
      justificativa_escolha: textoOuNulo(r.justificativa_escolha),
      registrada_por: textoOuNulo(r.registrada_por),
      registrada_em: textoOuNulo(r.registrada_em),
    }));
}

/** Lê os orçamentos do pedido; null quando não deu para ler (a tela não inventa "zero"). */
export async function lerOrcamentos(supabase: Cliente, pedidoId: number): Promise<Orcamento[] | null> {
  const { data, error } = await (supabase.from("pedidos_internos_cotacoes") as Tabela)
    .select(
      "id, fornecedor_id, fornecedor_nome, valor_total, prazo_entrega_dias, validade, condicoes, anexo_id, escolhida, escolhida_por, escolhida_em, justificativa_escolha, registrada_por, registrada_em",
    )
    .eq("pedido_interno_id", pedidoId)
    .order("valor_total", { ascending: true });
  if (error) return null;
  return normalizarOrcamentos(data);
}

export type ResumoOrcamentos = {
  fornecedores: number;
  faltam: number;
  menorValor: number | null;
  escolhido: Orcamento | null;
  /** escolhido não é o de menor valor (exige justificativa) */
  escolhidoAcimaDoMenor: boolean;
};

export function resumirOrcamentos(orcamentos: Orcamento[]): ResumoOrcamentos {
  const nomes = new Set(orcamentos.map((o) => o.fornecedor_nome.trim().toLocaleLowerCase("pt-BR")).filter(Boolean));
  const menorValor = orcamentos.length ? Math.min(...orcamentos.map((o) => o.valor_total)) : null;
  const escolhido = orcamentos.find((o) => o.escolhida) ?? null;
  return {
    fornecedores: nomes.size,
    faltam: Math.max(0, ORCAMENTOS_EXIGIDOS - nomes.size),
    menorValor,
    escolhido,
    escolhidoAcimaDoMenor: escolhido != null && menorValor != null && escolhido.valor_total > menorValor,
  };
}

/** Por que "Marcar cotações recebidas" ainda não pode; null quando pode. */
export function motivoSemCotacoesRecebidas(resumo: ResumoOrcamentos): string | null {
  if (resumo.faltam === 0) return null;
  return `Toda compra precisa de ${ORCAMENTOS_EXIGIDOS} orçamentos de fornecedores diferentes. Falta${resumo.faltam > 1 ? "m" : ""} ${resumo.faltam}.`;
}

/** Por que "Enviar para aprovação final" ainda não pode; null quando pode. */
export function motivoSemAprovacaoFinal(resumo: ResumoOrcamentos): string | null {
  return motivoSemCotacoesRecebidas(resumo) ?? (resumo.escolhido ? null : "Escolha um dos orçamentos antes de enviar para a aprovação final.");
}
