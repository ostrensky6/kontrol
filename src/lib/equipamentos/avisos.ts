/** Avisos de manutenção e calibração (0158): tipos, rótulos e leitura da view. */

export const TIPOS_MANUTENCAO = ["calibracao", "preventiva", "verificacao", "qualificacao", "limpeza_tecnica", "corretiva"] as const;
export type TipoManutencao = (typeof TIPOS_MANUTENCAO)[number];

export const ROTULO_TIPO: Record<TipoManutencao, string> = {
  calibracao: "Calibração",
  preventiva: "Manutenção preventiva",
  verificacao: "Verificação",
  qualificacao: "Qualificação",
  limpeza_tecnica: "Limpeza técnica",
  corretiva: "Manutenção corretiva",
};

export const DECISOES_AVISO = ["agendar", "em_andamento", "fora_de_uso", "dispensado", "outro"] as const;
export type DecisaoAviso = (typeof DECISOES_AVISO)[number];

export const ROTULO_DECISAO: Record<DecisaoAviso, string> = {
  agendar: "Vamos agendar",
  em_andamento: "Já está em andamento",
  fora_de_uso: "Equipamento fora de uso",
  dispensado: "Não é necessário agora",
  outro: "Outro",
};

export type SituacaoAviso = "vencido" | "proximo" | "sem_registro";

export type AvisoEquipamento = {
  equipamento_unidade_id: number;
  tipo: TipoManutencao;
  obrigatorio: boolean;
  periodicidade_dias: number;
  antecedencia_dias: number;
  ultima_conclusao: string | null;
  vencimento: string | null;
  situacao: SituacaoAviso;
  dias_para_vencer: number | null;
  agendada_para: string | null;
  encaminhamento_decisao: DecisaoAviso | null;
  encaminhamento_observacao: string | null;
  encaminhado_em: string | null;
  encaminhado: boolean;
};

export function rotuloTipo(tipo: string) {
  return ROTULO_TIPO[tipo as TipoManutencao] ?? tipo.replaceAll("_", " ");
}

/** Texto curto do prazo, sem jargão. */
export function textoPrazo(a: Pick<AvisoEquipamento, "situacao" | "dias_para_vencer">) {
  if (a.situacao === "sem_registro") return "Nenhuma realizada registrada";
  const d = a.dias_para_vencer ?? 0;
  if (d < 0) return `Venceu há ${-d} ${-d === 1 ? "dia" : "dias"}`;
  if (d === 0) return "Vence hoje";
  return `Vence em ${d} ${d === 1 ? "dia" : "dias"}`;
}

/** Vencidos primeiro, depois sem registro, depois os mais próximos. */
export function ordenarAvisos<T extends Pick<AvisoEquipamento, "situacao" | "dias_para_vencer">>(avisos: T[]): T[] {
  const peso = { vencido: 0, sem_registro: 1, proximo: 2 } as const;
  return [...avisos].sort((a, b) =>
    peso[a.situacao] - peso[b.situacao] || (a.dias_para_vencer ?? 0) - (b.dias_para_vencer ?? 0));
}
