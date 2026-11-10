import Link from "next/link";
import { PackageCheck } from "lucide-react";

import { HelpTip } from "@/components/common/HelpTip";
import { ETAPAS_PEDIDO, type EtapaAtivaId } from "@/lib/pedido/etapas";
import { cn } from "@/lib/utils";

/**
 * Andamento dos pedidos na visão geral de Suprimentos: quantos pedidos há em
 * cada uma das seis etapas (as mesmas da lista de Pedidos e da página do
 * pedido) e quantos itens comprados ainda não chegaram. Cada caixa abre a
 * lista já filtrada.
 */
export function AndamentoPedidos({
  porEtapa,
  aReceber,
}: {
  porEtapa: Record<EtapaAtivaId, number>;
  /** itens comprados que ainda não chegaram; null quando o usuário não vê Recebimento */
  aReceber: number | null;
}) {
  const emAndamento = ETAPAS_PEDIDO.reduce((soma, e) => soma + porEtapa[e.id], 0);
  const caixa =
    "flex h-full flex-col rounded-lg border border-border bg-card p-3 transition hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2";
  return (
    <section aria-labelledby="titulo-andamento" className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1">
            <h2 id="titulo-andamento" className="text-base font-semibold">Andamento dos pedidos</h2>
            <HelpTip title="Andamento dos pedidos">
              <p>
                Todo pedido passa pelas mesmas seis etapas, nesta ordem. O número é quantos pedidos estão
                em cada uma agora.
              </p>
              <p>
                Clique numa etapa para ver os pedidos dela. Dentro do pedido, o quadro <b>O que falta agora</b>{" "}
                diz o próximo passo e com quem está.
              </p>
            </HelpTip>
          </div>
          <p className="text-sm text-muted-foreground">
            {emAndamento === 0
              ? "Nenhum pedido em andamento."
              : `${emAndamento} ${emAndamento === 1 ? "pedido em andamento" : "pedidos em andamento"}, da solicitação ao pagamento.`}
          </p>
        </div>
        <Link href="/pedido" className="text-sm font-medium text-primary hover:underline">
          Ver todos os pedidos
        </Link>
      </div>
      <ol className={cn("mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3", aReceber === null ? "xl:grid-cols-6" : "xl:grid-cols-7")}>
        {ETAPAS_PEDIDO.map((etapa, i) => {
          const n = porEtapa[etapa.id];
          return (
            <li key={etapa.id}>
              <Link
                href={`/pedido?etapa=${etapa.id}`}
                aria-label={`Etapa ${i + 1}, ${etapa.rotulo}: ${n} ${n === 1 ? "pedido" : "pedidos"}`}
                className={caixa}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Etapa {i + 1}</span>
                  <span className={cn("text-xl font-semibold tabular-nums", n > 0 ? "text-foreground" : "text-muted-foreground")}>{n}</span>
                </span>
                <span className="text-sm font-medium text-foreground">{etapa.rotulo}</span>
              </Link>
            </li>
          );
        })}
        {aReceber !== null && (
          <li>
            <Link
              href="/recebimento"
              aria-label={`A receber: ${aReceber} ${aReceber === 1 ? "item comprado que ainda não chegou" : "itens comprados que ainda não chegaram"}`}
              className={cn(caixa, "border-dashed")}
            >
              <span className="flex items-center justify-between gap-2">
                <PackageCheck aria-hidden className="h-4 w-4 text-muted-foreground" />
                <span className={cn("text-xl font-semibold tabular-nums", aReceber > 0 ? "text-info-strong" : "text-muted-foreground")}>{aReceber}</span>
              </span>
              <span className="text-sm font-medium text-foreground">A receber</span>
              <span className="text-xs text-muted-foreground">{aReceber === 1 ? "item a caminho" : "itens a caminho"}</span>
            </Link>
          </li>
        )}
      </ol>
    </section>
  );
}
