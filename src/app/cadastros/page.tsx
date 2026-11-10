import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCadastrosOrdenados } from "@/lib/cadastros/config";
import { CadastrosCards } from "@/components/cadastros/CadastrosCards";
import {
  BotoesPlanilhaCadastros,
  ImportacaoCadastrosProvider,
  ResultadoImportacaoCadastros,
} from "@/components/cadastros/CadastrosWorkbookPanel";
import { PainelInsumos } from "@/components/cadastros/PainelInsumos";
import { ACaminhoInsumos } from "@/components/cadastros/ACaminhoInsumos";
import { lerACaminho } from "@/lib/suprimentos/a-caminho";
import { HelpTip } from "@/components/common/HelpTip";
import { pode } from "@/lib/auth/permissao-efetiva";
import { createClientUntyped } from "@/lib/supabase/server";
import { hojeIso } from "@/lib/estoque/baixa";
import { lerTudo } from "@/lib/supabase/ler-tudo";
import {
  inicioJanelaMeses,
  montarInsumosPainel,
  type InsumoPainelDb,
  type MovimentoPainelDb,
  type SaldoPainelDb,
} from "@/lib/cadastros/painel-insumos";
import {
  montarDecisao,
  type AlertaPainelDb,
  type CustoPainelDb,
  type LotePainelDb,
  type PrevisaoPainelDb,
} from "@/lib/cadastros/painel-decisao";

export const dynamic = "force-dynamic";

async function carregarPainel(supabase: SupabaseClient, hoje: string) {
  const inicio = inicioJanelaMeses(hoje, 12);
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
    lerTudo<MovimentoPainelDb>((de, ate) =>
      supabase
        .from("estoque_movimentacoes")
        // ajustes entram só para o gráfico: o que desfaz uma leitura anula a entrada ou a saída
        .select("insumo_id, tipo, data, motivo")
        .in("tipo", ["entrada", "saida", "ajuste"])
        .gte("data", inicio)
        .order("id")
        .range(de, ate),
    ),
    // previsão de compra e cobertura: a mesma regra do "Repor" do Estoque
    lerTudo<PrevisaoPainelDb>((de, ate) =>
      supabase
        .from("v_previsao_suprimentos")
        .select("insumo_id, qtd_sugerida_compra, qtd_pedida_aberta, qtd_pedida_pendente, qtd_compra_atrasada, compra_atrasada_desde, consumo_medio_diario, dias_cobertura, lead_time_dias")
        .order("insumo_id")
        .range(de, ate),
    ),
    lerTudo<CustoPainelDb>((de, ate) =>
      supabase.from("v_custo_estoque_vigente").select("insumo_id, valor_liberado").order("insumo_id").range(de, ate),
    ),
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
    movimentosCompletos: !movimentos.error,
    graficosIncompletos: {
      cobertura: Boolean(insumos.error || saldos.error || previsoes.error),
      categorias: Boolean(insumos.error || saldos.error),
      valores: Boolean(insumos.error || custos.error),
      movimentos: Boolean(insumos.error || movimentos.error),
    },
    erro: erros.length ? `Parte do painel não carregou: ${erros.join("; ")}` : null,
  };
}

export default async function CadastrosIndex() {
  const cadastros = getCadastrosOrdenados();
  const hoje = hojeIso();
  const supabase = await createClientUntyped();
  // a importação grava em vários cadastros; cada linha ainda passa pelo RLS da tabela
  const [painel, aCaminho, ...permissoes] = await Promise.all([
    carregarPainel(supabase, hoje),
    pode("compras.ver").then((ok) => (ok ? lerACaminho(supabase, hoje) : null)),
    pode("cadastros.editar"),
    pode("insumos.editar"),
    pode("projetos.editar"),
  ]);
  const podeImportar = permissoes.some(Boolean);
  const podeCadastrarInsumo = permissoes[1];

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <ImportacaoCadastrosProvider>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <h1 className="text-xl font-semibold tracking-tight">Painel de insumos</h1>
            <HelpTip title="Painel de insumos">
              <p>
                Painel de alertas: cada quadro mostra quais insumos ou lotes pedem atenção e por quê (saldo, compra,
                validade, ordem de abertura, lotes parados). A lista completa dos insumos fica em{" "}
                <b>Consultar insumos</b>.
              </p>
              <p>
                <b>Disponível no sistema</b> vem da mesma leitura do Estoque (<code>v_estoque_saldo</code>) e pode ser
                zero mesmo com saldo em mãos. A conferência física não foi comprovada por essa leitura.
              </p>
              <p>
                <b>Crítico no sistema</b> é o disponível abaixo do mínimo cadastrado, inclusive zero. Zero sem mínimo
                aparece em <b>Sem mínimo definido</b>. Sem registro de saldo, o painel indica ausência de dado; falha
                de leitura ou valor inválido aparece como <b>Saldo indisponível</b>.
              </p>
              <p>
                <b>Repor</b> é uma sugestão para análise, sem compra automática. Considera consumo, prazo cadastrado
                e o que já está pedido. O prazo cadastrado é uma referência, não uma data garantida de chegada.
              </p>
              <p>
                <b>Aberto fora da ordem</b>: abriram um lote enquanto outro, fechado e dentro da validade, vence antes (o
                que vence primeiro deve sair primeiro).
              </p>
            </HelpTip>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {podeCadastrarInsumo ? (
              <Link
                href="/cadastros/insumos?novo=1"
                className="inline-flex rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                + Cadastrar insumo
              </Link>
            ) : null}
            <BotoesPlanilhaCadastros podeImportar={podeImportar} />
            <Link href="/cadastros/insumos" className="inline-flex rounded-md border border-input bg-card px-3 py-2 text-sm font-medium hover:bg-muted">
              Consultar insumos
            </Link>
            <a href="#todos-os-cadastros" className="px-1 text-sm font-medium text-primary hover:underline">
              Todos os cadastros ↓
            </a>
          </div>
        </div>

        <ResultadoImportacaoCadastros />

        <PainelInsumos
          insumos={painel.insumos}
          lotesVencendo={painel.lotesVencendo}
          lotes={painel.lotes}
          movimentos={painel.movimentos}
          movimentosCompletos={painel.movimentosCompletos}
          graficosIncompletos={painel.graficosIncompletos}
          hojeIso={hoje}
          erro={painel.erro}
        />

        <ACaminhoInsumos itens={aCaminho?.itens ?? []} erro={aCaminho?.erro} semAcesso={!aCaminho} />

        <section id="todos-os-cadastros" aria-labelledby="todos-os-cadastros-titulo" className="mt-10 scroll-mt-20 border-t border-border pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="todos-os-cadastros-titulo" className="text-lg font-semibold tracking-tight">
              Todos os cadastros
            </h2>
            <Link href="/cadastros/qualidade" className="inline-flex rounded-md border border-input bg-card px-3 py-2 text-sm font-medium hover:bg-muted">
              Revisar qualidade dos cadastros
            </Link>
          </div>
          <CadastrosCards cadastros={cadastros} />
        </section>
        </ImportacaoCadastrosProvider>
      </main>
    </div>
  );
}
