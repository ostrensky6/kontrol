import { avaliarModuloOperacional } from "@/lib/orcamento/modulo-status";
import { type StatusPropostaFinal } from "@/lib/orcamento/proposta-final";
import type { Tables } from "@/lib/supabase/database.types";

/** Linha de demandas_propostas, como a tela do orçamento recebe do banco. */
export type DemandaDetalhe = Tables<"demandas_propostas">;

/** Versão da proposta final, nas colunas que a tela lê. */
export type VersaoFinalResumo = Pick<
  Tables<"orcamento_final_versoes">,
  "id" | "versao" | "numero" | "status" | "total_final" | "valido_ate" | "criado_em"
>;

// Rótulos de exibição. As modalidades legadas continuam mapeadas para leitura de
// dados antigos; a forma canônica `projeto_com_analises` é o destino normalizado.
export const MODALIDADES: Record<string, string> = {
  analises: "Apenas análises laboratoriais",
  projeto: "Apenas projeto",
  projeto_com_analises: "Projeto com análises laboratoriais",
  analises_projeto: "Análises dentro de projeto",
  projeto_analises_custos: "Projeto com custos próprios e análises laboratoriais",
};

export const ROTULO_PRIORIDADE: Record<string, string> = { baixa: "baixa", normal: "normal", alta: "alta", urgente: "urgente" };

// Opções oferecidas em novos cadastros: apenas as três modalidades canônicas.
export const MODALIDADES_SELECIONAVEIS: Array<[string, string]> = [
  ["analises", MODALIDADES.analises],
  ["projeto", MODALIDADES.projeto],
  ["projeto_com_analises", MODALIDADES.projeto_com_analises],
];

export const STATUS_FINAL_CLS: Record<StatusPropostaFinal, string> = {
  bloqueada: "bg-danger-soft text-danger-strong",
  em_composicao: "bg-warning-soft text-warning-strong",
  aguardando_revisao: "bg-warning-soft text-warning-strong",
  pronta_para_emitir: "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300",
  emitida: "bg-success-soft text-success-strong",
  substituida: "bg-muted text-muted-foreground",
  cancelada: "bg-muted text-muted-foreground",
};

export type OrcamentoAnalisesResumo = {
  id: number;
  status: string;
  data_orcamento: string | null;
  orcamento_itens?: { id: number; codigo_analise: string | null; n_amostras: number; custo_unitario: number; preco_unitario: number }[] | null;
};

export type OrcamentoProjetoResumo = {
  id: number;
  status: string;
  reformulacao_de_versao_id?: number | null;
  data_orcamento: string | null;
  titulo: string | null;
  projeto_sem_custo_justificativa?: string | null;
  impostos: number | null;
  margem_lucro: number | null;
  impostos_legacy: number | null;
  incubacao: number | null;
  reserva: number | null;
  investimentos: number | null;
  lucro: number | null;
  orcamento_projeto_analises?: { id: number; codigo_analise: string | null; n_amostras: number; custo_unitario: number; preco_unitario: number }[] | null;
  orcamento_projeto_custos?: {
    id: number;
    rubrica: string | null;
    descricao: string | null;
    unidade: string | null;
    categoria: string | null;
    quantidade: number;
    custo_unitario: number;
    preco_unitario: number;
    meses_selecionados: number[] | null;
  }[] | null;
};

export function statusClasse(status: ReturnType<typeof avaliarModuloOperacional>["status"]) {
  if (status === "revisado") {
    return "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300";
  }
  if (status === "preenchido") {
    return "bg-warning-soft text-warning-strong";
  }
  if (status === "pendente") {
    return "bg-danger-soft text-danger-strong";
  }
  return "bg-muted text-muted-foreground";
}
