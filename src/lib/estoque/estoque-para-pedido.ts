import type { SupabaseClient } from "@supabase/supabase-js";

import { lerTudo } from "@/lib/supabase/ler-tudo";
import { separarPedidoAberto } from "@/lib/suprimentos/pedido-aberto";

/**
 * Estoque de um insumo na hora de pedir: disponível, reservado, a caminho e
 * onde está guardado. Disponível e reservado vêm de v_estoque_saldo (a mesma
 * leitura do Estoque); "a caminho" é a parte do pedido aberto de
 * v_previsao_suprimentos já comprada ou autorizada (só o que falta receber); o
 * que ainda espera aprovação fica à parte. Nada é somado duas vezes.
 */
type Numerico = number | string | null | undefined;

export type SaldoPedidoDb = { insumo_id: number; disponivel: Numerico; reservado: Numerico; unidade_saldo: string | null; unidade: string | null };
export type PrevisaoPedidoDb = {
  insumo_id: number;
  qtd_pedida_aberta: Numerico;
  qtd_pedida_pendente?: Numerico;
  qtd_compra_atrasada: Numerico;
};
export type LoteLocalDb = {
  insumo_id: number;
  status: string | null;
  quantidade_atual: Numerico;
  locais?: { nome: string | null } | { nome: string | null }[] | null;
};

export type EstoqueParaPedido = {
  disponivel: number | null;
  reservado: number;
  /** comprado ou autorizado, ainda não recebido */
  aCaminho: number;
  /** pedido que ainda espera aprovação: não garante entrega */
  aguardandoAprovacao: number;
  aCaminhoAtrasado: number;
  unidade: string | null;
  locais: string[];
};

/** Lotes que ainda contam como estoque guardado (não consumidos nem descartados). */
const STATUS_GUARDADO = new Set(["quarentena", "aceito", "em_uso", "bloqueado"]);

function num(valor: Numerico) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function nomeLocal(lote: LoteLocalDb) {
  const local = Array.isArray(lote.locais) ? lote.locais[0] : lote.locais;
  return local?.nome?.trim() || null;
}

export function montarEstoqueParaPedido(
  saldos: SaldoPedidoDb[],
  previsoes: PrevisaoPedidoDb[],
  lotes: LoteLocalDb[],
): Map<number, EstoqueParaPedido> {
  const mapa = new Map<number, EstoqueParaPedido>();
  const garantir = (id: number) => {
    let atual = mapa.get(id);
    if (!atual) {
      atual = { disponivel: null, reservado: 0, aCaminho: 0, aguardandoAprovacao: 0, aCaminhoAtrasado: 0, unidade: null, locais: [] };
      mapa.set(id, atual);
    }
    return atual;
  };
  for (const s of saldos) {
    const e = garantir(s.insumo_id);
    e.disponivel = num(s.disponivel);
    e.reservado = num(s.reservado);
    e.unidade = s.unidade_saldo ?? s.unidade ?? null;
  }
  for (const p of previsoes) {
    const e = garantir(p.insumo_id);
    const pedido = separarPedidoAberto(p.qtd_pedida_aberta, p.qtd_pedida_pendente);
    e.aCaminho = pedido.aCaminho ?? 0;
    e.aguardandoAprovacao = pedido.aguardandoAprovacao ?? 0;
    e.aCaminhoAtrasado = num(p.qtd_compra_atrasada);
  }
  for (const l of lotes) {
    if (!STATUS_GUARDADO.has(l.status ?? "") || !(num(l.quantidade_atual) > 0)) continue;
    const nome = nomeLocal(l) ?? "Sem local informado";
    const e = garantir(l.insumo_id);
    if (!e.locais.includes(nome)) e.locais.push(nome);
  }
  for (const e of mapa.values()) e.locais.sort((a, b) => a.localeCompare(b, "pt-BR"));
  return mapa;
}

export async function lerEstoqueParaPedido(supabase: SupabaseClient) {
  const [saldos, previsoes, lotes] = await Promise.all([
    lerTudo<SaldoPedidoDb>((de, ate) =>
      supabase.from("v_estoque_saldo").select("insumo_id, disponivel, reservado, unidade_saldo, unidade").order("insumo_id").range(de, ate),
    ),
    lerTudo<PrevisaoPedidoDb>((de, ate) =>
      supabase
        .from("v_previsao_suprimentos")
        .select("insumo_id, qtd_pedida_aberta, qtd_pedida_pendente, qtd_compra_atrasada")
        .order("insumo_id")
        .range(de, ate),
    ),
    lerTudo<LoteLocalDb & { id: number }>((de, ate) =>
      supabase
        .from("lotes_estoque")
        .select("id, insumo_id, status, quantidade_atual, locais(nome)")
        .gt("quantidade_atual", 0)
        .order("id")
        .range(de, ate),
    ),
  ]);
  return {
    estoque: montarEstoqueParaPedido(saldos.data, previsoes.data, lotes.data),
    erro: [saldos, previsoes, lotes].some((r) => r.error) ? "Parte do estoque não carregou." : null,
  };
}
