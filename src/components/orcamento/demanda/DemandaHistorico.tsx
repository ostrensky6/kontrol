import {
  rotuloStatusModulo,
  rotuloStatusOrcamento,
  rotuloStatusVersaoFinal,
} from "@/lib/orcamento/rotulos-status";
import { HelpTip } from "@/components/common/HelpTip";
import { formatCurrency as brl, formatDate, formatDateTime } from "@/lib/formatters";
import type {
  OrcamentoAnalisesResumo,
  OrcamentoProjetoResumo,
  DemandaDetalhe,
  VersaoFinalResumo,
} from "@/lib/orcamento/demanda-detalhe";
import { TabelaSimples } from "@/components/orcamento/demanda/TabelaSimples";
import type { avaliarCompletudeDemanda } from "@/lib/orcamento/demanda-completude";
import { quantos } from "@/lib/plural";

type Props = {
  /** "hidden" quando a etapa não é a que está aberta */
  classePasso: string;
  versoesFinais: VersaoFinalResumo[] | null;
  todosOrcamentosAnalises: OrcamentoAnalisesResumo[];
  todosOrcamentosProjeto: OrcamentoProjetoResumo[];
  demanda: DemandaDetalhe;
  completudeDemanda: ReturnType<typeof avaliarCompletudeDemanda>;
};

/** Etapa do histórico e auditoria. */
export function DemandaHistorico({
  classePasso,
  versoesFinais,
  todosOrcamentosAnalises,
  todosOrcamentosProjeto,
  demanda,
  completudeDemanda,
}: Props) {
  return (
    <section id="historico" className={`mt-3 scroll-mt-20 rounded-lg border border-border bg-card p-4 shadow-sm ${classePasso}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold">Histórico e auditoria</h2>
          <HelpTip title="Histórico e auditoria">
            <p>Todos os registros ligados a este orçamento: módulos de custo, <b>inclusive os cancelados</b>, e propostas emitidas.</p>
          </HelpTip>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {quantos((versoesFinais?.length ?? 0) + todosOrcamentosAnalises.length + todosOrcamentosProjeto.length, "registro")}
        </span>
      </div>
    
      <TabelaSimples
        colunas={["Registro", "Tipo", "Status", "Quando", "Valor/Itens"]}
        vazio="Nenhum registro operacional vinculado."
        linhas={[
          [
            `Orçamento #${demanda.id}`,
            "Orçamento",
            rotuloStatusOrcamento(demanda.status),
            formatDateTime(demanda.completude_atualizada_em),
            completudeDemanda.completa ? "completa" : `${completudeDemanda.faltante}% faltante`,
          ],
          ...todosOrcamentosAnalises.map((orcamento) => [
            `Laboratório #${orcamento.id}`,
            "Custos laboratoriais",
            rotuloStatusModulo(orcamento.status),
            formatDate(orcamento.data_orcamento),
            quantos(orcamento.orcamento_itens?.length ?? 0, "item", "itens"),
          ]),
          ...todosOrcamentosProjeto.map((orcamento) => [
            orcamento.titulo || `Projeto #${orcamento.id}`,
            "Custos de projeto",
            rotuloStatusModulo(orcamento.status),
            formatDate(orcamento.data_orcamento),
            quantos((orcamento.orcamento_projeto_custos?.length ?? 0) + (orcamento.orcamento_projeto_analises?.length ?? 0), "item", "itens"),
          ]),
          ...(versoesFinais ?? []).map((versao) => [
            versao.numero,
            "Orçamento final",
            rotuloStatusVersaoFinal(versao.status),
            formatDateTime(versao.criado_em),
            brl(Number(versao.total_final ?? 0)),
          ]),
        ]}
      />
    </section>
  );
}
