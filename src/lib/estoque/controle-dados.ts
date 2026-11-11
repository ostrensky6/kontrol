import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { LoteRow } from "@/components/estoque/EstoqueTables";
import {
  loteBaixaDeDb,
  loteVencido,
  somarReservasPorLote,
  type LoteBaixa,
  type LoteDbBaixa,
} from "@/lib/estoque/baixa";
import { avisosDoInsumo, resumirSinais, type AvisoDb, type AvisoInsumo, type ResumoSinais } from "@/lib/estoque/controle-estoque";
import { ROTULO_STATUS_LOTE } from "@/lib/estoque/ficha-insumo";
import { janelaVencimentoDias, loteVenceEmBreve } from "@/lib/estoque/situacao-insumo";
import { formatDate, formatNumber } from "@/lib/formatters";
import { noGlossario } from "@/lib/glossario";
import { lerTudo } from "@/lib/supabase/ler-tudo";
import {
  montarEstoqueDisponivel,
  type AlertaDisponivelDb,
  type LinhaEstoqueDisponivel,
  type PrevisaoDisponivelDb,
  type SaldoDisponivelDb,
} from "@/lib/suprimentos/estoque-disponivel";

/**
 * Leitura do controle do estoque (visões por insumo e por lote da Situação
 * do estoque). As linhas são as mesmas de Estoque → Saldo e lotes
 * (montarEstoqueDisponivel): o mesmo insumo nunca aparece com situação
 * diferente em telas diferentes. A contagem do Início sai da mesma leitura.
 */

type SaldoControleDb = SaldoDisponivelDb & { categoria_compra?: string | null; modelo_quantidade?: string | null };
type AlertaControleDb = AlertaDisponivelDb & { validade?: string | null };
type LoteControleDb = LoteDbBaixa & {
  insumo_id: number;
  conteudo_embalagem_snapshot?: number | null;
  recebido_por_id?: string | null;
  insumos: { especificacao: string | null; unidade: string | null; categoria_compra: string | null } | null;
};
type ReservaDb = { lote_id: number | null; quantidade: number | null; quantidade_consumida: number | null; status: string | null };

export type InsumoControle = LinhaEstoqueDisponivel & {
  /** categoria de compra do cadastro: critico, operacional ou eventual */
  categoriaCompra: string | null;
  /** unidade física do cadastro (mL, g…), para a baixa */
  unidadeFisica: string;
  lotesBaixa: LoteBaixa[];
  avisos: AvisoInsumo[];
  /** lotes vencidos ou vencendo do insumo, com a data */
  validades: { tipo: "vencido" | "vencimento"; validade: string | null }[];
};

export type LoteControle = LoteRow & { insumoId: number; vencendo: boolean };

type LeituraBase = {
  saldo: SaldoControleDb[];
  alertas: AlertaControleDb[];
  previsao: PrevisaoDisponivelDb[];
  lotes: LoteControleDb[];
  janelaVencimento: number;
  erros: string[];
};

/** Saldo, alertas, previsão e lotes: o que a contagem e a tela usam. */
async function lerBase(supabase: SupabaseClient): Promise<LeituraBase> {
  const [saldo, alertas, previsao, lotes, parametros] = await Promise.all([
    // listas lidas de mil em mil (o PostgREST corta em 1.000 linhas)
    lerTudo<SaldoControleDb>((de, ate) =>
      supabase.from("v_estoque_saldo").select("*").order("especificacao").order("insumo_id").range(de, ate),
    ),
    lerTudo<AlertaControleDb>((de, ate) =>
      supabase
        .from("v_alertas_estoque")
        .select("insumo_id, tipo, validade, lote_id")
        .order("tipo")
        .order("insumo_id")
        .order("lote_id")
        .range(de, ate),
    ),
    // a mesma previsão de Saldo e lotes: a caminho, aguardando aprovação e repor
    lerTudo<PrevisaoDisponivelDb>((de, ate) =>
      supabase
        .from("v_previsao_suprimentos")
        .select("insumo_id, qtd_sugerida_compra, qtd_pedida_aberta, qtd_pedida_pendente")
        .order("insumo_id")
        .range(de, ate),
    ),
    lerTudo<LoteControleDb>((de, ate) =>
      supabase
        .from("lotes_estoque")
        .select(
          "id, insumo_id, codigo_lote, validade, validade_apos_abertura, quantidade_atual, status, modelo_quantidade, conteudo_embalagem_snapshot, recebido_por_id, insumos(especificacao, unidade, categoria_compra)",
        )
        .not("status", "in", "(consumido,descartado)")
        .order("validade", { nullsFirst: false })
        .order("id")
        .range(de, ate),
    ),
    // janela do "vence em breve": a mesma de v_alertas_estoque (padrão 60 dias)
    supabase.from("parametros").select("chave, valor").eq("chave", "janela_vencimento_dias"),
  ]);
  const erros = [
    saldo.error && `saldo: ${saldo.error.message}`,
    alertas.error && `alertas: ${alertas.error.message}`,
    previsao.error && `previsão de compra: ${previsao.error.message}`,
    lotes.error && `lotes: ${lotes.error.message}`,
  ].filter((erro): erro is string => Boolean(erro));
  return {
    saldo: saldo.data,
    alertas: alertas.data,
    previsao: previsao.data,
    lotes: lotes.data,
    janelaVencimento: janelaVencimentoDias((parametros.data as { valor: unknown }[] | null)?.[0]?.valor),
    erros,
  };
}

function montarLinhas(base: LeituraBase, hoje: string): LinhaEstoqueDisponivel[] {
  return montarEstoqueDisponivel({
    saldo: base.saldo,
    previsao: base.previsao,
    alertas: base.alertas,
    lotes: base.lotes.map((lote) => ({
      insumo_id: Number(lote.insumo_id),
      validade: lote.validade ?? null,
      validade_apos_abertura: lote.validade_apos_abertura ?? null,
      quantidade_atual: lote.quantidade_atual,
      status: lote.status,
    })),
    hoje,
    janelaVencimento: base.janelaVencimento,
  });
}

/**
 * Contagem dos sinais do estoque para o Início. Não lança: leitura que falha
 * devolve null e a tela mostra "sem dado", nunca zero.
 */
export async function contarSinaisEstoque(supabase: SupabaseClient, hoje: string): Promise<ResumoSinais | null> {
  try {
    const base = await lerBase(supabase);
    if (base.erros.length > 0) return null;
    return resumirSinais(montarLinhas(base, hoje));
  } catch {
    return null;
  }
}

export type ControleEstoque = {
  insumos: InsumoControle[];
  lotes: LoteControle[];
  /** null = alertas ou previsão não foram lidos: os números ficam "sem dado", nunca menores do que são */
  resumo: ResumoSinais | null;
  /** false = os avisos não foram lidos: o filtro de avisos fica sem dado */
  avisosLidos: boolean;
  /** parte da leitura falhou: a tela avisa em vez de mostrar número menor */
  erro: string | null;
};

export async function carregarControleEstoque(
  supabase: SupabaseClient,
  hoje: string,
  usuario: { id: string; papel: string | null } | null,
): Promise<ControleEstoque> {
  const [base, reservas, vinculosCompra, vinculosInternos, avisosResp] = await Promise.all([
    lerBase(supabase),
    lerTudo<ReservaDb>((de, ate) =>
      supabase
        .from("reservas_estoque")
        .select("id, lote_id, quantidade, quantidade_consumida, status")
        .in("status", ["reservado", "parcial"])
        .order("id")
        .range(de, ate),
    ),
    lerTudo<{ lote_id: number | null }>((de, ate) =>
      supabase.from("pedidos_compra_item_recebimentos").select("id, lote_id").order("id").range(de, ate),
    ),
    lerTudo<{ lote_id: number | null }>((de, ate) =>
      supabase.from("pedidos_internos_item_recebimentos").select("id, lote_id").order("id").range(de, ate),
    ),
    // os avisos de quem está logado, com o estado de leitura dele (0128)
    supabase
      .from("v_minhas_notificacoes")
      .select("id, titulo, corpo, entidade_tipo, entidade_id, status, criado_em")
      .neq("status", "arquivada")
      .order("criado_em", { ascending: false })
      .limit(500),
  ]);
  // sem saldo ou sem lotes não há o que mostrar; reserva não lida não pode virar "nada reservado"
  const saldoOuLotes = base.erros.find((erro) => erro.startsWith("saldo:") || erro.startsWith("lotes:"));
  if (saldoOuLotes) throw new Error(`Não foi possível ler o estoque (${saldoOuLotes}).`);
  if (reservas.error) throw new Error(`Não foi possível ler as reservas do estoque: ${reservas.error.message}`);

  const reservadoPorLote = somarReservasPorLote(reservas.data);
  // estorno direto só quando é comprovado que o lote não veio de um pedido (mesma regra de Saldo e lotes)
  const origemEstornoComprovada = !vinculosCompra.error && !vinculosInternos.error;
  const lotesVinculados = new Set([...vinculosCompra.data, ...vinculosInternos.data].map((r) => Number(r.lote_id)));
  // avisos gravados pelo banco ainda trazem palavras antigas: o glossário vale aqui também
  const avisos = ((avisosResp.data ?? []) as AvisoDb[]).map((aviso) => ({
    ...aviso,
    titulo: noGlossario(aviso.titulo),
    corpo: noGlossario(aviso.corpo),
  }));

  const linhas = montarLinhas(base, hoje);
  const saldoPorInsumo = new Map(base.saldo.map((s) => [Number(s.insumo_id), s]));
  const ativos = new Set(linhas.map((linha) => linha.insumoId));
  const lotesBaixaPorInsumo = new Map<number, LoteBaixa[]>();
  for (const lote of base.lotes) {
    if (!(Number(lote.quantidade_atual ?? 0) > 0)) continue;
    const id = Number(lote.insumo_id);
    lotesBaixaPorInsumo.set(id, [...(lotesBaixaPorInsumo.get(id) ?? []), loteBaixaDeDb(lote, reservadoPorLote)]);
  }
  const validadesPorInsumo = new Map<number, InsumoControle["validades"]>();
  for (const alerta of base.alertas) {
    if (alerta.tipo !== "vencido" && alerta.tipo !== "vencimento") continue;
    const id = Number(alerta.insumo_id);
    validadesPorInsumo.set(id, [...(validadesPorInsumo.get(id) ?? []), { tipo: alerta.tipo, validade: alerta.validade ?? null }]);
  }

  const insumos: InsumoControle[] = linhas.map((linha) => {
    const saldo = saldoPorInsumo.get(linha.insumoId);
    return {
      ...linha,
      categoriaCompra: saldo?.categoria_compra ?? null,
      unidadeFisica: saldo?.unidade ?? "",
      lotesBaixa: lotesBaixaPorInsumo.get(linha.insumoId) ?? [],
      avisos: avisosDoInsumo(avisos, linha.insumoId, linha.especificacao),
      validades: validadesPorInsumo.get(linha.insumoId) ?? [],
    };
  });

  const lotes: LoteControle[] = base.lotes
    // lotes com saldo de insumos ativos: é o que pode vencer, ser baixado ou bloqueado
    .filter((lote) => ativos.has(Number(lote.insumo_id)) && Number(lote.quantidade_atual ?? 0) > 0)
    .map((lote) => {
      const baixa = loteBaixaDeDb(lote, reservadoPorLote);
      const unidade = lote.insumos?.unidade ?? "";
      return {
        id: lote.id,
        insumoId: Number(lote.insumo_id),
        especificacao: lote.insumos?.especificacao ?? "—",
        unidade:
          baixa.modeloQuantidade === "EMBALAGEM_FECHADA"
            ? `frasco(s)${lote.conteudo_embalagem_snapshot ? ` de ${formatNumber(lote.conteudo_embalagem_snapshot)} ${unidade}`.trimEnd() : ""}`
            : unidade,
        codigoLote: lote.codigo_lote ?? "—",
        validade: baixa.validade ? formatDate(baixa.validade) : "—",
        validadeIso: baixa.validade,
        quantidadeAtual: baixa.quantidadeAtual,
        reservado: baixa.reservado,
        modeloQuantidade: baixa.modeloQuantidade,
        status: lote.status,
        statusLabel: ROTULO_STATUS_LOTE[lote.status] ?? lote.status,
        vencido: loteVencido(baixa.validade, hoje),
        // baixa.validade já é a menor entre a do fabricante e a após abertura
        vencendo: loteVenceEmBreve(baixa.validade, hoje, base.janelaVencimento),
        critico: lote.insumos?.categoria_compra === "critico",
        estornoDiretoPermitido: origemEstornoComprovada && !lotesVinculados.has(Number(lote.id)),
        // dupla conferência: quem registrou a chegada não aceita o próprio lote (admin isento)
        aceiteBloqueadoMotivo:
          usuario && lote.recebido_por_id && lote.recebido_por_id === usuario.id && usuario.papel !== "admin"
            ? "Você registrou a chegada; o aceite fica com outra pessoa."
            : null,
      };
    });

  const parciais = [
    ...base.erros,
    avisosResp.error && `avisos: ${avisosResp.error.message}`,
  ].filter((erro): erro is string => Boolean(erro));
  return {
    insumos,
    lotes,
    // os sinais dependem do saldo, dos alertas e da previsão: faltando um deles, a conta não vale
    resumo: base.erros.length === 0 ? resumirSinais(linhas) : null,
    avisosLidos: !avisosResp.error,
    erro: parciais.length ? `Parte da leitura não carregou: ${parciais.join("; ")}` : null,
  };
}
