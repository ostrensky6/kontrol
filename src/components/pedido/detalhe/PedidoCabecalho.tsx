import { rotuloNatureza, rotuloObjetivo, rotuloUso } from "@/lib/pedido/natureza";
import {
  dataEmBrasilia,
  ehUrgente,
  explicarCicloHoje,
  prazoDoCiclo,
  rotuloCiclo,
  rotuloData,
  rotuloPrazo,
} from "@/lib/pedido/ciclo";
import { PedidoInternoCabecalhoAcoes } from "@/components/pedido/PedidoInternoCabecalhoAcoes";
import { PedidoUrgenciaDefinir } from "@/components/pedido/PedidoUrgenciaDefinir";
import { pedidoInternoNumero, type pedidoInternoSituacao } from "@/lib/pedido/status";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { URGENCIA_LABEL, type PedidoDetalhe } from "@/lib/pedido/detalhe";
import type { AreaPedido } from "@/lib/pedido/areas";

type Props = {
  pedido: PedidoDetalhe;
  statusMeta: ReturnType<typeof pedidoInternoSituacao>;
  projeto: string;
  coordenadorProjeto: string;
  modalidadeLabel: Record<string, string>;
  avisoControlado: string | null;
  datasCiclo: { solicitadoEm: string | null; aprovadoEm: string | null; };
  cicloTravadoAte: string | null;
  pedidoId: number;
  areas: AreaPedido[];
  projetos: { id: number; nome: string; coordenador: string | null }[] | null;
  podeGerir: boolean;
  /** tem "Definir urgência do pedido" e o pedido ainda não foi encerrado (0183) */
  podeDefinirUrgencia: boolean;
};

/** Topo do pedido: número, situação, título, quem pediu, ciclo e ações do cabeçalho. */
export function PedidoCabecalho({
  pedido,
  statusMeta,
  projeto,
  coordenadorProjeto,
  modalidadeLabel,
  avisoControlado,
  datasCiclo,
  cicloTravadoAte,
  pedidoId,
  areas,
  projetos,
  podeGerir,
  podeDefinirUrgencia,
}: Props) {
  return (
    <div className="mt-2 flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium tabular-nums text-muted-foreground">{pedidoInternoNumero(pedido.id)}</p>
          <span className={`rounded-md px-2.5 py-1 text-xs font-medium ${statusMeta.className}`}>
            {statusMeta.label}
          </span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{pedido.titulo}</h1>
        <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Dados do pedido" data-testid="pedido-fatos">
          <Fato rotulo={projeto && projeto !== "—" ? "Projeto" : null}>{projeto && projeto !== "—" ? projeto : "Sem projeto"}</Fato>
          <Fato rotulo="Solicitante">{pedido.solicitante ?? "—"}</Fato>
          {pedido.data_necessidade && <Fato rotulo="Necessidade">{formatDate(pedido.data_necessidade)}</Fato>}
          <Fato rotulo="Urgência" destaque={ehUrgente(pedido.urgencia)}>
            {URGENCIA_LABEL[pedido.urgencia ?? "normal"] ?? pedido.urgencia}
          </Fato>
          {pedido.natureza && <Fato rotulo={null}>{rotuloNatureza(pedido.natureza)}</Fato>}
          {pedido.objetivo && <Fato rotulo="Objetivo">{rotuloObjetivo(pedido.objetivo)}</Fato>}
          <Fato rotulo="Uso">{rotuloUso(pedido.tipo_demanda)}</Fato>
          <Fato rotulo="Coordenador">
            {coordenadorProjeto}
            {pedido.aprovador_coordenador_diferente ? " (aprovado por substituto)" : ""}
          </Fato>
          {pedido.modalidade_compra && (
            <Fato rotulo="Modalidade">{modalidadeLabel[pedido.modalidade_compra] ?? pedido.modalidade_compra}</Fato>
          )}
        </ul>
        {pedido.justificativa && (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{pedido.justificativa}</p>
        )}
        {ehUrgente(pedido.urgencia) && pedido.urgencia_justificativa && (
          <p className="mt-1 max-w-3xl text-sm text-warning-strong">
            <span aria-hidden="true">! </span>Urgente: {pedido.urgencia_justificativa}
          </p>
        )}
        {avisoControlado && (
          <p className="mt-1 max-w-3xl text-sm text-warning-strong" data-testid="controlado-funpar">
            <span aria-hidden="true">! </span>{avisoControlado}
          </p>
        )}
        <p className="mt-2 inline-flex max-w-3xl items-start gap-1.5 rounded-md bg-info-soft px-2.5 py-1.5 text-xs text-foreground empty:hidden" data-testid="ciclo-pagamento">
          {pedido.ciclo_pagamento
            ? `${datasCiclo.solicitadoEm ? `Solicitado em ${rotuloData(dataEmBrasilia(new Date(datasCiclo.solicitadoEm)))} · ` : ""}${datasCiclo.aprovadoEm ? `Aprovado pela coordenação em ${rotuloData(dataEmBrasilia(new Date(datasCiclo.aprovadoEm)))} (esta data define o ciclo) · ` : ""}Ciclo de compras: ${rotuloCiclo(pedido.ciclo_pagamento)}${ehUrgente(pedido.urgencia) ? " (urgente)" : ""} · prazo ${rotuloPrazo(prazoDoCiclo(pedido.ciclo_pagamento))}.${cicloTravadoAte ? ` Segue para compras a partir de ${rotuloData(cicloTravadoAte)}.` : ""}`
            : ["rascunho", "em_validacao", "ajuste_solicitante", "ajuste_compras", "validado"].includes(pedido.status)
              ? explicarCicloHoje(dataEmBrasilia(new Date()), ehUrgente(pedido.urgencia))
              : null}
        </p>
      </div>
      <div className="flex flex-col items-start gap-2 sm:items-end">
        <span className="text-xs text-muted-foreground">Atualizado {formatDateTime(pedido.atualizado_em)}</span>
        {podeDefinirUrgencia && (
          <PedidoUrgenciaDefinir
            pedidoId={pedidoId}
            numero={pedidoInternoNumero(pedido.id)}
            urgencia={pedido.urgencia}
            urgenciaJustificativa={pedido.urgencia_justificativa ?? null}
          />
        )}
        <PedidoInternoCabecalhoAcoes
          pedidoId={pedidoId}
          numero={pedidoInternoNumero(pedido.id)}
          titulo={pedido.titulo}
          projetoId={pedido.projeto_id}
          dataNecessidade={pedido.data_necessidade}
          urgencia={pedido.urgencia}
          tipoDemanda={pedido.tipo_demanda}
          natureza={pedido.natureza}
          objetivo={pedido.objetivo}
          areaId={pedido.area_id ?? null}
          areas={areas}
          justificativa={pedido.justificativa}
          projetos={projetos ?? []}
          status={pedido.status}
          podeExcluir={podeGerir && pedido.pedido_compra_id === null}
        />
      </div>
    </div>
  );
}

/** Um dado do pedido numa caixinha: "Rótulo: valor". */
function Fato({
  rotulo,
  destaque = false,
  children,
}: {
  rotulo: string | null;
  destaque?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li
      className={
        destaque
          ? "inline-flex items-center rounded-md border border-warning-strong/30 bg-warning-soft px-2 py-1 text-xs text-warning-strong"
          : "inline-flex items-center rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-foreground"
      }
    >
      {rotulo && <span className="mr-1 text-muted-foreground">{rotulo}:{" "}</span>}
      <span className="font-medium">{children}</span>
    </li>
  );
}
