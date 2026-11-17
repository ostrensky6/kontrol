import { gerarOrcamentoProjetoDaDemanda } from "@/lib/actions/demandas";
import { HelpTip } from "@/components/common/HelpTip";
import { EditorCustosProjeto } from "@/components/orcamento/projeto/EditorCustosProjeto";
import { type EtapaId } from "@/lib/orcamento/etapas-proposta";
import { statusClasse } from "@/lib/orcamento/demanda-detalhe";
import { ModuloAcao } from "@/components/orcamento/demanda/ModuloAcao";
import type { avaliarModuloOperacional } from "@/lib/orcamento/modulo-status";
import type { PlanoModulos } from "@/lib/orcamento/garantir-modulos";

type Props = {
  /** "hidden" quando a etapa não é a que está aberta */
  classePasso: string;
  moduloProjeto: ReturnType<typeof avaliarModuloOperacional>;
  exigeProjeto: boolean;
  planoModulosUi: PlanoModulos;
  etapaAtiva: EtapaId;
  demandaId: number;
};

/** Etapa dos custos do projeto. */
export function DemandaProjeto({
  classePasso,
  moduloProjeto,
  exigeProjeto,
  planoModulosUi,
  etapaAtiva,
  demandaId,
}: Props) {
  return (
    <section id="projeto" className={`mt-3 scroll-mt-20 rounded-lg border border-border bg-card p-4 shadow-sm ${classePasso}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold">Custos do projeto</h2>
          <HelpTip title="Custos do projeto">
            <p>Rubricas, pessoal por mês, viagens e análises do projeto, sempre em <b>custo técnico</b>.</p>
            <p>Impostos, taxas e lucro entram só na etapa seguinte, de <b>parâmetros econômicos</b>.</p>
          </HelpTip>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClasse(moduloProjeto.status)}`}>
          {exigeProjeto ? `${moduloProjeto.label} · ${moduloProjeto.faltante}% faltante` : "Não se aplica"}
        </span>
      </div>
    
      {!exigeProjeto ? (
        <div className="mt-4 rounded-md bg-muted/50 px-3 py-4 text-sm text-muted-foreground">
          Esta modalidade não exige orçamento de projeto.
        </div>
      ) : planoModulosUi.projeto.acao === "abrir" && planoModulosUi.projeto.moduloId ? (
        // O editor só consulta o banco quando a etapa está aberta.
        etapaAtiva === "projeto" && (
          <EditorCustosProjeto orcamentoProjetoId={planoModulosUi.projeto.moduloId} demandaId={demandaId} />
        )
      ) : planoModulosUi.projeto.acao === "bloqueado" ? (
        <p role="alert" className="mt-4 rounded-md border border-danger-strong/30 bg-danger-soft px-3 py-2 text-xs leading-5 text-danger-strong">
          {planoModulosUi.erros.join(" ")}
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md bg-muted/50 px-3 py-4 text-sm text-muted-foreground">
          <span>Nenhuma planilha de custos do projeto ainda.</span>
          <ModuloAcao
            plano={planoModulosUi.projeto}
            rotulo="de projeto"
            demandaId={demandaId}
            acaoCriar={gerarOrcamentoProjetoDaDemanda}
            hrefBase={`/orcamento/demandas/${demandaId}`}
            hrefAbrir={`/orcamento/demandas/${demandaId}?etapa=projeto`}
          />
        </div>
      )}
    </section>
  );
}
