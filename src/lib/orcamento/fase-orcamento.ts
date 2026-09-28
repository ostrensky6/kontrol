/**
 * Fase de cada orçamento na lista (onda C): uma só por orçamento, para o funil
 * somar exatamente o que a tabela mostra. Antes o funil contava módulos e
 * versões, e não dava para filtrar a lista por ele.
 */
import type { OrcamentoFila } from "./orcamentos-listagem";

export type FaseOrcamento = "em_elaboracao" | "revisao" | "emitida" | "aprovada" | "recusada" | "cancelada";

/** `rotulo`: o grupo no funil; `item`: o selo de um orçamento na lista. */
export const FASES: { id: FaseOrcamento; rotulo: string; item: string }[] = [
  { id: "em_elaboracao", rotulo: "Em elaboração", item: "Em elaboração" },
  { id: "revisao", rotulo: "Em revisão", item: "Em revisão" },
  { id: "emitida", rotulo: "Emitidas", item: "Emitida" },
  { id: "aprovada", rotulo: "Aprovadas", item: "Aprovada" },
  { id: "recusada", rotulo: "Recusadas", item: "Recusada" },
  { id: "cancelada", rotulo: "Canceladas", item: "Cancelada" },
];

export type LinhaFase = Pick<OrcamentoFila, "origem" | "status" | "grupo" | "total" | "criadoEm">;

const VIVA = ["emitido", "enviado", "alterado_reenviado"];
const APROVADA = ["aprovado", "convertido_projeto"];
const RECUSADA = ["recusado", "rejeitado"];

export function faseDoOrcamento(statusDemanda: string | null | undefined, linhas: LinhaFase[]): FaseOrcamento {
  if (statusDemanda === "cancelada") return "cancelada";
  const versoes = linhas.filter((l) => l.origem === "final");
  if (versoes.some((l) => APROVADA.includes(l.status))) return "aprovada";
  if (versoes.some((l) => VIVA.includes(l.status))) return "emitida";
  if (versoes.some((l) => RECUSADA.includes(l.status)) || statusDemanda === "recusada") return "recusada";
  if (statusDemanda === "aprovada") return "aprovada";
  // vencida: foi emitida; precisa de nova versão, mas continua na fase de emitidas
  if (versoes.some((l) => l.status === "vencido")) return "emitida";
  const modulos = linhas.filter((l) => l.origem !== "final" && l.status !== "cancelado");
  if (modulos.some((l) => l.grupo === "revisao")) return "revisao";
  return "em_elaboracao";
}

export function resumirFases(fases: FaseOrcamento[]): Record<FaseOrcamento, number> {
  const resumo = Object.fromEntries(FASES.map((f) => [f.id, 0])) as Record<FaseOrcamento, number>;
  for (const fase of fases) resumo[fase] += 1;
  return resumo;
}

/**
 * Valor da lista: o da proposta mais recente que vale (aprovada ou viva);
 * sem ela, a soma dos módulos em andamento, marcada como estimativa.
 */
export function valorDoOrcamento(linhas: LinhaFase[]): { valor: number | null; origem: "proposta" | "estimativa" | null } {
  const valendo = linhas
    .filter((l) => l.origem === "final" && (APROVADA.includes(l.status) || VIVA.includes(l.status)))
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  if (valendo.length > 0) return { valor: Number(valendo[0].total ?? 0), origem: "proposta" };
  const modulos = linhas.filter((l) => l.origem !== "final" && l.status !== "cancelado");
  if (modulos.length === 0) return { valor: null, origem: null };
  return { valor: modulos.reduce((soma, l) => soma + Number(l.total ?? 0), 0), origem: "estimativa" };
}
