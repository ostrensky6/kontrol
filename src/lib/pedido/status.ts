export const PEDIDO_INTERNO_STATUS = {
  rascunho: {
    label: "Rascunho",
    etapa: "Lista de materiais",
    className: "bg-muted text-muted-foreground",
  },
  em_validacao: {
    label: "Aguardando coordenador",
    etapa: "Aprovação pelo coordenador do projeto",
    className: "bg-warning-soft text-warning-strong",
  },
  // 0188: nova ordem das aprovações (pedidos novos). Os três status abaixo
  // substituem em_validacao, validado e a análise administrativa.
  aguardando_area: {
    label: "Aguardando laboratório ou campo",
    etapa: "Aprovação do laboratório ou campo",
    className: "bg-warning-soft text-warning-strong",
  },
  aguardando_financeiro: {
    label: "Aguardando financeiro",
    etapa: "Aprovação financeira e fonte de pagamento",
    className: "bg-warning-soft text-warning-strong",
  },
  // 0189 (relatório da Rafaela, 28/11/2026): depois do financeiro, quem pediu
  // faz a cotação (3 orçamentos de fornecedores diferentes, com documento)
  aguardando_cotacao: {
    label: "Cotação com o solicitante",
    etapa: "Cotação: 3 orçamentos de fornecedores diferentes",
    className: "bg-info-soft text-info-strong",
  },
  aguardando_projeto: {
    label: "Aguardando coordenador do projeto",
    etapa: "Aprovação do coordenador do projeto",
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
 * 0169: material de consumo de laboratório validado pelo coordenador ainda
 * espera a coordenação do laboratório. O status no banco continua "validado";
 * a tela mostra a situação real, por escrito.
 */
export const PEDIDO_INTERNO_AGUARDANDO_LABORATORIO = {
  label: "Aguardando coordenação do laboratório",
  etapa: "Aprovação da coordenação do laboratório",
  className: "bg-warning-soft text-warning-strong",
} as const;

/**
 * 0186: reprovar encerra o pedido. No banco ele fica "cancelado" (o mesmo fim
 * do Cancelar, com a compra ligada cancelada junto); a tela diz "Reprovado"
 * quando a decisão gravada foi a reprovação.
 */
export const PEDIDO_INTERNO_REPROVADO = {
  label: "Reprovado",
  etapa: "Encerrado na aprovação",
  className: "bg-danger-soft text-danger-strong",
} as const;

export function pedidoInternoSituacao(
  pedido: {
    status: string | null | undefined;
    natureza?: string | null;
    aprovacao_area_em?: string | null;
  },
  aprovacoes?: readonly { decisao?: string | null }[] | null,
) {
  if (pedido.status === "validado" && pedido.natureza === "material_consumo_lab" && !pedido.aprovacao_area_em) {
    return PEDIDO_INTERNO_AGUARDANDO_LABORATORIO;
  }
  if (pedido.status === "cancelado" && (aprovacoes ?? []).some((a) => a.decisao === "reprovado")) {
    return PEDIDO_INTERNO_REPROVADO;
  }
  return pedidoInternoStatus(pedido.status);
}

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

/** 0188: ordem nova dos pedidos (fluxo 2). */
export const PEDIDO_INTERNO_FLUXO_NOVO: PedidoInternoStatus[] = [
  "rascunho",
  "aguardando_area",
  "aguardando_financeiro",
  "aguardando_cotacao",
  "aguardando_projeto",
  "aprovado_para_compra",
];

/** Status de aprovação da ordem nova (0188), na ordem em que acontecem. */
export const STATUS_APROVACAO_FLUXO_NOVO = ["aguardando_area", "aguardando_financeiro", "aguardando_projeto"] as const;

export function emAprovacaoFluxoNovo(status: string | null | undefined): boolean {
  return (STATUS_APROVACAO_FLUXO_NOVO as readonly string[]).includes(status ?? "");
}

/**
 * 0189: a cotação da ordem nova, entre o financeiro e o coordenador do
 * projeto. Não é aprovação: quem pediu registra os 3 orçamentos e envia.
 */
export const STATUS_COTACAO_FLUXO_NOVO = "aguardando_cotacao";

export function naCotacaoFluxoNovo(status: string | null | undefined): boolean {
  return status === STATUS_COTACAO_FLUXO_NOVO;
}

/** Pedido da ordem nova (0188). Linha sem a coluna (mock antigo, testes) é da ordem antiga. */
export function pedidoDoFluxoNovo(pedido: { fluxo?: number | null } | null | undefined): boolean {
  return Number(pedido?.fluxo ?? 1) === 2;
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

/**
 * Pedido interno que ainda segura a compra formal ligada a ele (0130, D1): a
 * compra só é aprovada ou enviada depois que todo pedido interno de origem
 * (não cancelado) chega a "Aprovado para compra". Devolve o primeiro que
 * bloqueia, ou null quando a compra pode seguir.
 */
export function pedidoQueSeguraCompra(
  pedidos: { id: number; status: string | null }[],
): { id: number; rotulo: string } | null {
  const bloqueio = pedidos
    .filter((p) => p.status !== "cancelado" && !podeMarcarRecebida(p.status ?? ""))
    .sort((a, b) => a.id - b.id)[0];
  return bloqueio ? { id: bloqueio.id, rotulo: pedidoInternoStatus(bloqueio.status).label } : null;
}
