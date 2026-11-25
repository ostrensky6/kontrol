import { rotuloStatusOrcamento } from "@/lib/orcamento/rotulos-status";
import { HelpTip } from "@/components/common/HelpTip";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { MODALIDADES, ROTULO_PRIORIDADE, type DemandaDetalhe } from "@/lib/orcamento/demanda-detalhe";
import type { avaliarCompletudeDemanda } from "@/lib/orcamento/demanda-completude";

type Props = {
  demanda: DemandaDetalhe;
  modalidadeCanonica: "analises" | "projeto_com_analises" | "projeto";
  completudeDemanda: ReturnType<typeof avaliarCompletudeDemanda>;
};

/** Cabeçalho compacto do orçamento: título, cliente e situação. */
export function DemandaCabecalho({
  demanda,
  modalidadeCanonica,
  completudeDemanda,
}: Props) {
  return (
    <section className="mt-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">
          <span className="text-muted-foreground">Nº {demanda.id} · </span>
          {demanda.titulo}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {[
            demanda.cliente_nome || "Cliente não informado",
            MODALIDADES[modalidadeCanonica] ?? MODALIDADES[demanda.modalidade] ?? demanda.modalidade,
            demanda.data_solicitacao ? `solicitado em ${formatDate(demanda.data_solicitacao)}` : null,
            demanda.prazo_esperado ? `prazo ${formatDate(demanda.prazo_esperado)}` : null,
            demanda.responsavel_interno ? `resp. ${demanda.responsavel_interno}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
        {/* sem situação gravada não se mostra uma pílula vazia com traço */}
        {demanda.status && (
          <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300">
            {rotuloStatusOrcamento(demanda.status)}
          </span>
        )}
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-muted-foreground">
          Prioridade {ROTULO_PRIORIDADE[demanda.prioridade ?? "normal"] ?? demanda.prioridade}
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 ${
            completudeDemanda.completa ? "bg-success-soft text-success-strong" : "bg-warning-soft text-warning-strong"
          }`}
        >
          {completudeDemanda.completa ? "Dados completos" : `${completudeDemanda.faltante}% faltante`}
          <HelpTip title="Completude dos dados" align="end">
            <p>Parte dos <b>dados obrigatórios</b> do orçamento que ainda falta preencher (título, cliente, escopo ou descrição e, com laboratório, matriz e quantidade de amostras). Vincular um projeto é opcional.</p>
            <p>Dá para seguir para os custos com dados parciais. Os dados completos só são exigidos para <b>emitir a proposta</b>.</p>
            <p className="text-xs">Atualizado em {formatDateTime(demanda.completude_atualizada_em)}.</p>
          </HelpTip>
        </span>
      </div>
    </section>
  );
}
