import type { Pendencia } from "@/components/dashboard/aguardando";

/** Um aviso não lido, como o sino mostra. */
export type AvisoDoSino = { id: number; titulo: string; corpo: string | null; href: string | null; criadoEm: string };

/** O que o sino mostra em todas as telas: Aguardando você e os avisos não lidos. */
export type AvisosDoSino = {
  pendencias: Pendencia[];
  avisos: AvisoDoSino[];
  /** avisos não lidos, até o teto de leitura */
  naoLidos: number;
};

export const AVISOS_VAZIOS: AvisosDoSino = { pendencias: [], avisos: [], naoLidos: 0 };
