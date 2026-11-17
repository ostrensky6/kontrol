import type { EtapaId, EtapaProposta } from "@/lib/orcamento/etapas-proposta";

type Props = {
  etapas: EtapaProposta[];
  etapaAtiva: EtapaId;
};

/** Barra das etapas do orçamento (dados, laboratório, projeto, parâmetros, proposta final, histórico). */
export function DemandaAbasEtapas({
  etapas,
  etapaAtiva,
}: Props) {
  return (
    <nav className="sticky top-[57px] z-10 mt-3 overflow-x-auto md:top-0 border-y border-border bg-card/95 py-1.5 shadow-sm backdrop-blur">
      <div className="flex min-w-max gap-1.5 px-2">
        {etapas.map((etapa, indice) => {
          const ativa = etapa.id === etapaAtiva;
          const desabilitada = !etapa.aplicavel;
          return (
            <a
              key={etapa.id}
              href={etapa.href}
              aria-current={ativa ? "step" : undefined}
              aria-disabled={desabilitada || undefined}
              className={`rounded-md border px-3 py-1.5 text-left text-xs transition hover:bg-muted ${
                ativa
                  ? "border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-500 dark:bg-brand-950/40 dark:text-brand-200"
                  : desabilitada
                    ? "border-border text-muted-foreground/80"
                    : "border-input text-foreground"
              }`}
            >
              <span className="block font-semibold">
                {indice + 1}. {etapa.label}
              </span>
              <span className="mt-0.5 block text-xs">
                {etapa.aplicavel ? etapa.status : "Não se aplica"}
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
