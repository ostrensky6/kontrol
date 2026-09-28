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
    // Uma linha de etapas (número, nome e estado lado a lado); o título fica no aria-label.
    <nav className="no-print mt-3" aria-label="Fluxo da proposta">
      <ol className="grid grid-cols-1 gap-1.5 md:grid-cols-5">
        {ETAPAS.map((etapa, index) => {
          const aplicavel =
            (etapa.id !== "laboratorio" || exigeLaboratorio) &&
            (etapa.id !== "projeto" || exigeProjeto);
          const estado = !aplicavel ? "Não aplicável" : etapa.id === atual ? "Atual" : index < atualIndex ? "Concluída" : "Pendente";

          return (
            <li
              key={etapa.id}
              aria-current={estado === "Atual" ? "step" : undefined}
              className={`flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${classeEstado(estado)}`}
            >
              <span className="font-semibold">{index + 1}</span>
              <span className="min-w-0 break-words font-medium leading-tight">{etapa.label}</span>
              <span className="ml-auto shrink-0 rounded border px-1 text-[10px] leading-4">{estado}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function classeEstado(estado: string) {
  if (estado === "Concluída") return "border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-900 dark:bg-brand-950/30 dark:text-brand-100";
  if (estado === "Atual") return "border-border bg-card text-foreground shadow-sm";
  if (estado === "Não aplicável") return "border-border bg-muted/50 text-muted-foreground/80";
  return "border-warning-strong/30 bg-warning-soft text-warning-strong";
}
