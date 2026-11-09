/**
 * Ciclo de pagamento do dia 10 (0172, decisão D1 de 09/11/2026). O banco grava
 * o ciclo no pedido (kontrol_private.ciclo_para); estas funções repetem a
 * mesma regra só para explicar na tela antes da aprovação.
 *
 * - prazo: dia 10 do mês; sábado e domingo passam para a segunda;
 * - aprovação de coordenação até o prazo: ciclo do mês; depois, o seguinte;
 * - urgência (alta ou crítica) fura o ciclo, com justificativa obrigatória;
 * - horário de Brasília; feriados não entram na conta.
 */

export const URGENCIAS_QUE_FURAM_O_CICLO = ["alta", "critica"];
export const JUSTIFICATIVA_URGENCIA_MINIMA = 15;

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DIAS = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

export function ehUrgente(urgencia: string | null | undefined): boolean {
  return URGENCIAS_QUE_FURAM_O_CICLO.includes(String(urgencia ?? ""));
}

/** Data (aaaa-mm-dd) em Brasília para um instante. */
export function dataEmBrasilia(momento: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(momento);
}

function partes(data: string) {
  const [ano, mes, dia] = data.slice(0, 10).split("-").map(Number);
  return { ano, mes, dia };
}

function iso(ano: number, mes: number, dia: number) {
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Prazo do ciclo do mês da data (aaaa-mm-dd). */
export function prazoDoCiclo(ciclo: string): string {
  const { ano, mes } = partes(ciclo);
  const diaSemana = new Date(Date.UTC(ano, mes - 1, 10)).getUTCDay();
  const dia = 10 + (diaSemana === 6 ? 2 : diaSemana === 0 ? 1 : 0);
  return iso(ano, mes, dia);
}

/** Ciclo (primeiro dia do mês) de um pedido aprovado na data indicada (aaaa-mm-dd, Brasília). */
export function cicloPara(dataAprovacao: string, urgente: boolean): string {
  const { ano, mes } = partes(dataAprovacao);
  const doMes = iso(ano, mes, 1);
  if (urgente || dataAprovacao.slice(0, 10) <= prazoDoCiclo(doMes)) return doMes;
  return mes === 12 ? iso(ano + 1, 1, 1) : iso(ano, mes + 1, 1);
}

export function rotuloCiclo(ciclo: string | null | undefined): string | null {
  if (!ciclo) return null;
  const { ano, mes } = partes(ciclo);
  if (!ano || !mes) return null;
  return `${MESES[mes - 1]}/${ano}`;
}

export function rotuloPrazo(prazo: string): string {
  const { ano, mes, dia } = partes(prazo);
  const diaSemana = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
  return `${DIAS[diaSemana]} ${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`;
}

/** Texto para quem pede: em que ciclo o pedido entra se for aprovado hoje. */
export function explicarCicloHoje(hoje: string, urgente: boolean): string {
  const ciclo = cicloPara(hoje, urgente);
  if (urgente) {
    return `Urgente: fura o ciclo do dia 10 e entra no ciclo de ${rotuloCiclo(ciclo)}, com justificativa obrigatória.`;
  }
  const { ano, mes } = partes(hoje);
  const prazo = prazoDoCiclo(iso(ano, mes, 1));
  if (ciclo.slice(0, 7) === hoje.slice(0, 7)) {
    return `Aprovado pela coordenação até ${rotuloPrazo(prazo)}, entra no ciclo de pagamento de ${rotuloCiclo(ciclo)}. Depois disso, passa ao ciclo seguinte.`;
  }
  return `O prazo de ${rotuloCiclo(iso(ano, mes, 1))} (${rotuloPrazo(prazo)}) já passou: o pedido entra no ciclo de ${rotuloCiclo(ciclo)}, salvo urgência justificada.`;
}

/** O que falta na urgência; null quando não é urgente ou está justificada. */
export function faltaJustificativaUrgencia(urgencia: string | null | undefined, justificativa: string | null | undefined): string | null {
  if (!ehUrgente(urgencia)) return null;
  if (String(justificativa ?? "").trim().length >= JUSTIFICATIVA_URGENCIA_MINIMA) return null;
  return "Pedido urgente fura o ciclo do dia 10 e precisa de justificativa: escreva por que não pode esperar o próximo ciclo.";
}
