import { explicarOrigem, type consolidarOrcamentoFinal } from "@/lib/orcamento/orcamento-final";
import { HelpTip } from "@/components/common/HelpTip";
import { PainelParametrosEconomicos } from "@/components/orcamento/PainelParametrosEconomicos";
import { EditorParametrosProposta } from "@/components/orcamento/EditorParametrosProposta";
import { formatCurrency as brl } from "@/lib/formatters";
import { TabelaSimples } from "@/components/orcamento/demanda/TabelaSimples";
import type { resolverParametrosProposta } from "@/lib/orcamento/parametros-proposta";

type Props = {
  /** "hidden" quando a etapa não é a que está aberta */
  classePasso: string;
  podeConsolidar: boolean;
  orcamentoFinal: ReturnType<typeof consolidarOrcamentoFinal>;
  parametrosProposta: ReturnType<typeof resolverParametrosProposta>;
  demandaId: number;
  erroParametros: string | undefined;
  parametrosSalvos: string | undefined;
  autorizadoParametros: boolean;
};

/** Etapa dos parâmetros econômicos. */
export function DemandaParametros({
  classePasso,
  podeConsolidar,
  orcamentoFinal,
  parametrosProposta,
  demandaId,
  erroParametros,
  parametrosSalvos,
  autorizadoParametros,
}: Props) {
  return (
    <section id="parametros" className={`mt-3 scroll-mt-20 rounded-lg border border-border bg-card p-4 shadow-sm ${classePasso}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1">
            <h2 className="text-sm font-semibold">Parâmetros econômicos</h2>
            <HelpTip title="Parâmetros econômicos">
              <p>Custos recebidos e percentuais usados na consolidação final. Também dá para alterá-los na etapa Proposta, aba Interno.</p>
            </HelpTip>
          </div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${podeConsolidar ? "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300" : "bg-warning-soft text-warning-strong"}`}>
          {podeConsolidar ? "Liberado" : "Aguardando revisão"}
        </span>
      </div>
      <PainelParametrosEconomicos
        custoLaboratorio={orcamentoFinal.totalLaboratorioCusto}
        precoLaboratorio={orcamentoFinal.totalLaboratorioPreco}
        custoProjeto={orcamentoFinal.totalProjetoCusto}
        subtotalTecnico={orcamentoFinal.subtotalTecnico}
        totalParametros={orcamentoFinal.totalParametros}
        totalFinal={orcamentoFinal.totalFinal}
        parametros={orcamentoFinal.parametrosProjeto}
        alertas={orcamentoFinal.alertas}
      />
      <EditorParametrosProposta
        key={JSON.stringify(parametrosProposta.rates)}
        demandaId={demandaId}
        custoLaboratorio={orcamentoFinal.totalLaboratorioCusto}
        custoProjeto={orcamentoFinal.totalProjetoCusto}
        valores={parametrosProposta.rates}
        origem={parametrosProposta.origem}
        erro={erroParametros}
        salvo={parametrosSalvos === "1"}
        podeEditar={autorizadoParametros}
      />
      <TabelaSimples
        colunas={["Campo", "Como é calculado", "Valor"]}
        vazio="Sem fórmulas calculadas."
        linhas={orcamentoFinal.origens.map((origem) => [
          origem.titulo,
          explicarOrigem(origem),
          brl(origem.valor),
        ])}
      />
    </section>
  );
}
