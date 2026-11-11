import Link from "next/link";
import { ArrowRight, CheckCircle2, ChevronRight } from "lucide-react";
import { SectionCard } from "@/components/app/SectionCard";
import { HelpTip } from "@/components/common/HelpTip";
import { cn } from "@/lib/utils";
import type { Pendencia } from "./aguardando";

/**
 * O que espera a ação do usuário (PER2-10). O quadro completo aparece só no
 * Início; o sino do topo mostra o mesmo conteúdo em qualquer tela e as outras
 * telas mostram uma linha (AguardandoVoceLinha, D4 da revisão de 11/11). Com
 * `destaque`, o quadro ganha contorno quando há algo esperando.
 */
export function AguardandoVoce({
  pendencias,
  destaque = false,
  vazio = "Nada esperando a sua ação agora. Quando algo depender de você, aparece aqui e no sino, no topo da tela.",
  ajuda = "Etapas que dependem da sua ação, conforme as suas permissões.",
}: {
  pendencias: Pendencia[];
  destaque?: boolean;
  vazio?: string;
  ajuda?: string;
}) {
  const total = pendencias.reduce((soma, p) => soma + p.quantidade, 0);
  return (
    <SectionCard
      title="Aguardando você"
      help={
        <HelpTip title="Aguardando você">
          <p>{ajuda}</p>
          <p>Clique no nome para abrir direto o registro e agir. O número abre a lista completa.</p>
        </HelpTip>
      }
      actions={
        total > 0 ? (
          <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold tabular-nums text-primary-foreground">
            {total} {total === 1 ? "pendência" : "pendências"}
          </span>
        ) : undefined
      }
      className={cn(destaque && total > 0 && "border-primary/60 ring-1 ring-primary/30")}
      contentClassName="p-3 sm:p-3"
    >
      {pendencias.length === 0 ? (
        <p className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-3 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          {vazio}
        </p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {pendencias.map((p) => (
            <li key={p.chave} className="rounded-md border border-border/70 p-3">
              <Link
                href={p.href}
                className="group flex items-start justify-between gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                aria-label={`${p.titulo}: ${p.quantidade}. Ver a lista`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground group-hover:text-primary">
                    {p.titulo}
                  </span>
                  <span className="block text-xs text-muted-foreground">{p.acao}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-2xl font-semibold tabular-nums text-foreground">
                  {p.quantidade}
                  <ArrowRight className="h-4 w-4 text-muted-foreground/60" aria-hidden="true" />
                </span>
              </Link>
              {p.itens.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-border/60 pt-2">
                  {p.itens.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        className="group/item flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-primary/5 hover:text-primary"
                        title={item.rotulo}
                      >
                        <span className="min-w-0 truncate">{item.rotulo}</span>
                        <span className="flex shrink-0 items-center text-xs font-medium text-primary">
                          Abrir
                          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                      </Link>
                    </li>
                  ))}
                  {p.quantidade > p.itens.length && (
                    <li className="px-2 text-xs text-muted-foreground">
                      e mais {p.quantidade - p.itens.length}: o número acima abre a lista
                    </li>
                  )}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
