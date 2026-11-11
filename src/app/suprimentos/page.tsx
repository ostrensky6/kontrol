import Link from "next/link";
import { redirect } from "next/navigation";

import { AguardandoVoce } from "@/components/dashboard/AguardandoVoce";
import { PENDENCIAS_DE_COMPRAS, pendenciasDe } from "@/components/dashboard/aguardando";
import { carregarPendencias } from "@/lib/pendencias/carregar";

import { AndamentoPedidos } from "@/components/compras/AndamentoPedidos";
import { HelpTip } from "@/components/common/HelpTip";
import { pode } from "@/lib/auth/permissao-efetiva";
import { ETAPAS_PEDIDO, etapaDoPedido, type EtapaAtivaId } from "@/lib/pedido/etapas";
import { PEDIDO_INTERNO_AGUARDANDO_CHEGADA } from "@/lib/pedido/status";
import { createClientUntyped } from "@/lib/supabase/server";
import { filtroEstoqueValido } from "@/lib/suprimentos/estoque-disponivel";

export const dynamic = "force-dynamic";

type PedidoResumoDb = { id: number; status: string | null; natureza: string | null; aprovacao_area_em: string | null };
type ItemAReceberDb = { id: number; pedidos_internos: { status: string | null } | { status: string | null }[] | null };

const asOne = <T,>(valor: T | T[] | null | undefined) => (Array.isArray(valor) ? (valor[0] ?? null) : (valor ?? null));

/**
 * Visão geral de Compras (organização de 11/11/2026): o que espera você e o
 * andamento dos pedidos nas seis etapas. O endereço continua /suprimentos para
 * os links antigos não quebrarem. A tabela "Estoque disponível", que morava
 * aqui, é a mesma de Estoque → Saldo e lotes: o link antigo com filtro leva
 * para lá.
 */
export default async function ComprasVisaoGeralPage({
  searchParams,
}: {
  searchParams: Promise<{ situacao?: string | string[] }>;
}) {
  const query = await searchParams;
  const situacao = Array.isArray(query.situacao) ? query.situacao[0] : query.situacao;
  if (situacao) redirect(`/estoque?situacao=${filtroEstoqueValido(situacao)}`);

  const supabase = await createClientUntyped();
  const [podeCriarPedido, podeVerPedidos, podeVerRecebimento, podeVerEstoque] = await Promise.all([
    pode("pedido.criar"),
    pode("pedido.ver"),
    pode("recebimento.ver"),
    pode("estoque.ver"),
  ]);

  const [pedidosResp, itensResp, aguardando] = await Promise.all([
    podeVerPedidos
      ? supabase.from("pedidos_internos").select("id, status, natureza, aprovacao_area_em")
      : Promise.resolve({ data: [] as PedidoResumoDb[], error: null }),
    podeVerRecebimento
      ? supabase
          .from("pedidos_internos_itens")
          .select("id, pedidos_internos!inner(status)")
          .is("recebido_em", null)
      : Promise.resolve({ data: [] as ItemAReceberDb[], error: null }),
    // o banco diz, pela competência de cada um, o que espera este usuário (0173)
    carregarPendencias(),
  ]);
  // leitura que falha não vira "nenhum pedido": a tela diz que não conseguiu ler
  if (pedidosResp.error) throw new Error(`Não foi possível ler os pedidos: ${pedidosResp.error.message}`);
  const pendencias = pendenciasDe(aguardando, PENDENCIAS_DE_COMPRAS);

  const etapas = ((pedidosResp.data ?? []) as PedidoResumoDb[]).map((p) => etapaDoPedido(p));
  const porEtapa = Object.fromEntries(
    ETAPAS_PEDIDO.map((e) => [e.id, etapas.filter((etapa) => etapa === e.id).length]),
  ) as Record<EtapaAtivaId, number>;
  const statusAguardandoChegada: readonly string[] = PEDIDO_INTERNO_AGUARDANDO_CHEGADA;
  // leitura que falha mostra "sem dado" em vez de zero
  const aReceber = itensResp.error
    ? ("sem_dado" as const)
    : ((itensResp.data ?? []) as ItemAReceberDb[]).filter((item) =>
        statusAguardandoChegada.includes(asOne(item.pedidos_internos)?.status ?? ""),
      ).length;

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Compras</h1>
              <HelpTip title="Compras">
                <p>
                  Compras vai <b>do pedido ao recebimento</b>. Aqui você vê o que espera você e em que etapa
                  está cada pedido. Cada passo tem o seu lugar na barra acima:
                </p>
                <ul className="list-disc space-y-1 pl-4">
                  <li><b>Pedidos</b>: cada pedido e a etapa em que está, da solicitação ao pagamento.</li>
                  <li><b>Compras com fornecedor</b>: as compras fechadas, cada uma ligada ao seu pedido.</li>
                  <li><b>Recebimento</b>: registrar o que chegou. A chegada cria o lote no Estoque.</li>
                  <li><b>Prazos de compra</b>: quanto tempo cada compra levou.</li>
                </ul>
              </HelpTip>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">O que espera você e o andamento dos pedidos, do pedido ao recebimento.</p>
          </div>
          {podeCriarPedido && (
            <Link
              href="/pedido?novo=1"
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Novo pedido
            </Link>
          )}
        </div>

        <AguardandoVoce
          pendencias={pendencias}
          destaque
          vazio="Nada esperando a sua ação em Compras agora. Quando um pedido ou uma compra depender de você, aparece aqui."
          ajuda="O que depende de você em Compras: pedidos para aprovar, autorizar, cotar ou pagar e compras para aprovar ou receber."
        />

        {podeVerPedidos && <AndamentoPedidos porEtapa={porEtapa} aReceber={podeVerRecebimento ? aReceber : null} />}

        {podeVerEstoque && (
          <p className="text-sm text-muted-foreground" data-testid="compras-para-estoque">
            O que chega pelo Recebimento entra no Estoque.{" "}
            <Link href="/estoque" className="font-medium text-primary underline-offset-4 hover:underline">
              Ver o saldo e os lotes
            </Link>
            {" · "}
            <Link href="/estoque/situacao" className="font-medium text-primary underline-offset-4 hover:underline">
              Ver o que precisa repor
            </Link>
          </p>
        )}
      </main>
    </div>
  );
}
