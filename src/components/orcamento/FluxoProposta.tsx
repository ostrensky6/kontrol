import { modalidadeExigeLaboratorio, modalidadeExigeProjeto } from "@/lib/orcamento/orcamento-economico";

type EtapaFluxo = "demanda" | "laboratorio" | "projeto" | "final" | "historico";

const ETAPAS: Array<{ id: EtapaFluxo; label: string }> = [
  { id: "demanda", label: "Dados" },
  { id: "laboratorio", label: "Análises laboratoriais" },
  { id: "projeto", label: "Orçamento de projeto" },
  { id: "final", label: "Proposta final" },
  { id: "historico", label: "Histórico/Auditoria" },
];

export function FluxoProposta({
  modalidade,
  atual,
}: {
  modalidade?: string | null;
  atual: EtapaFluxo;
}) {
  const exigeLaboratorio = modalidadeExigeLaboratorio(modalidade);
  const exigeProjeto = modalidadeExigeProjeto(modalidade);
  const atualIndex = ETAPAS.findIndex((etapa) => etapa.id === atual);

  return (
    <nav className="no-print mt-4 rounded-lg border border-border bg-card p-3 shadow-sm" aria-label="Fluxo da proposta">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Fluxo da proposta</p>
      <div className="mt-2 grid gap-2 md:grid-cols-3 xl:grid-cols-5">
        {ETAPAS.map((etapa, index) => {
          const aplicavel =
            (etapa.id !== "laboratorio" || exigeLaboratorio) &&
            (etapa.id !== "projeto" || exigeProjeto);
          const estado = !aplicavel ? "Não aplicável" : etapa.id === atual ? "Atual" : index < atualIndex ? "Concluída" : "Pendente";

          return (
            <div key={etapa.id} className={`rounded-md border px-2 py-2 text-xs ${classeEstado(estado)}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{index + 1}</span>
                <span className="rounded border px-1.5 py-0.5 text-[10px]">{estado}</span>
              </div>
              <p className="mt-1 font-medium">{etapa.label}</p>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function classeEstado(estado: string) {
  if (estado === "Concluída") return "border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-900 dark:bg-brand-950/30 dark:text-brand-100";
  if (estado === "Atual") return "border-border bg-card text-foreground shadow-sm";
  if (estado === "Não aplicável") return "border-border bg-muted/50 text-muted-foreground/80";
  return "border-warning-strong/30 bg-warning-soft text-warning-strong";
}
