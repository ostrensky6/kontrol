// Valor de cada módulo (laboratório, projeto) nas listas e painéis.
//
// Mesma regra da emissão (Política A, DEC-ORC-001): base de custo técnico e
// um só gross-up com as taxas da proposta. As taxas seguem a mesma ordem da
// emissão: projeto mais recente da proposta → percentuais gravados na
// proposta → padrões de Parâmetros de custeio.
import {
  calcularOrcamentoProjeto,
  itensProjetoNaBaseDeCusto,
} from "@/lib/project-budget/orcamento-projeto";
import { calcularPropostaEconomica, parametrosDeRates, type RatesProposta } from "./engine-economica";
import type { ItemLaboratorioFinal } from "./orcamento-final";
import { totalLaboratorioCusto } from "./bases-custo";
import { padroesDeParametrosGlobais, resolverParametrosProposta } from "./parametros-proposta";

type Percentual = number | string | null | undefined;

export type ProjetoComTaxas = {
  id: number;
  demanda_id?: number | null;
  status?: string | null;
  impostos_legacy?: Percentual;
  impostos?: Percentual;
  incubacao?: Percentual;
  reserva?: Percentual;
  investimentos?: Percentual;
  lucro?: Percentual;
  margem_lucro?: Percentual;
};

export type PropostaComTaxas = {
  id: number;
  param_impostos?: Percentual;
  param_incubacao?: Percentual;
  param_reserva?: Percentual;
  param_investimentos?: Percentual;
  param_lucro?: Percentual;
};

/** Devolve as taxas de cada proposta pela mesma regra da emissão. */
export function criarResolvedorDeTaxas(args: {
  projetos: ProjetoComTaxas[] | null | undefined;
  demandas: PropostaComTaxas[] | null | undefined;
  parametrosGlobais: { chave: string; valor: number | string | null }[] | null | undefined;
}) {
  const padroes = padroesDeParametrosGlobais(args.parametrosGlobais);
  const projetoReferencia = new Map<number, ProjetoComTaxas>();
  for (const projeto of args.projetos ?? []) {
    // ORC-8: como na emissão, projeto cancelado não fornece as taxas da proposta.
    if (projeto.demanda_id == null || projeto.status === "cancelado") continue;
    const atual = projetoReferencia.get(projeto.demanda_id);
    if (!atual || projeto.id > atual.id) projetoReferencia.set(projeto.demanda_id, projeto);
  }
  const propostas = new Map((args.demandas ?? []).map((demanda) => [demanda.id, demanda]));

  return (demandaId: number | null | undefined, projetoProprio?: ProjetoComTaxas | null): RatesProposta => {
    const projeto = demandaId != null ? projetoReferencia.get(demandaId) ?? null : projetoProprio ?? null;
    const proposta = demandaId != null ? propostas.get(demandaId) ?? null : null;
    return resolverParametrosProposta({ projeto, proposta, padroes }).rates;
  };
}

/** Parte do laboratório no total da proposta: custo técnico com o gross-up único. */
export function valorLaboratorioNaProposta(itens: ItemLaboratorioFinal[], rates: RatesProposta) {
  return calcularPropostaEconomica({
    custoLaboratorioTecnico: totalLaboratorioCusto(itens),
    custoDiretoProjeto: 0,
    parametros: parametrosDeRates(rates),
  }).totalFinal;
}

/** Parte do projeto no total da proposta: custo direto com o gross-up único. */
export function valorProjetoNaProposta(
  modulo: Parameters<typeof itensProjetoNaBaseDeCusto>[0],
  rates: RatesProposta,
) {
  return calcularOrcamentoProjeto(itensProjetoNaBaseDeCusto(modulo), rates).grossTotal;
}
