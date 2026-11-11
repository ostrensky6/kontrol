import "server-only";

import { pode } from "@/lib/auth/permissao-efetiva";
import { hojeIso } from "@/lib/estoque/baixa";
import { janelaVencimentoDias } from "@/lib/estoque/situacao-insumo";
import { lerTudo } from "@/lib/supabase/ler-tudo";
import { createClientUntyped } from "@/lib/supabase/server";
import { lerACaminho, type ItemACaminho } from "@/lib/suprimentos/a-caminho";
import type { AlertaDisponivelDb } from "@/lib/suprimentos/estoque-disponivel";

import {
  montarFichaInsumo,
  type AnaliseFichaDb,
  type FichaInsumo,
  type ItemPedidoFichaDb,
  type LoteFichaDb,
  type MovimentoFichaDb,
  type PedidoFichaDb,
  type PlanoFichaDb,
  type PrevisaoFichaDb,
  type ReservaFichaDb,
  type SaldoFichaDb,
} from "./ficha-insumo";

/**
 * Leitura da ficha do insumo (F5). Cada bloco é lido só com a permissão de quem
 * o vê nas outras telas (pedidos, compras, planos, análises) e, quando a
 * leitura falha, o bloco fica marcado como "sem dado": zero só aparece quando
 * o banco respondeu zero.
 */

export type InsumoDaFicha = {
  id: number;
  especificacao: string;
  nomeItem: string | null;
  codigoInterno: string | null;
  fabricante: string | null;
  unidade: string | null;
  ativo: boolean;
};

export type BlocoDaFicha = "saldo" | "previsao" | "lotes" | "reservas" | "pedidos" | "compras" | "analises" | "movimentos";

export type DadosFichaInsumo = {
  insumo: InsumoDaFicha;
  ficha: FichaInsumo;
  /** blocos que o banco não respondeu */
  semDado: Record<BlocoDaFicha, boolean>;
  /** o que este usuário pode ver e abrir a partir da ficha */
  pode: { pedidos: boolean; compras: boolean; planos: boolean; analises: boolean; cadastro: boolean };
};

type InsumoDb = {
  id: number;
  especificacao: string | null;
  nome_item: string | null;
  codigo_interno: string | null;
  fabricante: string | null;
  unidade: string | null;
  ativo: boolean | null;
};

const vazio = <T,>() => Promise.resolve({ data: [] as T[], error: null as { message: string } | null });

export async function lerFichaInsumo(insumoId: number): Promise<DadosFichaInsumo | null> {
  const supabase = await createClientUntyped();

  const { data: insumoRaw, error: insumoError } = await supabase
    .from("insumos")
    .select("id, especificacao, nome_item, codigo_interno, fabricante, unidade, ativo")
    .eq("id", insumoId)
    .maybeSingle();
  if (insumoError) throw new Error(`Não foi possível ler o insumo: ${insumoError.message}`);
  if (!insumoRaw) return null;
  const insumoDb = insumoRaw as InsumoDb;

  const [podePedidos, podeCompras, podePlanos, podeAnalises, podeCadastro] = await Promise.all([
    pode("pedido.ver"),
    pode("compras.ver"),
    pode("planejamento.ver"),
    pode("analises.ver"),
    pode("cadastros.ver"),
  ]);

  const hoje = hojeIso();
  const [saldoResp, previsaoResp, alertasResp, lotesResp, reservasResp, itensResp, comprasResp, analisesResp, movimentosResp, parametrosResp] =
    await Promise.all([
      supabase
        .from("v_estoque_saldo")
        .select("insumo_id, especificacao, unidade, unidade_saldo, tipo_insumo, em_maos, reservado, disponivel, ponto_reposicao, em_quarentena, bloqueado")
        .eq("insumo_id", insumoId)
        .maybeSingle(),
      supabase
        .from("v_previsao_suprimentos")
        .select("insumo_id, qtd_sugerida_compra, qtd_pedida_aberta, qtd_pedida_pendente, lead_time_dias, dias_cobertura")
        .eq("insumo_id", insumoId)
        .maybeSingle(),
      supabase.from("v_alertas_estoque").select("insumo_id, tipo").eq("insumo_id", insumoId),
      lerTudo<LoteFichaDb>((de, ate) =>
        supabase
          .from("lotes_estoque")
          .select("id, codigo_lote, validade, validade_apos_abertura, quantidade_atual, status, fornecedor, nota_fiscal")
          .eq("insumo_id", insumoId)
          .not("status", "in", "(consumido,descartado)")
          .order("id")
          .range(de, ate),
      ),
      lerTudo<ReservaFichaDb>((de, ate) =>
        supabase
          .from("reservas_estoque")
          .select("id, lote_id, planejamento_id, quantidade, quantidade_consumida, status")
          .eq("insumo_id", insumoId)
          .in("status", ["reservado", "parcial"])
          .order("id")
          .range(de, ate),
      ),
      podePedidos
        ? lerTudo<ItemPedidoFichaDb>((de, ate) =>
            supabase
              .from("pedidos_internos_itens")
              .select("id, pedido_interno_id, quantidade, unidade, recebido_em")
              .eq("insumo_id", insumoId)
              .is("recebido_em", null)
              .order("id")
              .range(de, ate),
          )
        : vazio<ItemPedidoFichaDb>(),
      podeCompras ? lerACaminho(supabase, hoje, insumoId) : Promise.resolve({ itens: [] as ItemACaminho[], erro: null }),
      podeAnalises
        ? supabase
            .from("insumo_analise")
            .select("codigo_analise, nome_etapa, nome_atividade, quantidade_por_amostra, unidade")
            .eq("insumo_id", insumoId)
        : vazio<AnaliseFichaDb>(),
      supabase
        .from("estoque_movimentacoes")
        .select("id, data, tipo, quantidade, motivo, lote_id")
        .eq("insumo_id", insumoId)
        .order("data", { ascending: false })
        .order("id", { ascending: false })
        .limit(8),
      // janela do "vence em breve": a mesma de v_alertas_estoque (padrão 60 dias)
      supabase.from("parametros").select("chave, valor").eq("chave", "janela_vencimento_dias"),
    ]);

  const reservas = reservasResp.data ?? [];
  const itensPedido = itensResp.data ?? [];
  const pedidoIds = [...new Set(itensPedido.map((item) => item.pedido_interno_id).filter((id): id is number => id != null))];
  const planoIds = [...new Set(reservas.map((r) => r.planejamento_id).filter((id): id is number => id != null))];

  const [pedidosResp, planosResp] = await Promise.all([
    pedidoIds.length
      ? supabase
          .from("pedidos_internos")
          .select("id, titulo, status, natureza, aprovacao_area_em, pedido_compra_id")
          .in("id", pedidoIds)
      : vazio<PedidoFichaDb>(),
    // sem a permissão de Planejamento a reserva aparece só com o número do plano
    podePlanos && planoIds.length
      ? supabase.from("planejamento").select("id, nome").in("id", planoIds)
      : vazio<PlanoFichaDb>(),
  ]);

  const saldo = (saldoResp.data ?? null) as SaldoFichaDb | null;
  const ficha = montarFichaInsumo({
    saldo,
    previsao: (previsaoResp.data ?? null) as PrevisaoFichaDb | null,
    alertas: (alertasResp.data ?? []) as AlertaDisponivelDb[],
    lotes: lotesResp.data ?? [],
    reservas,
    planos: (planosResp.data ?? []) as PlanoFichaDb[],
    itensPedido,
    pedidos: (pedidosResp.data ?? []) as PedidoFichaDb[],
    compras: comprasResp.itens,
    analises: (analisesResp.data ?? []) as AnaliseFichaDb[],
    movimentos: (movimentosResp.data ?? []) as MovimentoFichaDb[],
    hoje,
    janelaVencimento: janelaVencimentoDias((parametrosResp.data as { valor: unknown }[] | null)?.[0]?.valor),
  });

  return {
    insumo: {
      id: insumoDb.id,
      especificacao: insumoDb.especificacao?.trim() || insumoDb.nome_item?.trim() || `Insumo #${insumoDb.id}`,
      nomeItem: insumoDb.nome_item?.trim() || null,
      codigoInterno: insumoDb.codigo_interno?.trim() || null,
      fabricante: insumoDb.fabricante?.trim() || null,
      unidade: insumoDb.unidade?.trim() || null,
      ativo: insumoDb.ativo !== false,
    },
    ficha,
    semDado: {
      // a view de saldo tem uma linha por insumo; sem linha, não há número para mostrar
      saldo: Boolean(saldoResp.error) || !saldo,
      previsao: Boolean(previsaoResp.error) || !previsaoResp.data,
      // reserva não lida não pode virar "nada reservado" no lote
      lotes: Boolean(lotesResp.error) || Boolean(reservasResp.error),
      reservas: Boolean(reservasResp.error),
      pedidos: Boolean(itensResp.error) || Boolean(pedidosResp.error),
      compras: Boolean(comprasResp.erro),
      analises: Boolean(analisesResp.error),
      movimentos: Boolean(movimentosResp.error),
    },
    pode: { pedidos: podePedidos, compras: podeCompras, planos: podePlanos, analises: podeAnalises, cadastro: podeCadastro },
  };
}
