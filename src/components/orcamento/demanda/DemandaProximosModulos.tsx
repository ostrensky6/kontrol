import Link from "next/link";
import { gerarOrcamentoAnalisesDaDemanda, gerarOrcamentoProjetoDaDemanda } from "@/lib/actions/demandas";
import { rotuloStatusModulo } from "@/lib/orcamento/rotulos-status";
import { HelpTip } from "@/components/common/HelpTip";
import { type OrcamentoAnalisesResumo, type OrcamentoProjetoResumo } from "@/lib/orcamento/demanda-detalhe";
import { ModuloAcao } from "@/components/orcamento/demanda/ModuloAcao";
import type { avaliarCompletudeDemanda } from "@/lib/orcamento/demanda-completude";
import type { PlanoModulos } from "@/lib/orcamento/garantir-modulos";

type Props = {
  /** "hidden" quando a etapa não é a que está aberta */
  classePasso: string;
  completudeDemanda: ReturnType<typeof avaliarCompletudeDemanda>;
  planoModulosUi: PlanoModulos;
  erroIntegridade: string | undefined;
  demandaId: number;
  todosOrcamentosAnalises: OrcamentoAnalisesResumo[];
  todosOrcamentosProjeto: OrcamentoProjetoResumo[];
};

/** Próximos módulos, custos vinculados e fluxo recomendado. */
export function DemandaProximosModulos({
  classePasso,
  completudeDemanda,
  planoModulosUi,
  erroIntegridade,
  demandaId,
  todosOrcamentosAnalises,
  todosOrcamentosProjeto,
}: Props) {
  return (
    <section id="acoes" className={`mt-3 scroll-mt-20 grid gap-3 lg:grid-cols-3 ${classePasso}`}>
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold">Próximos módulos</h2>
          <HelpTip title="Próximos módulos">
            <p>A modalidade do orçamento controla quais módulos podem ser preenchidos.</p>
          </HelpTip>
        </div>
        {!completudeDemanda.completa && (
          <div className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-xs leading-5 text-warning-strong">
            Pode seguir para os custos. Para emitir a proposta, falta: {completudeDemanda.pendencias.join("; ")}.
          </div>
        )}
        {(planoModulosUi.bloqueadoPorDuplicidade || erroIntegridade) && (
          <div className="mt-3 rounded-md border border-danger-strong/30 bg-danger-soft px-3 py-2 text-xs leading-5 text-danger-strong">
            <p className="font-medium">Integridade comprometida</p>
            {erroIntegridade && <p>{erroIntegridade}</p>}
            {planoModulosUi.erros.map((e) => (
              <p key={e}>{e}</p>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <ModuloAcao
            plano={planoModulosUi.laboratorio}
            rotulo="laboratorial"
            demandaId={demandaId}
            acaoCriar={gerarOrcamentoAnalisesDaDemanda}
            hrefBase="/orcamento"
          />
          <ModuloAcao
            plano={planoModulosUi.projeto}
            rotulo="de projeto"
            demandaId={demandaId}
            acaoCriar={gerarOrcamentoProjetoDaDemanda}
            hrefBase={`/orcamento/demandas/${demandaId}`}
            hrefAbrir={`/orcamento/demandas/${demandaId}?etapa=projeto`}
            rotuloAbrir="Editar custos do projeto"
          />
        </div>
      </div>
    
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Custos vinculados</h2>
        <div className="mt-3 space-y-2 text-sm">
          {todosOrcamentosAnalises.map((o) => (
            <Link key={o.id} href={`/orcamento/${o.id}`} className="block rounded-md bg-muted/50 px-3 py-2 hover:bg-muted">
              Laboratório #{o.id} · {rotuloStatusModulo(o.status)} · {(o.orcamento_itens?.length ?? 0)} item(ns)
            </Link>
          ))}
          {todosOrcamentosProjeto.map((o) => (
            <Link key={o.id} href={`/orcamento/demandas/${demandaId}?etapa=projeto`} className="block rounded-md bg-muted/50 px-3 py-2 hover:bg-muted">
              Projeto #{o.id} · {rotuloStatusModulo(o.status)} · {(o.orcamento_projeto_custos?.length ?? 0) + (o.orcamento_projeto_analises?.length ?? 0)} item(ns)
            </Link>
          ))}
          {todosOrcamentosAnalises.length === 0 && todosOrcamentosProjeto.length === 0 && (
            <p className="text-xs text-muted-foreground/80">Nenhum custo gerado a partir deste orçamento.</p>
          )}
        </div>
      </div>
    
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Fluxo recomendado</h2>
        <ol className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
          <li>1. Registrar os dados do orçamento.</li>
          <li>2. Confirmar a modalidade.</li>
          <li>3. Gerar o custo correto.</li>
          <li>4. Planejar a execução e reservar estoque quando aprovado.</li>
        </ol>
      </div>
    </section>
  );
}
