import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { SectionCard } from "@/components/app/SectionCard";
import type { Pendencia } from "./aguardando";

/** Bloco da página inicial com o que espera a ação do usuário (PER2-10). */
export function AguardandoVoce({ pendencias }: { pendencias: Pendencia[] }) {
  const total = pendencias.reduce((soma, p) => soma + p.quantidade, 0);
  return (
    <SectionCard
      title="Aguardando você"
      description={
        total > 0
          ? "Etapas que dependem da sua ação, conforme as suas permissões."
          : "Nada depende da sua ação agora."
      }
      contentClassName="p-3 sm:p-3"
    >
      {pendencias.length === 0 ? (
        <p className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-3 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          Tudo em dia. Quando algo precisar de você, aparece aqui e em Notificações.
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
                        className="block truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
                        title={item.rotulo}
                      >
                        {item.rotulo}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
