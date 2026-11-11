/**
 * Regras de edição, exclusão e cancelamento de planejamento
 * ("Excluir se não houve baixa" — migration 0111).
 *
 * Funções puras: a tela decide o que mostrar; o banco (excluir_planejamento,
 * cancelar_planejamento e o gatilho de itens) continua sendo a garantia.
 */

export const STATUS_EDITAVEIS = ["rascunho", "reservado"] as const;

export const MENSAGEM_RESERVA_DESATUALIZADA =
  "Os itens mudaram depois da reserva. Reserve os insumos de novo antes de iniciar.";

export const STATUS_PLANO_LABEL: Record<string, string> = {
  rascunho: "rascunho",
  reservado: "reservado",
  em_execucao: "em execução",
  concluido: "concluído",
  cancelado: "cancelado",
};

export type ReservaResumo = {
  status?: string | null;
  quantidade_consumida?: number | string | null;
};

export type GestaoPlano = {
  /** Contexto e itens podem ser alterados. */
  podeEditar: boolean;
  /** Explicação curta quando `podeEditar` é falso. */
  motivoSemEdicao: string | null;
  /** Ação destrutiva disponível para o status/histórico do plano. */
  acao: "excluir" | "cancelar" | null;
  /** Ação existe mas o usuário não pode executá-la agora. */
  acaoBloqueada: boolean;
  /** Explicação exibida junto da ação (bloqueio ou restrição). */
  motivoAcao: string | null;
  houveBaixa: boolean;
};

export function statusEditavel(status: string | null | undefined) {
  return (STATUS_EDITAVEIS as readonly string[]).includes(status ?? "rascunho");
}

export function houveBaixaMaterial(
  status: string | null | undefined,
  reservas: ReservaResumo[] = [],
) {
  if (status === "em_execucao" || status === "concluido") return true;
  return reservas.some(
    (reserva) => reserva.status === "consumido" || Number(reserva.quantidade_consumida ?? 0) > 0,
  );
}

export function avaliarGestaoPlano({
  status,
  reservas = [],
  podeGerir,
  pedidosAtivos = [],
}: {
  status: string | null | undefined;
  reservas?: ReservaResumo[];
  /** Papel coordenador ou superior (as RPCs exigem coordenador). */
  podeGerir: boolean;
  /** Pedidos internos vinculados e não cancelados, ex.: "#12 (rascunho)". */
  pedidosAtivos?: string[];
}): GestaoPlano {
  const atual = status ?? "rascunho";
  const podeEditar = statusEditavel(atual);
  const motivoSemEdicao = podeEditar
    ? null
    : `Plano ${STATUS_PLANO_LABEL[atual] ?? atual}: só é possível editar em rascunho ou reservado.`;
  const houveBaixa = houveBaixaMaterial(atual, reservas);

  if (houveBaixa) {
    if (atual === "concluido") {
      return {
        podeEditar, motivoSemEdicao, houveBaixa, acao: null, acaoBloqueada: true,
        motivoAcao: "Plano concluído: o histórico é preservado e não pode ser excluído nem cancelado.",
      };
    }
    if (atual === "cancelado") {
      return {
        podeEditar, motivoSemEdicao, houveBaixa, acao: null, acaoBloqueada: true,
        motivoAcao: "Plano já cancelado; como houve baixa de material, o histórico é preservado.",
      };
    }
    return {
      podeEditar, motivoSemEdicao, houveBaixa, acao: "cancelar",
      acaoBloqueada: !podeGerir,
      motivoAcao: podeGerir
        ? "Já houve baixa de material — só é possível cancelar."
        : "Somente coordenador pode cancelar planos.",
    };
  }

  if (!podeGerir) {
    return {
      podeEditar, motivoSemEdicao, houveBaixa, acao: "excluir", acaoBloqueada: true,
      motivoAcao: "Somente coordenador pode excluir planos.",
    };
  }
  if (pedidosAtivos.length > 0) {
    return {
      podeEditar, motivoSemEdicao, houveBaixa, acao: "excluir", acaoBloqueada: true,
      motivoAcao: `Cancele antes os pedidos vinculados: ${pedidosAtivos.join(", ")}.`,
    };
  }
  return { podeEditar, motivoSemEdicao, houveBaixa, acao: "excluir", acaoBloqueada: false, motivoAcao: null };
}
