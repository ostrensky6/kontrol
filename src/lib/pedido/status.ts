export const PEDIDO_INTERNO_STATUS = {
  rascunho: {
    label: "Rascunho",
    etapa: "Lista de materiais",
    className: "bg-muted text-muted-foreground",
  },
  em_validacao: {
    label: "Aguardando coordenador",
    etapa: "Validação pelo coordenador do projeto",
    className: "bg-warning-soft text-warning-strong",
  },
  ajuste_solicitante: {
    label: "Devolvido ao solicitante",
    etapa: "Verificação com solicitante",
    className: "bg-warning-soft text-warning-strong",
  },
  validado: {
    label: "Aprovado pelo coordenador",
    etapa: "Informações confirmadas pelo coordenador",
    className: "bg-info-soft text-info-strong",
  },
  formalizado: {
    label: "Aguardando administrativo",
    etapa: "Pedido formal em compras/administração",
    className: "bg-info-soft text-info-strong",
  },
  analise_administrativa: {
    label: "Em análise administrativa",
    etapa: "Fonte, rubrica e conformidade",
    className: "bg-warning-soft text-warning-strong",
  },
  ajuste_compras: {
    label: "Devolvido a Compras",
    etapa: "Verificação com compras/solicitante",
    className: "bg-warning-soft text-warning-strong",
  },
  aprovado_compra: {
    label: "Aguardando cotação",
    etapa: "Aprovação administrativa",
    className: "bg-success-soft text-success-strong",
  },
  orcamentos: {
    label: "Em cotação",
    etapa: "Levantamento de cotações",
    className: "bg-info-soft text-info-strong",
  },
  orcamentos_recebidos: {
    label: "Cotações recebidas",
    etapa: "Cotações anexadas",
    className: "bg-info-soft text-info-strong",
  },
  aguardando_aprovacao_final: {
    label: "Aguardando aprovação final",
    etapa: "Escolha do caminho de compra",
    className: "bg-warning-soft text-warning-strong",
  },
  aprovado_para_compra: {
    label: "Aprovado para compra",
    etapa: "Definir compra direta ou instituição",
    className: "bg-success-soft text-success-strong",
  },
  compra_fechada: {
    label: "Compra direta em andamento",
    etapa: "Fornecedor e documentos",
    className: "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300",
  },
  encaminhado_instituicao: {
    label: "Enviado à Fundação/Universidade",
    etapa: "Instituição compradora",
    className: "bg-info-soft text-info-strong",
  },
  aguardando_pagamento_nf: {
    label: "Aguardando pagamento/NF",
    etapa: "Boleto, nota ou comprovante",
    className: "bg-warning-soft text-warning-strong",
  },
  compra_concluida: {
    label: "Compra concluída",
    etapa: "Documentos finais registrados",
    className: "bg-success-soft text-success-strong",
  },
  cancelado: {
    label: "Cancelado",
    etapa: "Processo encerrado",
    className: "bg-danger-soft text-danger-strong",
  },
} as const;

export type PedidoInternoStatus = keyof typeof PEDIDO_INTERNO_STATUS;

/**
 * Etapa 11 — "Compra recebida". É uma marca paralela (coluna `recebido_em`),
 * não um status do fluxo: pode ser registrada a qualquer momento após a
 * aprovação da compra, sem interferir no andamento de pagamento/NF.
 */
export const PEDIDO_INTERNO_ETAPA_RECEBIDA = {
  label: "Compra recebida",
  etapa: "Produto ou serviço entregue",
} as const;

/**
 * Status em que a compra já foi aprovada e o pedido aguarda a chegada do
 * produto/serviço — base da subaba de síntese e do gatilho da etapa 11.
 */
export const PEDIDO_INTERNO_AGUARDANDO_CHEGADA: PedidoInternoStatus[] = [
  "aprovado_para_compra",
  "compra_fechada",
  "encaminhado_instituicao",
  "aguardando_pagamento_nf",
  "compra_concluida",
];

/** Pode-se marcar/desmarcar "Compra recebida" a partir da aprovação da compra. */
export function podeMarcarRecebida(status: string) {
  return PEDIDO_INTERNO_AGUARDANDO_CHEGADA.includes(status as PedidoInternoStatus);
}

export const PEDIDO_INTERNO_FLUXO: PedidoInternoStatus[] = [
  "rascunho",
  "em_validacao",
  "validado",
  "formalizado",
  "analise_administrativa",
  "aprovado_compra",
  "orcamentos",
  "orcamentos_recebidos",
  "aguardando_aprovacao_final",
  "aprovado_para_compra",
];

export function pedidoInternoStatus(status: string | null | undefined) {
  return PEDIDO_INTERNO_STATUS[(status ?? "rascunho") as PedidoInternoStatus] ?? PEDIDO_INTERNO_STATUS.rascunho;
}

/** Número sequencial e único do pedido (derivado do id) — ex.: "Nº 0007". */
export function pedidoInternoNumero(id: number) {
  return `Nº ${String(id).padStart(4, "0")}`;
}
