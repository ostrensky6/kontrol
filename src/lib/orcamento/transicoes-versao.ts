// Matriz de transições da versão final da proposta. Espelha
// public.transicionar_orcamento_final (0101/0126): a tela só oferece o que o
// banco aceita, e o banco continua sendo a regra.

export const STATUS_VIVOS = ["emitido", "enviado", "alterado_reenviado"] as const;
export const STATUS_APROVADOS = ["aprovado", "convertido_projeto"] as const;

const TRANSICOES: Record<string, readonly string[]> = {
  emitido: ["enviado", "alterado_reenviado", "aprovado", "recusado", "rejeitado", "cancelado", "vencido"],
  enviado: ["alterado_reenviado", "aprovado", "recusado", "rejeitado", "cancelado", "vencido"],
  alterado_reenviado: ["alterado_reenviado", "aprovado", "recusado", "rejeitado", "cancelado", "vencido"],
  recusado: ["alterado_reenviado", "cancelado"],
  rejeitado: ["alterado_reenviado", "cancelado"],
  aprovado: ["convertido_projeto", "cancelado"],
};

/** Classificações comerciais que a equipe registra à mão (sem cancelar nem vencer). */
const CLASSIFICACOES = ["enviado", "alterado_reenviado", "aprovado", "recusado"] as const;
export type ClassificacaoVersao = (typeof CLASSIFICACOES)[number];

export const ROTULO_CLASSIFICACAO: Record<ClassificacaoVersao, string> = {
  enviado: "Enviada ao cliente",
  alterado_reenviado: "Alterada e reenviada",
  aprovado: "Aprovada",
  recusado: "Recusada",
};

export function podeTransicionarVersao(origem: string, destino: string): boolean {
  if (origem === destino) return false;
  return (TRANSICOES[origem] ?? []).includes(destino);
}

export function estaVencida(validoAte: string | null | undefined, hoje: string): boolean {
  return Boolean(validoAte) && String(validoAte).slice(0, 10) < hoje;
}

/**
 * Classificações oferecidas para uma versão. Vencida não pode ser aprovada, e
 * com outra versão aprovada da mesma proposta nenhuma versão é aprovada nem
 * reenviada (uma versão viva por proposta).
 */
export function classificacoesPermitidas(versao: {
  status: string;
  valido_ate?: string | null;
  hoje: string;
  outraAprovada?: boolean;
}): ClassificacaoVersao[] {
  return CLASSIFICACOES.filter((destino) => {
    if (!podeTransicionarVersao(versao.status, destino)) return false;
    if (destino === "aprovado" && estaVencida(versao.valido_ate, versao.hoje)) return false;
    if (versao.outraAprovada && (destino === "aprovado" || destino === "alterado_reenviado")) return false;
    return true;
  });
}
