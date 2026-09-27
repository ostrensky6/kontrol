import "server-only";

import { falha, type EstadoAcao } from "@/lib/erros";
import { exigirPapelOrcamento, type AcaoOrcamento } from "@/lib/orcamento/governanca";

/**
 * Versão "com retorno" de exigirPapelOrcamento para actions de formulário:
 * sem permissão, devolve a mensagem em vez de lançar (que viraria a tela de
 * erro genérica em produção).
 */
export async function recusaSemPermissao(acao: AcaoOrcamento): Promise<EstadoAcao | null> {
  try {
    await exigirPapelOrcamento(acao);
    return null;
  } catch (erro) {
    return falha(erro instanceof Error && erro.message ? erro.message : "Seu perfil não tem permissão para esta ação.");
  }
}
