import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  linhasDeAtencao,
  montarAlertas,
  montarDecisao,
  resumirAlertas,
  type AlertaPainelDb,
  type CustoPainelDb,
  type LinhaAtencao,
  type LotePainelDb,
  type PrevisaoPainelDb,
  type ResumoAlertas,
} from "@/lib/cadastros/painel-decisao";
import {
  inicioJanelaMeses,
  montarInsumosPainel,
  type InsumoPainelDb,
  type MovimentoPainelDb,
  type SaldoPainelDb,
} from "@/lib/cadastros/painel-insumos";
import { lerTudo } from "@/lib/supabase/ler-tudo";

/**
 * Leitura do painel único de situação do estoque (revisão de 11/11, D1 e L1).
 * A tela Situação (Suprimentos › Estoque) mostra o painel inteiro; o Início e
 * Cadastros mostram só a contagem, feita com as mesmas regras, para o número
 * de um lugar nunca discordar do outro.
 */
export async function carregarSituacaoEstoque(
  supabase: SupabaseClient,
  hoje: string,
  /** `contagem`: pula o histórico de 12 meses e os custos, que só os gráficos e o "Estoque parado" usam */
  { para = "painel" }: { para?: "painel" | "contagem" } = {},
) {
  const completo = para === "painel";
  const inicio = inicioJanelaMeses(hoje, 12);
  const naoLido = <T,>() => Promise.resolve({ data: [] as T[], error: null as { message: string } | null });
  const [insumos, saldos, movimentos, previsoes, custos, alertas, lotes] = await Promise.all([
    lerTudo<InsumoPainelDb>((de, ate) =>
      supabase
        .from("insumos")
        .select("id, especificacao, nome_item, categoria_compra, fabricante, codigo_fabricante, unidade, ponto_reposicao")
        .eq("ativo", true)
        .order("id")
        .range(de, ate),
    ),
    lerTudo<SaldoPainelDb>((de, ate) =>
      supabase.from("v_estoque_saldo").select("insumo_id, disponivel, em_maos, unidade_saldo, unidade").order("insumo_id").range(de, ate),
    ),
    completo
      ? lerTudo<MovimentoPainelDb>((de, ate) =>
          supabase
            .from("estoque_movimentacoes")
            // ajustes entram só para o gráfico: o que desfaz uma leitura anula a entrada ou a saída
            .select("insumo_id, tipo, data, motivo")
            .in("tipo", ["entrada", "saida", "ajuste"])
            .gte("data", inicio)
            .order("id")
            .range(de, ate),
        )
      : naoLido<MovimentoPainelDb>(),
    // previsão de compra e cobertura: a mesma regra do "Repor" do Estoque
    lerTudo<PrevisaoPainelDb>((de, ate) =>
      supabase
        .from("v_previsao_suprimentos")
        .select("insumo_id, qtd_sugerida_compra, qtd_pedida_aberta, qtd_pedida_pendente, qtd_compra_atrasada, compra_atrasada_desde, consumo_medio_diario, dias_cobertura, lead_time_dias")
        .order("insumo_id")
        .range(de, ate),
    ),
    completo
      ? lerTudo<CustoPainelDb>((de, ate) =>
          supabase.from("v_custo_estoque_vigente").select("insumo_id, valor_liberado").order("insumo_id").range(de, ate),
        )
      : naoLido<CustoPainelDb>(),
    lerTudo<AlertaPainelDb>((de, ate) =>
      supabase
        .from("v_alertas_estoque")
        .select("tipo, insumo_id, lote_id, especificacao, validade, valor")
        .in("tipo", ["vencido", "vencimento"])
        .order("validade")
        .order("lote_id")
        .range(de, ate),
    ),
    // lotes com saldo: ordem de abertura (FEFO), frascos abertos, quarentena, bloqueio e validade
    lerTudo<LotePainelDb>((de, ate) =>
      supabase
        .from("lotes_estoque")
        .select("id, insumo_id, codigo_lote, status, quantidade_atual, validade, validade_apos_abertura, data_abertura")
        .not("status", "in", "(consumido,descartado)")
        .gt("quantidade_atual", 0)
        .order("id")
        .range(de, ate),
    ),
  ]);
  const erros = [insumos, saldos, movimentos, previsoes, custos, alertas, lotes]
    .map((leitura) => leitura.error?.message)
    .filter(Boolean);
  const base = montarInsumosPainel(insumos.data, saldos.data, { saldosCompletos: !saldos.error });
  const decisao = montarDecisao(base, previsoes.data, custos.data, alertas.data, { previsoesCompletas: !previsoes.error });
  return {
    insumos: decisao.insumos,
    lotesVencendo: decisao.lotes,
    lotes: lotes.data,
    movimentos: movimentos.data,
    movimentosCompletos: completo && !movimentos.error,
    graficosIncompletos: {
      cobertura: Boolean(insumos.error || saldos.error || previsoes.error),
      categorias: Boolean(insumos.error || saldos.error),
      valores: Boolean(insumos.error || custos.error),
      movimentos: Boolean(insumos.error || movimentos.error),
    },
    erro: erros.length ? `Parte do painel não carregou: ${erros.join("; ")}` : null,
  };
}

export type ContagemSituacaoEstoque = {
  /** null = a leitura falhou em parte: a tela mostra "sem dado", não zero */
  resumo: ResumoAlertas | null;
  /** itens urgentes e de atenção, na ordem do painel; vazio quando não houve leitura */
  linhas: LinhaAtencao[];
};

/**
 * Contagem do painel único para o Início e para Cadastros. Não lança: sem
 * leitura, devolve "sem dado". Os quadros urgentes e de atenção não dependem
 * do histórico de 12 meses nem dos custos, então o número é o mesmo do painel.
 */
export async function contarSituacaoEstoque(supabase: SupabaseClient, hoje: string): Promise<ContagemSituacaoEstoque> {
  try {
    const painel = await carregarSituacaoEstoque(supabase, hoje, { para: "contagem" });
    if (painel.erro) return { resumo: null, linhas: [] };
    // o mesmo recorte do painel sem filtro: lote vencendo só conta se o insumo está no painel
    const noPainel = new Set(painel.insumos.map((insumo) => insumo.id));
    const alertas = montarAlertas({
      itens: painel.insumos,
      lotesVencendo: painel.lotesVencendo.filter((lote) => noPainel.has(lote.insumoId)),
      lotes: painel.lotes,
      movimentos: [],
      movimentosCompletos: false,
      hojeIso: hoje,
    });
    return { resumo: resumirAlertas(alertas), linhas: linhasDeAtencao(alertas) };
  } catch {
    return { resumo: null, linhas: [] };
  }
}
