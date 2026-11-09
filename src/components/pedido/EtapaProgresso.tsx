import { ETAPAS_PEDIDO, posicaoEtapa, rotuloEtapa, type EtapaPedidoId } from "@/lib/pedido/etapas";
import { cn } from "@/lib/utils";

/**
 * Barra das seis etapas do pedido: verde = cumprida, amarelo = atual,
 * cinza = por vir. Cancelado fica todo cinza. Só elementos em linha, para
 * caber também dentro de textos (cartão do celular).
 */
export function EtapaProgresso({ etapa, className }: { etapa: EtapaPedidoId; className?: string }) {
  const posicao = posicaoEtapa(etapa);
  const total = ETAPAS_PEDIDO.length;
  const descricao =
    etapa === "concluido"
      ? "Concluído: todas as etapas cumpridas"
      : etapa === "cancelado"
        ? "Cancelado"
        : `Etapa ${posicao} de ${total}: ${rotuloEtapa(etapa)}`;
  return (
    <span role="img" aria-label={descricao} title={descricao} className={cn("flex items-center gap-2", className)}>
      <span className="flex flex-1 gap-0.5" aria-hidden>
        {ETAPAS_PEDIDO.map((e, i) => (
          <span
            key={e.id}
            className={cn(
              "h-1.5 min-w-3 flex-1 rounded-full",
              etapa === "cancelado"
                ? "bg-muted"
                : i + 1 < posicao
                  ? "bg-success-strong"
                  : i + 1 === posicao
                    ? "bg-warning-strong"
                    : "bg-muted",
            )}
          />
        ))}
      </span>
      <span aria-hidden className="shrink-0 text-xs font-medium text-muted-foreground">
        {etapa === "concluido" || etapa === "cancelado" ? rotuloEtapa(etapa) : `${posicao}/${total} ${rotuloEtapa(etapa)}`}
      </span>
    </span>
  );
}
