import { Check } from "lucide-react";

import { ETAPAS_PEDIDO, posicaoEtapa, rotuloEtapa, type EtapaPedidoId } from "@/lib/pedido/etapas";
import { cn } from "@/lib/utils";

/**
 * Trilha das seis etapas na página do pedido: as cumpridas levam um visto, a
 * atual fica em destaque e as seguintes ficam apagadas. São as mesmas seis
 * etapas da lista de pedidos e da visão geral de Compras.
 */
export function PedidoTrilha({ etapa, className }: { etapa: EtapaPedidoId; className?: string }) {
  const posicao = posicaoEtapa(etapa);
  const total = ETAPAS_PEDIDO.length;
  const cancelado = etapa === "cancelado";
  const resumo =
    etapa === "concluido"
      ? "Concluído: todas as etapas cumpridas"
      : cancelado
        ? "Pedido cancelado"
        : `Etapa ${posicao} de ${total}: ${rotuloEtapa(etapa)}`;

  return (
    <div className={className}>
      <ol aria-label="Etapas do pedido" className="flex items-start">
        {ETAPAS_PEDIDO.map((e, i) => {
          const numero = i + 1;
          const feita = !cancelado && numero < posicao;
          const atual = !cancelado && numero === posicao;
          return (
            <li key={e.id} aria-current={atual ? "step" : undefined} className="min-w-0 flex-1">
              <div className="flex items-center" aria-hidden>
                <span className={cn("h-0.5 flex-1", i === 0 ? "invisible" : feita || atual ? "bg-success-strong" : "bg-border")} />
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                    feita && "border-success-strong bg-success-strong text-white",
                    atual && "border-primary bg-primary text-primary-foreground ring-4 ring-primary/20",
                    !feita && !atual && "border-border bg-card text-muted-foreground",
                  )}
                >
                  {feita ? <Check className="h-4 w-4" /> : numero}
                </span>
                <span className={cn("h-0.5 flex-1", numero === total ? "invisible" : feita ? "bg-success-strong" : "bg-border")} />
              </div>
              <p
                className={cn(
                  "mt-1.5 hidden px-1 text-center text-xs leading-4 sm:block",
                  atual ? "font-semibold text-foreground" : feita ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {e.rotulo}
                <span className="sr-only">{feita ? " (cumprida)" : atual ? " (etapa atual)" : " (por vir)"}</span>
              </p>
              {/* no celular os nomes não cabem: só a etapa atual é escrita, abaixo da trilha */}
              <span className="sr-only sm:hidden">
                {e.rotulo}
                {feita ? " (cumprida)" : atual ? " (etapa atual)" : " (por vir)"}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-center text-xs font-medium text-muted-foreground sm:hidden">{resumo}</p>
    </div>
  );
}
