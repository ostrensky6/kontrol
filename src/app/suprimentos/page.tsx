import Link from "next/link";
import { CalendarClock, ClipboardList, PackageCheck, ShoppingCart, type LucideIcon } from "lucide-react";

import { HelpTip } from "@/components/common/HelpTip";
import { GerarPedidoReposicaoButton } from "@/components/pedido/GerarPedidoReposicaoButton";
import { EstoqueDisponivelTable } from "@/components/suprimentos/EstoqueDisponivelTable";
import { pode } from "@/lib/auth/permissao-efetiva";
import { hojeIso } from "@/lib/estoque/baixa";
import { janelaVencimentoDias } from "@/lib/estoque/situacao-insumo";
import { etapaDoPedido, etapaEmAndamento } from "@/lib/pedido/etapas";
import { PEDIDO_INTERNO_AGUARDANDO_CHEGADA } from "@/lib/pedido/status";
import { lerTudo } from "@/lib/supabase/ler-tudo";
import { createClientUntyped } from "@/lib/supabase/server";
import {
  filtroEstoqueValido,
  linhaAtendeFiltro,
  montarEstoqueDisponivel,
  type AlertaDisponivelDb,
  type LoteValidadeDb,
  type PrevisaoDisponivelDb,
  type SaldoDisponivelDb,
} from "@/lib/suprimentos/estoque-disponivel";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type PedidoResumoDb = { id: number; status: string | null; natureza: string | null; aprovacao_area_em: string | null };
type ItemAReceberDb = { id: number; pedidos_internos: { status: string | null } | { status: string | null }[] | null };

const asOne = <T,>(valor: T | T[] | null | undefined) => (Array.isArray(valor) ? (valor[0] ?? null) : (valor ?? null));

type Tom = "red" | "amber" | "info" | "neutro";

const TOM_CARTAO: Record<Tom, { borda: string; numero: string }> = {
  red: { borda: "border-l-danger-strong", numero: "text-danger-strong" },
  amber: { borda: "border-l-warning-strong", numero: "text-warning-strong" },
  info: { borda: "border-l-info-strong", numero: "text-info-strong" },
  neutro: { borda: "border-l-border", numero: "text-foreground" },
};

function CartaoAtencao({
  href,
  icone: Icone,
  titulo,
  valor,
  detalhe,
  tom,
}: {
  href: string;
  icone: LucideIcon;
  titulo: string;
  valor: number;
  detalhe: string;
  tom: Tom;
}) {
  const cores = TOM_CARTAO[valor > 0 ? tom : "neutro"];
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-3 rounded-lg border border-l-4 border-border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md",
        cores.borda,
      )}
    >
      <Icone aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{titulo}</p>
        <p className="text-xs text-muted-foreground">{detalhe}</p>
      </div>
      <span className={cn("text-2xl font-semibold tabular-nums", cores.numero)}>{valor}</span>
    </Link>
  );
}

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
    supabase.from("v_previsao_suprimentos").select("insumo_id, qtd_sugerida_compra, qtd_pedida_aberta"),
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
  ]);
  if (saldoError) throw new Error(`Não foi possível ler o saldo do estoque: ${saldoError.message}`);

  const linhas = montarEstoqueDisponivel({
    saldo: saldo ?? [],
    previsao: (previsao ?? []) as PrevisaoDisponivelDb[],
    alertas: (alertas ?? []) as AlertaDisponivelDb[],
    lotes: lotes ?? [],
    hoje: hojeIso(),
    janelaVencimento: janelaVencimentoDias((parametros as { valor: unknown }[] | null)?.[0]?.valor),
  });
  const repor = linhas.filter((l) => linhaAtendeFiltro(l, "reposicao")).length;
  const validade = linhas.filter((l) => linhaAtendeFiltro(l, "vencido_vencendo")).length;
  const vencidos = linhas.filter((l) => l.sinais.includes("vencido")).length;

  const etapas = ((pedidosResp.data ?? []) as PedidoResumoDb[]).map((p) => etapaDoPedido(p));
  const emAndamento = etapas.filter(etapaEmAndamento).length;
  const emAprovacao = etapas.filter((e) => e === "aprovacao").length;
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
                  Aqui você vê <b>o que temos em estoque</b> e o que precisa de atenção. Cada assunto tem
                  um lugar só, na barra acima:
                </p>
                <ul className="list-disc space-y-1 pl-4">
                  <li><b>Estoque</b>: entradas, baixas, lotes, leitura de código, inventário e etiquetas.</li>
                  <li><b>Planejamento</b>: reservas de insumo para as análises previstas.</li>
                  <li><b>Pedidos</b>: cada pedido e a etapa em que está, da solicitação ao pagamento.</li>
                  <li><b>Recebimento</b>: registrar o que chegou.</li>
                </ul>
              </HelpTip>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">O que temos em estoque e o que precisa de atenção.</p>
          </div>
          {podeCriarPedido && (
            <div className="flex flex-wrap items-center gap-2">
              <GerarPedidoReposicaoButton />
              <Link
                href="/pedido?novo=1"
                className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Novo pedido
              </Link>
            </div>
          )}
        </div>

        <section aria-labelledby="titulo-atencao">
          <h2 id="titulo-atencao" className="sr-only">Precisa de atenção</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <CartaoAtencao
              href="/suprimentos?situacao=reposicao#estoque-disponivel"
              icone={ShoppingCart}
              titulo="Repor"
              valor={repor}
              detalhe={repor ? "insumos que a previsão manda comprar" : "nenhum insumo para comprar agora"}
              tom="amber"
            />
            <CartaoAtencao
              href="/suprimentos?situacao=vencido_vencendo#estoque-disponivel"
              icone={CalendarClock}
              titulo="Validade"
              valor={validade}
              detalhe={
                validade
                  ? vencidos
                    ? `insumos com lote vencido ou vencendo (${vencidos} com vencido)`
                    : "insumos com lote vencendo"
                  : "nenhum lote vencendo"
              }
              tom={vencidos ? "red" : "amber"}
            />
            {podeVerPedidos && (
              <CartaoAtencao
                href="/pedido"
                icone={ClipboardList}
                titulo="Pedidos em andamento"
                valor={emAndamento}
                detalhe={emAprovacao ? `${emAprovacao} aguardando aprovação` : "veja em que etapa cada um está"}
                tom="info"
              />
            )}
            {podeVerRecebimento && (
              <CartaoAtencao
                href="/recebimento"
                icone={PackageCheck}
                titulo="A receber"
                valor={aReceber}
                detalhe={aReceber ? "itens comprados que ainda não chegaram" : "nada esperando chegada"}
                tom="info"
              />
            )}
          </div>
        </section>

        <section id="estoque-disponivel" aria-labelledby="titulo-estoque-disponivel" className="scroll-mt-20 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="flex items-center gap-1">
                <h2 id="titulo-estoque-disponivel" className="text-base font-semibold">Estoque disponível</h2>
                <HelpTip title="Estoque disponível">
                  <p>
                    <b>Disponível</b> é o que pode ser usado agora: o que está em mãos menos o que está
                    reservado para os planejamentos. <b>A caminho</b> é o que já foi comprado e ainda não chegou.
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
            <Link href="/estoque" className="text-sm font-medium text-primary hover:underline">
              Dar entrada ou baixa no Estoque
            </Link>
          </div>
          <EstoqueDisponivelTable key={filtro} linhas={linhas} filtroInicial={filtro} />
        </section>
      </main>
    </div>
  );
}
