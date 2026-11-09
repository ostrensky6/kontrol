import type { EtapaAprovacao } from "@/lib/pedido/aprovadores";

const MARCA: Record<EtapaAprovacao["situacao"], { simbolo: string; cls: string }> = {
  feita: { simbolo: "✓", cls: "bg-success-soft text-success-strong" },
  aguardando: { simbolo: "…", cls: "bg-warning-soft text-warning-strong" },
  futura: { simbolo: "○", cls: "bg-muted text-muted-foreground" },
  travada: { simbolo: "!", cls: "bg-danger-soft text-danger-strong" },
};

/**
 * Quem aprova o pedido, na ordem do fluxo (0169). Cada linha diz a situação
 * por escrito; a cor só reforça.
 */
export function QuemAprova({ etapas }: { etapas: EtapaAprovacao[] }) {
  return (
    <section aria-labelledby="quem-aprova-titulo" className="mt-3 rounded-md border border-border bg-muted/20 p-3" data-testid="quem-aprova">
      <h3 id="quem-aprova-titulo" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Quem aprova
      </h3>
      <ol className="mt-2 grid gap-2">
        {etapas.map((etapa) => {
          const marca = MARCA[etapa.situacao];
          return (
            <li key={etapa.chave} className="flex items-start gap-2 text-sm">
              <span aria-hidden="true" className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${marca.cls}`}>
                {marca.simbolo}
              </span>
              <div className="min-w-0">
                <p className="font-medium">
                  {etapa.titulo}: <span className="font-normal">{etapa.quem}</span>{" "}
                  <span className={`ml-1 rounded px-1.5 py-0.5 text-xs font-medium ${marca.cls}`}>{etapa.rotuloSituacao}</span>
                </p>
                {etapa.detalhe && (
                  <p className={`mt-0.5 text-xs ${etapa.situacao === "travada" ? "font-medium text-danger-strong" : "text-muted-foreground"}`}>
                    {etapa.detalhe}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
