import Link from "next/link";

import { AguardandoVoceLinha } from "@/components/dashboard/AguardandoVoceLinha";
import { PENDENCIAS_DE_SUPRIMENTOS, pendenciasDe } from "@/components/dashboard/aguardando";
import { carregarPendencias } from "@/lib/pendencias/carregar";

import { HelpTip } from "@/components/common/HelpTip";
import { EstoqueDisponivelTable } from "@/components/suprimentos/EstoqueDisponivelTable";
import { pode } from "@/lib/auth/permissao-efetiva";
import { hojeIso } from "@/lib/estoque/baixa";
import { janelaVencimentoDias } from "@/lib/estoque/situacao-insumo";
import { ETAPAS_PEDIDO, etapaDoPedido, type EtapaAtivaId } from "@/lib/pedido/etapas";
import { PEDIDO_INTERNO_AGUARDANDO_CHEGADA } from "@/lib/pedido/status";
import { lerTudo } from "@/lib/supabase/ler-tudo";
import { createClientUntyped } from "@/lib/supabase/server";
import {
  filtroEstoqueValido,
  montarEstoqueDisponivel,
  type AlertaDisponivelDb,
  type LoteValidadeDb,
  type PrevisaoDisponivelDb,
  type SaldoDisponivelDb,
} from "@/lib/suprimentos/estoque-disponivel";

export const dynamic = "force-dynamic";

type PedidoResumoDb = { id: number; status: string | null; natureza: string | null; aprovacao_area_em: string | null };
type ItemAReceberDb = { id: number; pedidos_internos: { status: string | null } | { status: string | null }[] | null };

const asOne = <T,>(valor: T | T[] | null | undefined) => (Array.isArray(valor) ? (valor[0] ?? null) : (valor ?? null));

export default async function SuprimentosPage({
  searchParams,
}: {
  searchParams: Promise<{ situacao?: string | string[] }>;
}) {
  const query = await searchParams;
  const filtro = filtroEstoqueValido(Array.isArray(query.situacao) ? query.situacao[0] : query.situacao);
  const supabase = await createClientUntyped();

  const [podeCriarPedido, podeVerPedidos, podeVerRecebimento] = await Promise.all([
    pode("pedido.criar"),
    pode("pedido.ver"),
    pode("recebimento.ver"),
  ]);

  const [
    { data: saldo, error: saldoError },
    { data: previsao },
    { data: alertas },
    { data: lotes },
    { data: parametros },
    pedidosResp,
    itensResp,
    aguardando,
  ] = await Promise.all([
    // listas de estoque lidas de mil em mil (o PostgREST corta em 1.000 linhas)
    lerTudo<SaldoDisponivelDb>((de, ate) =>
      supabase
        .from("v_estoque_saldo")
        .select("insumo_id, especificacao, unidade, unidade_saldo, tipo_insumo, ativo, em_maos, reservado, disponivel, ponto_reposicao")
        .order("especificacao")
        .order("insumo_id")
        .range(de, ate),
    ),
    supabase.from("v_previsao_suprimentos").select("insumo_id, qtd_sugerida_compra, qtd_pedida_aberta, qtd_pedida_pendente"),
    supabase.from("v_alertas_estoque").select("insumo_id, tipo"),
    lerTudo<LoteValidadeDb>((de, ate) =>
      supabase
        .from("lotes_estoque")
        .select("id, insumo_id, validade, validade_apos_abertura, quantidade_atual, status")
        .gt("quantidade_atual", 0)
        .not("status", "in", "(consumido,descartado)")
        .order("id")
        .range(de, ate),
    ),
    // janela do "vence em breve": a mesma de v_alertas_estoque (padrão 60 dias)
    supabase.from("parametros").select("chave, valor").eq("chave", "janela_vencimento_dias"),
    podeVerPedidos
      ? supabase.from("pedidos_internos").select("id, status, natureza, aprovacao_area_em")
      : Promise.resolve({ data: [] as PedidoResumoDb[] }),
    podeVerRecebimento
      ? supabase
          .from("pedidos_internos_itens")
          .select("id, pedidos_internos!inner(status)")
          .is("recebido_em", null)
      : Promise.resolve({ data: [] as ItemAReceberDb[] }),
    // o banco diz, pela competência de cada um, o que espera este usuário (0173)
    carregarPendencias(),
  ]);
  const pendencias = pendenciasDe(aguardando, PENDENCIAS_DE_SUPRIMENTOS);
  if (saldoError) throw new Error(`Não foi possível ler o saldo do estoque: ${saldoError.message}`);

  const linhas = montarEstoqueDisponivel({
    saldo: saldo ?? [],
    previsao: (previsao ?? []) as PrevisaoDisponivelDb[],
    alertas: (alertas ?? []) as AlertaDisponivelDb[],
    lotes: lotes ?? [],
    hoje: hojeIso(),
    janelaVencimento: janelaVencimentoDias((parametros as { valor: unknown }[] | null)?.[0]?.valor),
  });
  const etapas = ((pedidosResp.data ?? []) as PedidoResumoDb[]).map((p) => etapaDoPedido(p));
  const porEtapa = Object.fromEntries(
    ETAPAS_PEDIDO.map((e) => [e.id, etapas.filter((etapa) => etapa === e.id).length]),
  ) as Record<EtapaAtivaId, number>;
  const emAndamento = ETAPAS_PEDIDO.reduce((soma, etapa) => soma + porEtapa[etapa.id], 0);
  const statusAguardandoChegada: readonly string[] = PEDIDO_INTERNO_AGUARDANDO_CHEGADA;
  const aReceber = ((itensResp.data ?? []) as ItemAReceberDb[]).filter((item) =>
    statusAguardandoChegada.includes(asOne(item.pedidos_internos)?.status ?? ""),
  ).length;

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Suprimentos</h1>
              <HelpTip title="Suprimentos">
                <p>
                  Aqui você vê <b>o que espera você</b> em Suprimentos, <b>quantos pedidos estão em andamento</b> e{" "}
                  <b>o que temos em estoque</b>. Cada assunto tem um lugar só, na barra acima:
                </p>
                <ul className="list-disc space-y-1 pl-4">
                  <li><b>Estoque</b>: entradas, baixas, lotes, leitura de código, inventário e etiquetas.</li>
                  <li><b>Planejamento</b>: reservas de insumo para as análises previstas.</li>
                  <li><b>Pedidos</b>: cada pedido e a etapa em que está, da solicitação ao pagamento.</li>
                  <li><b>Recebimento</b>: registrar o que chegou.</li>
                </ul>
              </HelpTip>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">O que espera você e o que temos em estoque.</p>
          </div>
          {/* um botão principal só; a reposição fica na Situação do estoque, junto dos alertas de repor (D6) */}
          {podeCriarPedido && (
            <Link
              href="/pedido?novo=1"
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Novo pedido
            </Link>
          )}
        </div>

        {/* o quadro completo de Aguardando você fica no Início e no sino; aqui, uma linha (D4) */}
        <AguardandoVoceLinha pendencias={pendencias} />

        {/* as caixas das seis etapas ficam em Pedidos; aqui, o total em uma linha (D5) */}
        {podeVerPedidos && (
          <p data-testid="andamento-resumo" className="text-sm text-muted-foreground">
            {emAndamento === 0 ? (
              "Nenhum pedido em andamento."
            ) : (
              <>
                <Link href="/pedido" className="font-medium text-primary underline-offset-4 hover:underline">
                  {emAndamento} {emAndamento === 1 ? "pedido em andamento" : "pedidos em andamento"}
                </Link>
                , da solicitação ao pagamento.
              </>
            )}
            {podeVerRecebimento && aReceber > 0 && (
              <>
                {" "}
                <Link href="/recebimento" className="font-medium text-primary underline-offset-4 hover:underline">
                  {aReceber} {aReceber === 1 ? "item comprado ainda não chegou" : "itens comprados ainda não chegaram"}
                </Link>
                .
              </>
            )}
          </p>
        )}

        <section id="estoque-disponivel" aria-labelledby="titulo-estoque-disponivel" className="scroll-mt-20 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="flex items-center gap-1">
                <h2 id="titulo-estoque-disponivel" className="text-base font-semibold">Estoque disponível</h2>
                <HelpTip title="Estoque disponível">
                  <p>
                    <b>Disponível</b> é o que pode ser usado agora: o que está em mãos menos o que está
                    reservado para os planejamentos. <b>A caminho</b> é o que já foi comprado ou autorizado e
                    ainda não chegou. Pedido que ainda espera aprovação aparece à parte, como
                    &quot;aguardando aprovação&quot;: ele não garante entrega e não entra no disponível.
                  </p>
                  <p>
                    <b>Repor</b> aparece quando o disponível mais o que está a caminho não cobre as saídas
                    previstas até a próxima compra chegar. A mesma regra vale no Controle de Estoque.
                  </p>
                  <p>Para dar entrada, baixa ou ver os lotes, abra o <b>Estoque</b>.</p>
                </HelpTip>
              </div>
              <p className="text-sm text-muted-foreground">{linhas.length} insumos ativos</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {/* os alertas completos ficam num painel só (D1) */}
              <Link href="/estoque/situacao" className="text-sm font-medium text-primary hover:underline">
                Ver a situação do estoque
              </Link>
              <Link href="/estoque" className="text-sm font-medium text-primary hover:underline">
                Dar entrada ou baixa no Estoque
              </Link>
            </div>
          </div>
          <EstoqueDisponivelTable key={filtro} linhas={linhas} filtroInicial={filtro} />
        </section>
      </main>
    </div>
  );
}
