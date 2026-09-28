/**
 * Regras puras do editor de custos de projeto (etapa "Custos do projeto" da proposta).
 * Sem I/O: usadas pela tela, pelas server actions e pelos testes.
 */
import { itemProjetoTotal, roundMoney, RUBRICAS_PROJETO, type RubricaProjeto } from "./orcamento-projeto";
import {
  calcularQuantidadeViagem,
  classificarDespesaViagem,
  type ViagemInputs,
} from "./travel";
import type { LinhaPlanoCatalogo } from "./catalogo-vivo";
import { formatCurrency as brl } from "@/lib/formatters";
import { MESES_VALOR_VELHO, valorDesatualizado } from "@/lib/orcamento/catalogo-custos";

export const ORDEM_RUBRICAS = Object.keys(RUBRICAS_PROJETO) as RubricaProjeto[];

export type CustoEditor = {
  rubrica?: string | null;
  quantidade?: number | null;
  custo_unitario?: number | null;
  meses_selecionados?: number[] | null;
};

/** Subtotal técnico da linha: PE com meses = meses × valor mensal; demais = quantidade × custo unitário. */
export function subtotalCusto(item: CustoEditor) {
  return itemProjetoTotal({
    rubrica: item.rubrica,
    quantidade: Number(item.quantidade ?? 0),
    preco_unitario: Number(item.custo_unitario ?? 0),
    meses_selecionados: item.meses_selecionados ?? [],
  });
}

export type ResumoRubrica = { codigo: RubricaProjeto; nome: string; total: number; itens: number };

/**
 * Totais por rubrica. `analisesMC` são as análises lançadas dentro do projeto (caixa antiga,
 * DC3): entram em MC como no total, na emissão e na planilha.
 */
export function resumirRubricas(
  custos: CustoEditor[],
  analisesMC: { total: number; itens: number } = { total: 0, itens: 0 },
): ResumoRubrica[] {
  return ORDEM_RUBRICAS.map((codigo) => {
    const itens = custos.filter((item) => (item.rubrica ?? "OU") === codigo);
    const extra = codigo === "MC" ? analisesMC : { total: 0, itens: 0 };
    return {
      codigo,
      nome: RUBRICAS_PROJETO[codigo],
      total: roundMoney(itens.reduce((soma, item) => soma + subtotalCusto(item), 0) + extra.total),
      itens: itens.length + extra.itens,
    };
  });
}

/** Páginas de 12 meses para a grade de pessoal: ano 1 = M1–M12, ano 2 = M13–M24… */
export function anosDoProjeto(meses: number) {
  const total = Math.max(1, Math.floor(Number(meses) || 1));
  return Array.from({ length: Math.ceil(total / 12) }, (_, indice) => {
    const inicio = indice * 12 + 1;
    const fim = Math.min(total, inicio + 11);
    return { ano: indice + 1, inicio, fim, meses: Array.from({ length: fim - inicio + 1 }, (_, i) => inicio + i) };
  });
}

/** Normaliza os meses marcados: inteiros, dentro de 1..mesesProjeto, sem repetição, ordenados. */
export function normalizarMeses(valores: unknown[], mesesProjeto: number) {
  const limite = Math.max(1, Math.floor(Number(mesesProjeto) || 1));
  return [...new Set(valores.map((valor) => Number(valor)))]
    .filter((mes) => Number.isInteger(mes) && mes >= 1 && mes <= limite)
    .sort((a, b) => a - b);
}

export type SituacaoQuantidadeViagem = "calculado" | "ajustado" | "manual";

/** Compara a quantidade gravada com a calculada pelas entradas de viagem. */
export function situacaoQuantidadeViagem(
  item: { descricao: string; categoria?: string | null; quantidade?: number | null },
  inputs: ViagemInputs,
): { situacao: SituacaoQuantidadeViagem; calculada: number | null } {
  const calculada = calcularQuantidadeViagem(classificarDespesaViagem(item.descricao, item.categoria), inputs);
  if (calculada == null) return { situacao: "manual", calculada: null };
  return {
    situacao: Math.abs(Number(item.quantidade ?? 0) - calculada) < 1e-9 ? "calculado" : "ajustado",
    calculada,
  };
}

export type ItemCatalogoViagem = { id: string; descricao: string; categoria?: string | null };

/**
 * Itens de viagem do catálogo que ainda não existem no orçamento e teriam quantidade > 0
 * com as entradas informadas. Um tipo de despesa já presente (por catálogo ou pela descrição)
 * não é duplicado.
 */
export function linhasViagemFaltantes<T extends ItemCatalogoViagem>(
  catalogoVD: T[],
  custosVD: Array<{ descricao: string; categoria?: string | null; catalogo_item_id?: string | null }>,
  inputs: ViagemInputs,
) {
  const catalogoUsado = new Set(custosVD.map((item) => item.catalogo_item_id).filter(Boolean));
  const tiposPresentes = new Set(custosVD.map((item) => classificarDespesaViagem(item.descricao, item.categoria)));
  const resultado: Array<{ item: T; quantidade: number }> = [];
  for (const item of catalogoVD) {
    if (catalogoUsado.has(item.id)) continue;
    const tipo = classificarDespesaViagem(item.descricao, item.categoria);
    if (tipo === "outro" || tiposPresentes.has(tipo)) continue;
    const quantidade = calcularQuantidadeViagem(tipo, inputs);
    if (quantidade == null || quantidade <= 0) continue;
    tiposPresentes.add(tipo);
    resultado.push({ item, quantidade });
  }
  return resultado;
}

export type EstadoEdicaoProjeto = {
  editavel: boolean;
  rotulo: string;
  motivo: string | null;
  podeConcluir: boolean;
  podeReabrir: boolean;
};

/**
 * Traduz o status do orçamento de projeto. Concluir: rascunho → enviado (0137). Reabrir
 * (0139, DC4 — tudo editável): enviado, recusado ou aprovado → rascunho; com proposta aprovada
 * é reformulação. Na proposta, "enviado" significa custos revisados.
 */
export function estadoEdicaoProjeto(status: string | null | undefined): EstadoEdicaoProjeto {
  switch (status ?? "rascunho") {
    case "rascunho":
      return { editavel: true, rotulo: "Em edição", motivo: null, podeConcluir: true, podeReabrir: false };
    case "enviado":
      return {
        editavel: false,
        rotulo: "Revisado",
        motivo:
          "A revisão dos custos foi concluída e a proposta já pode usar estes valores. Para mudar, reabra a revisão.",
        podeConcluir: false,
        podeReabrir: true,
      };
    case "aprovado":
      return {
        editavel: false,
        rotulo: "Aprovado",
        motivo:
          "A proposta foi aprovada. Para mudar (reformulação pedida pelo cliente ou pelo órgão concedente), reabra a revisão informando o motivo: a nova versão, quando aprovada, substitui a atual.",
        podeConcluir: false,
        podeReabrir: true,
      };
    case "recusado":
      return {
        editavel: false,
        rotulo: "Recusado",
        motivo: "Os custos foram recusados. Reabra para corrigir e concluir a revisão de novo.",
        podeConcluir: false,
        podeReabrir: true,
      };
    case "cancelado":
      return {
        editavel: false,
        rotulo: "Cancelado",
        motivo: "Orçamento de projeto cancelado. Os registros ficam preservados apenas para histórico.",
        podeConcluir: false,
        podeReabrir: false,
      };
    default:
      return { editavel: false, rotulo: String(status), motivo: "Status desconhecido.", podeConcluir: false, podeReabrir: false };
  }
}

export type AvisoConferencia = {
  tipo: "valor_zero" | "pessoal_sem_meses" | "viagem_ajustada" | "catalogo_mudou" | "valor_velho";
  texto: string;
};

type CustoConferencia = {
  id: number;
  rubrica: string | null;
  descricao: string;
  categoria?: string | null;
  quantidade: number;
  custo_unitario: number;
  meses_selecionados?: number[] | null;
};

const lista = (itens: string[]) => itens.join(", ");

/**
 * Lista de conferência antes de concluir a revisão (Fase C). Só avisa; não impede concluir.
 * `plano` é a prévia do catálogo vivo (valor e data do catálogo por linha).
 */
export function conferenciaRevisao(args: {
  custos: CustoConferencia[];
  viagem: ViagemInputs;
  plano: LinhaPlanoCatalogo[];
  hoje?: Date;
}): AvisoConferencia[] {
  const avisos: AvisoConferencia[] = [];
  const zerados = args.custos.filter((item) => !(Number(item.custo_unitario) > 0)).map((item) => item.descricao);
  if (zerados.length) {
    avisos.push({
      tipo: "valor_zero",
      texto: `${zerados.length} ${zerados.length === 1 ? "item" : "itens"} com valor zero: ${lista(zerados)}.`,
    });
  }
  const semMeses = args.custos
    .filter((item) => item.rubrica === "PE" && !(item.meses_selecionados?.length))
    .map((item) => item.descricao);
  if (semMeses.length) {
    avisos.push({
      tipo: "pessoal_sem_meses",
      texto: `Pessoal sem meses marcados na grade (conta pela quantidade): ${lista(semMeses)}.`,
    });
  }
  const ajustadas = args.custos.flatMap((item) => {
    if (item.rubrica !== "VD") return [];
    const situacao = situacaoQuantidadeViagem(item, args.viagem);
    return situacao.situacao === "ajustado"
      ? [`${item.descricao} (${Number(item.quantidade).toLocaleString("pt-BR")}; calculado: ${Number(situacao.calculada).toLocaleString("pt-BR")})`]
      : [];
  });
  if (ajustadas.length) {
    avisos.push({ tipo: "viagem_ajustada", texto: `Viagem com quantidade diferente da calculada: ${lista(ajustadas)}.` });
  }
  const ligadas = args.plano.filter((linha) => linha.acao === "inalterado" || linha.acao === "vincular");
  const mudou = ligadas
    .filter((linha) => linha.valorCatalogo != null && Math.abs(linha.valorCatalogo - linha.valor) >= 0.005)
    .map((linha) => `${linha.descricao} (catálogo ${brl(Number(linha.valorCatalogo))})`);
  if (mudou.length) {
    avisos.push({
      tipo: "catalogo_mudou",
      texto: `Valor diferente do catálogo atual (este orçamento mantém o seu): ${lista(mudou)}.`,
    });
  }
  const velhos = ligadas
    .filter((linha) => valorDesatualizado(linha.valorCatalogoEm, args.hoje))
    .map((linha) => linha.descricao);
  if (velhos.length) {
    avisos.push({
      tipo: "valor_velho",
      texto: `Valor do catálogo com mais de ${MESES_VALOR_VELHO} meses sem atualizar: ${lista(velhos)}.`,
    });
  }
  return avisos;
}
