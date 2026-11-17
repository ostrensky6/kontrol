import Link from "next/link";
import { gerarOrcamentoAnalisesDaDemanda } from "@/lib/actions/demandas";
import { totalLaboratorioCusto, totalLaboratorioPreco } from "@/lib/orcamento/bases-custo";
import { rotuloStatusModulo } from "@/lib/orcamento/rotulos-status";
import { HelpTip } from "@/components/common/HelpTip";
import { formatCurrency as brl, formatDate } from "@/lib/formatters";
import { type OrcamentoAnalisesResumo, statusClasse } from "@/lib/orcamento/demanda-detalhe";
import { ModuloAcao } from "@/components/orcamento/demanda/ModuloAcao";
import { TabelaSimples } from "@/components/orcamento/demanda/TabelaSimples";
import type { avaliarModuloOperacional } from "@/lib/orcamento/modulo-status";
import type { PlanoModulos } from "@/lib/orcamento/garantir-modulos";

type Props = {
  /** "hidden" quando a etapa não é a que está aberta */
  classePasso: string;
  moduloAnalises: ReturnType<typeof avaliarModuloOperacional>;
  exigeAnalises: boolean;
  planoModulosUi: PlanoModulos;
  todosOrcamentosAnalises: OrcamentoAnalisesResumo[];
  demandaId: number;
  itensAnalises: number;
  totalAnalisesCusto: number;
  totalAnalisesPreco: number;
};

/** Etapa do orçamento laboratorial. */
export function DemandaLaboratorio({
  classePasso,
  moduloAnalises,
  exigeAnalises,
  planoModulosUi,
  todosOrcamentosAnalises,
  demandaId,
  itensAnalises,
  totalAnalisesCusto,
  totalAnalisesPreco,
}: Props) {
  return (
    <section id="laboratorio" className={`mt-3 scroll-mt-20 rounded-lg border border-border bg-card p-4 shadow-sm ${classePasso}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1">
            <h2 className="text-sm font-semibold">Orçamento laboratorial</h2>
            <HelpTip title="Custo × preço recebidos">
              <p>Custos das análises gerados a partir deste orçamento.</p>
              <p>O <b>custo</b> das análises é o que entra na proposta. O <b>preço</b> é o de tabela, mostrado só como referência.</p>
            </HelpTip>
          </div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClasse(moduloAnalises.status)}`}>
          {exigeAnalises ? `${moduloAnalises.label} · ${moduloAnalises.faltante}% faltante` : "Não se aplica"}
        </span>
      </div>
    
      {!exigeAnalises ? (
        <div className="mt-4 rounded-md bg-muted/50 px-3 py-4 text-sm text-muted-foreground">
          Esta modalidade não exige orçamento laboratorial.
        </div>
      ) : planoModulosUi.laboratorio.acao === "criar" && todosOrcamentosAnalises.length === 0 ? (
        // Sem orçamento laboratorial ainda: oferece criar (antes era só uma tabela vazia).
        (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md bg-muted/50 px-3 py-4 text-sm text-muted-foreground">
            <span>Nenhum orçamento laboratorial ainda.</span>
            <ModuloAcao
              plano={planoModulosUi.laboratorio}
              rotulo="laboratorial"
              demandaId={demandaId}
              acaoCriar={gerarOrcamentoAnalisesDaDemanda}
              hrefBase="/orcamento"
            />
          </div>
        )
      ) : (
        <>
          {/* Resumo numa linha (28/09): os cartões repetiam a tabela logo abaixo. */}
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
            <span><span className="text-muted-foreground">Orçamentos</span> <b className="font-semibold">{todosOrcamentosAnalises.length}</b></span>
            <span><span className="text-muted-foreground">Itens</span> <b className="font-semibold">{itensAnalises}</b></span>
            <span><span className="text-muted-foreground">Custo recebido</span> <b className="font-semibold">{brl(totalAnalisesCusto)}</b></span>
            <span><span className="text-muted-foreground">Preço de tabela</span> <b className="font-semibold">{brl(totalAnalisesPreco)}</b> <span className="text-xs text-muted-foreground">(referência)</span></span>
          </p>
          <TabelaSimples
            colunas={["Orçamento", "Status", "Data", "Itens", "Custo", "Preço", "Ação"]}
            vazio="Nenhum orçamento laboratorial gerado."
            linhas={todosOrcamentosAnalises.map((orcamento) => {
              const custo = totalLaboratorioCusto(orcamento.orcamento_itens ?? []);
              const preco = totalLaboratorioPreco(orcamento.orcamento_itens ?? []);
              return [
                `#${orcamento.id}`,
                rotuloStatusModulo(orcamento.status),
                formatDate(orcamento.data_orcamento),
                String(orcamento.orcamento_itens?.length ?? 0),
                brl(custo),
                brl(preco),
                <Link key={orcamento.id} href={`/orcamento/${orcamento.id}`} className="font-medium text-primary hover:underline">
                  Abrir
                </Link>,
              ];
            })}
          />
        </>
      )}
    </section>
  );
}
