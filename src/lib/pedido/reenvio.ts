/**
 * Devolução sem perder as aprovações (0175, decisão D5 de 09/11/2026).
 *
 * O banco guarda a foto do que o coordenador validou (projeto, justificativa,
 * valor e, desde a 0177, os itens: item, quantidade e especificação). No
 * reenvio depois de um ajuste, se tudo está igual, as
 * aprovações continuam valendo e o pedido volta direto para "validado"; se algo
 * mudou, passa de novo pelo coordenador. A regra mora no banco
 * (public.reenviar_pedido_interno); a tela só explica o que vai acontecer.
 */
import { formatCurrency as brl } from "@/lib/formatters";

export const STATUS_DE_AJUSTE = ["ajuste_solicitante", "ajuste_compras"];

export type SituacaoReenvio = {
  mantem: boolean;
  mudou: string[];
  motivo: "sem_validacao" | "igual" | "mudou";
  valorAtual: number | null;
  valorValidado: number | null;
  aguardaLaboratorio: boolean;
};

type Rpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

function numeroOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/** Converte o retorno de reenvio_mantem_aprovacoes; null se não deu para ler. */
export function situacaoReenvio(bruto: unknown): SituacaoReenvio | null {
  if (!bruto || typeof bruto !== "object") return null;
  const r = bruto as Record<string, unknown>;
  const motivo = r.motivo === "igual" || r.motivo === "mudou" ? r.motivo : "sem_validacao";
  return {
    mantem: r.mantem === true,
    mudou: Array.isArray(r.mudou) ? r.mudou.filter((m): m is string => typeof m === "string") : [],
    motivo,
    valorAtual: numeroOuNulo(r.valor_atual),
    valorValidado: numeroOuNulo(r.valor_validado),
    aguardaLaboratorio: r.aguarda_laboratorio === true,
  };
}

export async function lerSituacaoReenvio(supabase: Rpc, pedidoId: number): Promise<SituacaoReenvio | null> {
  const { data, error } = await supabase.rpc("reenvio_mantem_aprovacoes", { p_pedido_id: pedidoId });
  if (error) return null;
  return situacaoReenvio(data);
}

function juntar(partes: string[]) {
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

/** O que acontece ao reenviar, por escrito. */
export function textoReenvio(s: SituacaoReenvio | null): string | null {
  if (!s) return null;
  if (s.motivo === "sem_validacao") {
    return "Ao reenviar, o pedido vai para a validação do coordenador.";
  }
  if (s.mantem) {
    return `Itens, valor, justificativa e projeto estão iguais aos da aprovação: ao reenviar, as aprovações continuam valendo e o pedido volta direto para ${
      s.aguardaLaboratorio ? "a coordenação do laboratório" : "o administrativo formalizar"
    }.`;
  }
  const partes = s.mudou.map((campo) => {
    if (campo === "valor") {
      return s.valorValidado !== null && s.valorAtual !== null
        ? `o valor (${brl(s.valorValidado)} na validação, ${brl(s.valorAtual)} agora)`
        : "o valor";
    }
    if (campo === "itens") return "os itens (item, quantidade ou especificação)";
    if (campo === "justificativa") return "a justificativa";
    if (campo === "projeto") return "o projeto";
    return campo;
  });
  const verbo = partes.length > 1 || s.mudou[0] === "itens" ? "Mudaram" : "Mudou";
  return `${verbo} ${juntar(partes)}: ao reenviar, o pedido passa de novo pelo coordenador.`;
}
