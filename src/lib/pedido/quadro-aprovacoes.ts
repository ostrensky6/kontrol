/**
 * Quadro de aprovações (pedido de Antonio e da Rafaela, 27/11/2026): um pedido
 * por linha e as três aprovações lado a lado, na ordem que a equipe pediu:
 * coordenação do laboratório, coordenação financeira e coordenação do projeto.
 * Cores que Antonio definiu (27/11, 15:05): verde aprovado; amarelo devolvido
 * ao solicitante para corrigir (o pedido continua); vermelho reprovado (o
 * pedido acaba). A vez de cada coordenação fica com o contorno azul e o que
 * ainda não chegou lá, cinza.
 *
 * Aqui só se lê o que o fluxo já grava (pedidos_internos_aprovacoes e o
 * status). A ordem real das etapas continua a do banco; o quadro mostra cada
 * coluna como está agora.
 */
import { aguardaLaboratorio } from "./aprovadores";

export type ChaveAprovacao = "laboratorio" | "financeiro" | "projeto";
export type SituacaoAprovacao = "aprovado" | "devolvido" | "reprovado" | "aguardando" | "futura" | "nao_se_aplica";

export type RegistroAprovacao = {
  etapa: string;
  decisao: string;
  responsavel?: string | null;
  comentario?: string | null;
  status_origem?: string | null;
  criado_em: string;
};

export type PedidoDoQuadro = {
  status: string;
  natureza?: string | null;
  aprovacao_area_em?: string | null;
  aprovacao_area_por?: string | null;
};

export type ColunaAprovacao = {
  chave: ChaveAprovacao;
  situacao: SituacaoAprovacao;
  /** texto da situação, sempre escrito: a cor nunca é o único sinal */
  rotulo: string;
  /** quem decidiu (e-mail ou nome, como o banco gravou) */
  quem: string | null;
  quando: string | null;
  /** motivo da devolução ou da reprovação, ou a observação da aprovação */
  motivo: string | null;
};

export const COLUNAS_QUADRO: ReadonlyArray<{ chave: ChaveAprovacao; titulo: string; tituloCurto: string }> = [
  { chave: "laboratorio", titulo: "Coordenação do laboratório", tituloCurto: "Laboratório" },
  { chave: "financeiro", titulo: "Coordenação financeira", tituloCurto: "Financeiro" },
  { chave: "projeto", titulo: "Coordenação do projeto", tituloCurto: "Projeto" },
];

/** Nome de cada etapa como o banco grava em pedidos_internos_aprovacoes.etapa. */
const ETAPAS_DA_COLUNA: Record<ChaveAprovacao, readonly string[]> = {
  laboratorio: ["Aprovação da coordenação do laboratório"],
  // a aprovação é a "Liberação para cotação"; a devolução fica na análise
  financeiro: ["Liberação para cotação", "Análise de fonte de recurso, rubrica e conformidade"],
  projeto: ["Validação das especificações técnicas"],
};

const DECISOES = new Set(["aprovado", "devolvido", "reprovado"]);
/** Status de onde sai um envio ou reenvio: uma devolução anterior a ele já foi respondida. */
const ORIGENS_DE_ENVIO = new Set(["rascunho", "ajuste_solicitante", "ajuste_compras"]);

const DEPOIS_DO_PROJETO = new Set([
  "validado",
  "formalizado",
  "analise_administrativa",
  "ajuste_compras",
  "aprovado_compra",
  "orcamentos",
  "orcamentos_recebidos",
  "aguardando_aprovacao_final",
  "aprovado_para_compra",
  "compra_fechada",
  "encaminhado_instituicao",
  "aguardando_pagamento_nf",
  "compra_concluida",
]);
const DEPOIS_DO_LABORATORIO = new Set([...DEPOIS_DO_PROJETO].filter((s) => s !== "validado"));
const DEPOIS_DO_FINANCEIRO = new Set([
  "aprovado_compra",
  "orcamentos",
  "orcamentos_recebidos",
  "aguardando_aprovacao_final",
  "aprovado_para_compra",
  "compra_fechada",
  "encaminhado_instituicao",
  "aguardando_pagamento_nf",
  "compra_concluida",
]);
/** Etapa Administrativo, antes da autorização (validado só quando não espera o laboratório). */
const VEZ_DO_FINANCEIRO = new Set(["validado", "formalizado", "analise_administrativa"]);

const ROTULO: Record<SituacaoAprovacao, string> = {
  aprovado: "Aprovado",
  devolvido: "Devolvido",
  reprovado: "Reprovado",
  aguardando: "Aguardando",
  futura: "Ainda não chegou",
  nao_se_aplica: "Não se aplica",
};

function coluna(chave: ChaveAprovacao, situacao: SituacaoAprovacao, extra: Partial<ColunaAprovacao> = {}): ColunaAprovacao {
  return { chave, situacao, rotulo: ROTULO[situacao], quem: null, quando: null, motivo: null, ...extra };
}

function maisRecente<T extends { criado_em: string }>(lista: T[]): T | null {
  return lista.reduce<T | null>((acc, r) => (!acc || r.criado_em > acc.criado_em ? r : acc), null);
}

/**
 * As três colunas de um pedido. Uma devolução vale enquanto o pedido não foi
 * reenviado depois dela; reenviado, a coluna volta a seguir o status.
 */
export function colunasAprovacao(
  pedido: PedidoDoQuadro,
  registros: readonly RegistroAprovacao[] | null | undefined,
): Record<ChaveAprovacao, ColunaAprovacao> {
  const lista = [...(registros ?? [])];
  const ultimoEnvio = maisRecente(lista.filter((r) => ORIGENS_DE_ENVIO.has(String(r.status_origem ?? ""))));
  const status = pedido.status;
  const cancelado = status === "cancelado";

  function decisao(chave: ChaveAprovacao) {
    const ultima = maisRecente(
      lista.filter((r) => ETAPAS_DA_COLUNA[chave].includes(r.etapa) && DECISOES.has(r.decisao)),
    );
    if (!ultima) return null;
    // devolução já respondida por um reenvio não pinta mais a coluna
    if (ultima.decisao === "devolvido" && ultimoEnvio && ultimoEnvio.criado_em > ultima.criado_em) return null;
    return ultima;
  }

  function pelaDecisao(chave: ChaveAprovacao, r: RegistroAprovacao): ColunaAprovacao {
    const situacao: SituacaoAprovacao =
      r.decisao === "aprovado" ? "aprovado" : r.decisao === "reprovado" ? "reprovado" : "devolvido";
    return coluna(chave, situacao, {
      quem: r.responsavel ?? null,
      quando: r.criado_em,
      motivo: r.comentario?.trim() ? r.comentario.trim() : null,
    });
  }

  // Coordenação do laboratório: hoje só para material de consumo de laboratório (0169)
  const laboratorio = (() => {
    const r = decisao("laboratorio");
    if (aguardaLaboratorio(pedido)) return coluna("laboratorio", "aguardando");
    if (r) return pelaDecisao("laboratorio", r);
    if (pedido.aprovacao_area_em) {
      return coluna("laboratorio", "aprovado", { quem: pedido.aprovacao_area_por ?? null, quando: pedido.aprovacao_area_em });
    }
    if (pedido.natureza !== "material_consumo_lab" || cancelado || DEPOIS_DO_LABORATORIO.has(status)) {
      return coluna("laboratorio", "nao_se_aplica");
    }
    return coluna("laboratorio", "futura");
  })();

  const projeto = (() => {
    if (status === "em_validacao") return coluna("projeto", "aguardando");
    const r = decisao("projeto");
    if (r) return pelaDecisao("projeto", r);
    if (DEPOIS_DO_PROJETO.has(status)) return coluna("projeto", "aprovado");
    return coluna("projeto", cancelado ? "nao_se_aplica" : "futura");
  })();

  const financeiro = (() => {
    if (VEZ_DO_FINANCEIRO.has(status) && !aguardaLaboratorio(pedido)) return coluna("financeiro", "aguardando");
    const r = decisao("financeiro");
    if (r) return pelaDecisao("financeiro", r);
    if (DEPOIS_DO_FINANCEIRO.has(status)) return coluna("financeiro", "aprovado");
    return coluna("financeiro", cancelado ? "nao_se_aplica" : "futura");
  })();

  return { laboratorio, financeiro, projeto };
}

/** Termo de referência do pedido (o mais recente com arquivo), para a coluna "Termo". */
export function termoDeReferencia<T extends { id: number; tipo: string }>(anexos: readonly T[] | null | undefined): T | null {
  const termos = (anexos ?? []).filter((a) => a.tipo === "termo_referencia");
  return termos.reduce<T | null>((acc, a) => (!acc || a.id > acc.id ? a : acc), null);
}

/** Itens numa linha curta: até três nomes e "+N". */
export function resumoItens(itens: ReadonlyArray<{ especificacao?: string | null }> | null | undefined, maximo = 3): string {
  const nomes = (itens ?? []).map((i) => (i.especificacao ?? "").trim()).filter(Boolean);
  if (!nomes.length) return "Sem itens";
  const mostrados = nomes.slice(0, maximo).join("; ");
  return nomes.length > maximo ? `${mostrados} +${nomes.length - maximo}` : mostrados;
}
