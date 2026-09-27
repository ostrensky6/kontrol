import type { Tone } from "@/components/app/StatCard";
import { PEDIDO_INTERNO_STATUS } from "@/lib/pedido/status";

export type StatusInfo = { label: string; tone: Tone };

/** Dicionário único status→cor: o mesmo status tem sempre a mesma cor no app inteiro. */
const STATUS: Record<string, StatusInfo> = {
  // Elaboração / neutros
  em_elaboracao: { label: "Em elaboração", tone: "neutral" },
  proposto: { label: "Proposto", tone: "warning" },
  em_composicao: { label: "Em composição", tone: "neutral" },
  em_preparacao: { label: "Em preparação", tone: "neutral" },
  nova: { label: "Nova", tone: "neutral" },
  arquivado: { label: "Arquivado", tone: "neutral" },
  arquivada: { label: "Arquivada", tone: "neutral" },
  consumido: { label: "Consumido", tone: "neutral" },
  inativo: { label: "Inativo", tone: "neutral" },
  inativa: { label: "Inativa", tone: "neutral" },
  nao_exigido: { label: "Não exigido", tone: "neutral" },
  nao_aplicavel: { label: "Não aplicável", tone: "neutral" },

  // Andamento / informativos
  iniciado: { label: "Iniciado", tone: "info" },
  em_execucao: { label: "Em execução", tone: "info" },
  em_uso: { label: "Em uso", tone: "info" },
  em_analise_cliente: { label: "Em análise do cliente", tone: "info" },
  enviado: { label: "Enviado", tone: "info" },
  alterado_reenviado: { label: "Alterado e reenviado", tone: "info" },
  em_transito: { label: "Em trânsito", tone: "info" },
  emitido: { label: "Emitido", tone: "info" },
  orcada: { label: "Orçada", tone: "info" },
  reservado: { label: "Reservado", tone: "info" },

  // Atenção / pendências
  pendente: { label: "Pendente", tone: "warning" },
  solicitado: { label: "Solicitado", tone: "warning" },
  parcial: { label: "Parcial", tone: "warning" },
  em_analise: { label: "Em análise", tone: "warning" },
  em_revisao: { label: "Em revisão", tone: "warning" },
  revisao: { label: "Revisão", tone: "warning" },
  quarentena: { label: "Quarentena", tone: "warning" },
  reposicao: { label: "Reposição", tone: "warning" },
  repor: { label: "Repor", tone: "warning" },
  sem_validade: { label: "Sem validade", tone: "warning" },
  nao_lida: { label: "Não lida", tone: "warning" },

  // Sucesso / concluídos
  aprovado: { label: "Aprovado", tone: "success" },
  aprovada: { label: "Aprovada", tone: "success" },
  aceito: { label: "Disponível", tone: "success" },
  revisado: { label: "Revisado", tone: "success" },
  liberado: { label: "Liberado", tone: "success" },
  concluido: { label: "Concluído", tone: "success" },
  recebido: { label: "Recebido", tone: "success" },
  convertido_projeto: { label: "Convertido em projeto", tone: "success" },
  preenchido: { label: "Preenchido", tone: "success" },
  ativo: { label: "Ativo", tone: "success" },
  ativa: { label: "Ativa", tone: "success" },

  // Problemas / negativos
  perdido: { label: "Perdido", tone: "danger" },
  cancelada: { label: "Cancelada", tone: "danger" },
  recusado: { label: "Recusado", tone: "danger" },
  recusada: { label: "Recusada", tone: "danger" },
  rejeitado: { label: "Rejeitado", tone: "danger" },
  vencido: { label: "Vencido", tone: "danger" },
  substituido: { label: "Substituído", tone: "neutral" },
  bloqueado: { label: "Bloqueado", tone: "danger" },
  descartado: { label: "Descartado", tone: "danger" },
  sem_estoque: { label: "Sem estoque", tone: "danger" },
};

const TONS: Tone[] = ["success", "warning", "danger", "info", "brand"];

/** Tom a partir da classe do dicionário do pedido (ex.: "bg-warning-soft ..." → warning). */
function tomDaClasse(className: string): Tone {
  return TONS.find((tom) => className.includes(`bg-${tom}-`)) ?? "neutral";
}

export function statusInfo(status: string): StatusInfo {
  // Pedido interno e compras: rótulo e cor vêm só de lib/pedido/status (fonte única do fluxo).
  const pedido = PEDIDO_INTERNO_STATUS[status as keyof typeof PEDIDO_INTERNO_STATUS];
  if (pedido) return { label: pedido.label, tone: tomDaClasse(pedido.className) };
  return STATUS[status] ?? { label: status, tone: "neutral" };
}
