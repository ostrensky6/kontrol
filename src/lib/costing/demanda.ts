import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { consumoInsumo, gargalo, insumosSelecionados, type Etapa, type InsumoLinha } from "./engine";

export type DemandaLinha = {
  insumo_id: number;
  especificacao: string;
  unidade: string | null;
  demanda: number;
  disponivel: number;
  falta: number;
  custoUnitario: number | null;
  custoEstimado: number;
  quantidadeMinimaCompra: number | null;
  quantidadeEmbalagem: number | null;
  quantidadeCompra: number;
  valorCompraEstimado: number;
};

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const numOrNull = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function arredondarQuantidadeCompra(
  falta: number,
  quantidadeMinimaCompra: number | null,
  quantidadeEmbalagem: number | null,
) {
  if (!(falta > 0)) return 0;
  const multiplo = quantidadeMinimaCompra ?? quantidadeEmbalagem;
  if (!(multiplo && multiplo > 0)) return falta;
  return Math.ceil(falta / multiplo) * multiplo;
}

/**
 * Demanda de insumos de um plano: nº de amostras × consumo/amostra, somando
 * todas as análises do plano. Reusa a seleção de grupo e a lógica por_execucao
 * da engine de custeio, garantindo coerência entre custo e consumo.
 */
export async function computarDemandaPlano(
  supabase: SupabaseClient,
  planId: number,
): Promise<DemandaLinha[]> {
  const { data: itens } = await supabase
    .from("planejamento_itens")
    .select("codigo_analise, n_amostras, n_controles, repeticoes, perda_percentual")
    .eq("planejamento_id", planId);

  if (!itens || itens.length === 0) return [];

  const codigos = [...new Set(itens.map((i) => i.codigo_analise as string))];
  const [{ data: etapas }, { data: ia }] = await Promise.all([
    supabase.from("etapas").select("*").in("codigo_analise", codigos),
    supabase
      .from("insumo_analise")
      .select(
        "codigo_analise, nome_etapa, nome_atividade, especificacao_insumo, grupo_escolha, quantidade_por_amostra, modo_cobranca, insumo_id, insumos(custo_unitario)",
      )
      .in("codigo_analise", codigos),
  ]);

  // agrega demanda por insumo_id
  const agg = new Map<number, { especificacao: string; demanda: number }>();

  for (const item of itens) {
    const codigo = item.codigo_analise as string;
    // N efetivo = (amostras + controles) × repetições × (1 + perda%)
    const repeticoes = num(item.repeticoes) || 1;
    const perda = num(item.perda_percentual) / 100;
    const n = (num(item.n_amostras) + num(item.n_controles)) * repeticoes * (1 + perda);
    const et = ((etapas ?? []) as Etapa[]).filter(
      (e) => (e as unknown as { codigo_analise: string }).codigo_analise === codigo,
    );
    const lote = gargalo(et).amostrasPorExecucao;

    const linhas: InsumoLinha[] = ((ia ?? []) as unknown[])
      .filter((x) => (x as { codigo_analise: string }).codigo_analise === codigo)
      .map((x) => {
        const r = x as {
          nome_etapa: string;
          nome_atividade: string;
          especificacao_insumo: string | null;
          grupo_escolha: string | null;
          quantidade_por_amostra: number | null;
          modo_cobranca: string | null;
          insumo_id: number | null;
          insumos: { custo_unitario: number | null } | null;
        };
        return {
          nome_etapa: r.nome_etapa,
          nome_atividade: r.nome_atividade,
          especificacao_insumo: r.especificacao_insumo,
          grupo_escolha: r.grupo_escolha,
          quantidade_por_amostra: r.quantidade_por_amostra,
          modo_cobranca: r.modo_cobranca,
          custo_unitario: r.insumos?.custo_unitario ?? null,
          insumo_id: r.insumo_id,
        };
      });

    for (const l of insumosSelecionados(linhas)) {
      if (l.insumo_id == null) continue;
      const qty = consumoInsumo(l, n, lote > 0 ? Math.ceil(n / lote) : 1);
      const cur = agg.get(l.insumo_id) ?? {
        especificacao: l.especificacao_insumo ?? "",
        demanda: 0,
      };
      cur.demanda += qty;
      agg.set(l.insumo_id, cur);
    }
  }

  const ids = [...agg.keys()];
  if (ids.length === 0) return [];

  const [{ data: saldo, error: saldoError }, { data: saldoUnidade, error: saldoUnidadeError }, { data: insumos }, { data: reservasPlano, error: reservasError }] =
    await Promise.all([
      supabase.from("v_estoque_saldo").select("insumo_id, unidade, disponivel").in("insumo_id", ids),
      supabase
        .from("v_estoque_disponivel_unidade")
        .select("insumo_id, disponivel_unidade")
        .in("insumo_id", ids),
      supabase
        .from("insumos")
        .select("id, fator_conversao, custo_unitario, quantidade_minima_compra, quantidade_embalagem")
        .in("id", ids),
      supabase
        .from("reservas_estoque")
        .select("insumo_id, quantidade, quantidade_consumida, lote_id")
        .eq("planejamento_id", planId)
        .in("status", ["reservado", "parcial"])
        .in("insumo_id", ids),
    ]);
  // saldo ou reserva não lidos não podem virar zero: o plano mostraria falta que não existe
  const erroLeitura = saldoError ?? saldoUnidadeError ?? reservasError;
  if (erroLeitura) throw new Error(`Não foi possível ler saldo e reservas do estoque: ${erroLeitura.message}`);
  const sMap = new Map(
    (saldo ?? []).map((s) => [s.insumo_id as number, s as { unidade: string | null; disponivel: number }]),
  );
  // Lotes de embalagens fechadas contam embalagens; o planejamento compara na
  // unidade física (embalagens × conteúdo). v_estoque_saldo soma a contagem crua.
  const disponivelUnidade = new Map(
    (saldoUnidade ?? []).map((s) => [s.insumo_id as number, num(s.disponivel_unidade)]),
  );
  const loteIds = [
    ...new Set((reservasPlano ?? []).map((r) => r.lote_id).filter((id) => id != null)),
  ] as number[];
  const conteudoLote = new Map<number, number>();
  if (loteIds.length > 0) {
    const { data: lotes } = await supabase
      .from("lotes_estoque")
      .select("id, modelo_quantidade, conteudo_embalagem_snapshot")
      .in("id", loteIds);
    for (const lote of lotes ?? []) {
      if (lote.modelo_quantidade === "EMBALAGEM_FECHADA") {
        conteudoLote.set(lote.id as number, num(lote.conteudo_embalagem_snapshot) || 1);
      }
    }
  }
  const rMap = new Map<number, number>();
  for (const reserva of reservasPlano ?? []) {
    if (reserva.lote_id == null) continue;
    const id = reserva.insumo_id as number;
    const conteudo = conteudoLote.get(reserva.lote_id as number) ?? 1;
    rMap.set(
      id,
      (rMap.get(id) ?? 0) + (num(reserva.quantidade) - num(reserva.quantidade_consumida)) * conteudo,
    );
  }
  // 2.5 — ponte de unidades: a demanda é calculada em unidades de CONSUMO; o
  // estoque está em unidades de ESTOQUE. Converte antes de comparar/reservar.
  const infoMap = new Map(
    (insumos ?? []).map((c) => [
      c.id as number,
      {
        fatorConversao: num(c.fator_conversao) || 1,
        custoUnitario: numOrNull(c.custo_unitario),
        quantidadeMinimaCompra: numOrNull(c.quantidade_minima_compra),
        quantidadeEmbalagem: numOrNull(c.quantidade_embalagem),
      },
    ]),
  );

  return ids
    .map((id) => {
      const d = agg.get(id)!;
      const s = sMap.get(id);
      const info = infoMap.get(id);
      const fator = info?.fatorConversao || 1;
      const demanda = fator > 0 ? d.demanda / fator : d.demanda;
      const disponivel = Math.max(0, disponivelUnidade.get(id) ?? num(s?.disponivel));
      const reservadoPlano = rMap.get(id) ?? 0;
      const falta = Math.max(0, demanda - reservadoPlano - disponivel);
      const quantidadeCompra = arredondarQuantidadeCompra(
        falta,
        info?.quantidadeMinimaCompra ?? null,
        info?.quantidadeEmbalagem ?? null,
      );
      const custoUnitario = info?.custoUnitario ?? null;
      return {
        insumo_id: id,
        especificacao: d.especificacao,
        unidade: s?.unidade ?? null,
        demanda,
        disponivel,
        falta,
        custoUnitario,
        custoEstimado: custoUnitario == null ? 0 : demanda * custoUnitario,
        quantidadeMinimaCompra: info?.quantidadeMinimaCompra ?? null,
        quantidadeEmbalagem: info?.quantidadeEmbalagem ?? null,
        quantidadeCompra,
        valorCompraEstimado: custoUnitario == null ? 0 : quantidadeCompra * custoUnitario,
      };
    })
    .sort((a, b) => b.falta - a.falta || a.especificacao.localeCompare(b.especificacao));
}
