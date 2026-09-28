import type { ProjetoBudgetRates } from "@/lib/project-budget/orcamento-projeto";
import { roundMoney } from "@/lib/costing/pricing";
import {
  totalLaboratorioCusto as calcularTotalLaboratorioCusto,
  totalLaboratorioPreco as calcularTotalLaboratorioPreco,
  totalProjetoCusto as calcularTotalProjetoCusto,
} from "./bases-custo";
import { calcularPropostaEconomica, parametrosDeRates } from "./engine-economica";

export type ItemLaboratorioFinal = {
  n_amostras?: number | null;
  custo_unitario?: number | null;
  preco_unitario?: number | null;
};

export type ItemProjetoFinal = {
  rubrica?: string | null;
  quantidade?: number | null;
  custo_unitario?: number | null;
  preco_unitario?: number | null;
  meses_selecionados?: number[] | null;
};

export type OrigemValorFinal = {
  campo: string;
  titulo: string;
  origem: string;
  regra: string;
  valor: number;
};

// Regra do dono (28/09): o tipo do orçamento decide o que entra na conta.
// Módulo fora do tipo não soma; se tiver itens, a emissão fica pendente até o
// usuário mudar o tipo ou retirar os itens. Nada é descartado em silêncio.
export const PENDENCIA_LABORATORIO_FORA_DO_TIPO =
  'há análises no orçamento laboratorial, mas o tipo do orçamento não inclui laboratório: mude o tipo para "Projeto com análises laboratoriais" ou retire as análises';
export const PENDENCIA_PROJETO_FORA_DO_TIPO =
  'há custos de projeto lançados, mas o tipo do orçamento não inclui projeto: mude o tipo para "Projeto com análises laboratoriais" ou retire esses custos';

/**
 * Consolidação da proposta final — usa a engine AUTORITATIVA (Política A,
 * `calcularPropostaEconomica`). Laboratório entra como custo técnico, projeto
 * como custo direto, e o gross-up é único sobre o subtotal técnico.
 *
 * `totalLaboratorioPreco` permanece exposto apenas como REFERÊNCIA/snapshot
 * operacional — não entra no fechamento consolidado (Política A).
 */
export function consolidarOrcamentoFinal(args: {
  laboratorioExigido: boolean;
  projetoExigido: boolean;
  laboratorioRevisado: boolean;
  projetoRevisado: boolean;
  itensLaboratorio: ItemLaboratorioFinal[];
  itensProjeto: ItemProjetoFinal[];
  parametrosProjeto: ProjetoBudgetRates;
}) {
  const itensLaboratorio = args.laboratorioExigido ? args.itensLaboratorio : [];
  const itensProjeto = args.projetoExigido ? args.itensProjeto : [];
  const pendencias = [
    args.laboratorioExigido && !args.laboratorioRevisado ? "revisar custos laboratoriais" : null,
    args.projetoExigido && !args.projetoRevisado ? "revisar custos de projeto" : null,
    !args.laboratorioExigido && args.itensLaboratorio.length > 0 ? PENDENCIA_LABORATORIO_FORA_DO_TIPO : null,
    !args.projetoExigido && args.itensProjeto.length > 0 ? PENDENCIA_PROJETO_FORA_DO_TIPO : null,
  ].filter(Boolean) as string[];

  const custoLaboratorioTecnico = calcularTotalLaboratorioCusto(itensLaboratorio);
  const totalLaboratorioPreco = calcularTotalLaboratorioPreco(itensLaboratorio); // referência
  const custoDiretoProjeto = calcularTotalProjetoCusto(itensProjeto);

  // Engine única autoritativa (Política A).
  const economia = calcularPropostaEconomica({
    custoLaboratorioTecnico,
    custoDiretoProjeto,
    parametros: parametrosDeRates(args.parametrosProjeto),
  });

  const totalFinal = economia.totalFinal;
  const subtotalTecnico = economia.subtotal;
  // Participação informativa do projeto no total (não é um segundo gross-up).
  const totalProjetoFinal =
    economia.valido && subtotalTecnico > 0
      ? roundMoney(totalFinal * (custoDiretoProjeto / subtotalTecnico))
      : 0;

  // Compat para a etapa de Parâmetros e para o snapshot (formato {key,...}).
  const parametrosProjeto = economia.parametros.map((p) => ({
    key: p.chave,
    label: p.label,
    nominalRate: p.percentual,
    amount: p.valorNominal,
  }));

  const origens: OrigemValorFinal[] = [
    {
      campo: "totalLaboratorioCusto",
      titulo: "Custo laboratório (técnico)",
      origem: "orcamento_itens.custo_unitario × orcamento_itens.n_amostras",
      regra: "Custo técnico laboratorial; base de cálculo da proposta (Política A).",
      valor: custoLaboratorioTecnico,
    },
    {
      campo: "totalLaboratorioPreco",
      titulo: "Preço laboratório (referência)",
      origem: "orcamento_itens.preco_unitario × orcamento_itens.n_amostras",
      regra: "Preço já formado preservado apenas como referência/snapshot; NÃO entra no fechamento da proposta nova.",
      valor: totalLaboratorioPreco,
    },
    {
      campo: "totalProjetoCusto",
      titulo: "Custo projeto (direto)",
      origem: "orcamento_projeto_custos e orcamento_projeto_analises (base de custo)",
      regra: "Custo direto do projeto; base de cálculo da proposta (Política A).",
      valor: custoDiretoProjeto,
    },
    {
      campo: "subtotalTecnico",
      titulo: "Subtotal técnico",
      origem: "custo laboratorial técnico + custo direto de projeto",
      regra: "Base única sobre a qual incide o gross-up dos parâmetros.",
      valor: subtotalTecnico,
    },
    {
      campo: "totalFinal",
      titulo: "Total final",
      origem: "engine-economica.calcularPropostaEconomica (Política A)",
      regra: economia.formula,
      valor: totalFinal,
    },
  ];

  return {
    pronto: pendencias.length === 0 && economia.valido,
    // `origens` fica no snapshot para auditoria; na tela use explicarOrigem().
    pendencias: economia.valido ? pendencias : [...pendencias, economia.alertas[0]],
    // Bases técnicas
    totalLaboratorioCusto: custoLaboratorioTecnico,
    totalLaboratorioPreco, // referência apenas
    totalProjetoCusto: custoDiretoProjeto,
    subtotalTecnico,
    // Resultado (Política A)
    somaPercentual: economia.somaPercentual,
    fatorGrossUp: economia.fatorGrossUp,
    totalParametros: economia.totalParametros,
    totalProjetoFinal, // participação informativa do projeto
    totalFinal,
    parametros: economia.parametros, // canônico
    parametrosProjeto, // compat (página/snapshot)
    alertas: economia.alertas,
    economia, // snapshot reproduzível da engine autoritativa
    markupProjeto: economia.somaPercentual, // compat de exibição (Σ parâmetros)
    origens,
  };
}

// Texto de tela para cada linha de `origens` (sem nomes de tabela nem jargão).
const EXPLICACAO_ORIGEM: Record<string, string> = {
  totalLaboratorioCusto: "Custo de cada análise × número de amostras.",
  totalLaboratorioPreco: "Preço de tabela das análises; só referência, não entra no total.",
  totalProjetoCusto: "Soma dos custos e das análises do projeto.",
  subtotalTecnico: "Custo do laboratório + custo do projeto.",
  totalFinal: "Subtotal técnico ÷ (1 − soma dos % dos parâmetros).",
};

export function explicarOrigem(origem: { campo?: string | null; regra?: string | null }) {
  return (origem.campo && EXPLICACAO_ORIGEM[origem.campo]) || origem.regra || "Valor registrado na emissão.";
}
