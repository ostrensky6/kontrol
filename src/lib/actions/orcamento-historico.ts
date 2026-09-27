"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { falha, mensagemDoBanco, sucesso, type EstadoAcao } from "@/lib/erros";
import { recusaSemPermissao } from "@/lib/orcamento/permissao-acao";
import { createClient } from "@/lib/supabase/server";

const historicoPath = "/orcamento/historico";
const STATUS_CLASSIFICACAO = new Set(["enviado", "alterado_reenviado", "aprovado", "recusado"]);

/**
 * Marca como vencidas as versões fora da validade (emitidas, enviadas ou
 * reenviadas). O job diário do banco (0126) faz o mesmo; aqui é só para a
 * lista já abrir em dia. Não exige permissão: a RPC só aplica a validade.
 */
export async function atualizarOrcamentosFinaisVencidos(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vencer_orcamentos_finais");
  if (error) return 0;
  return Number(data ?? 0);
}

function revalidarProposta(id: number) {
  revalidatePath(`/orcamento/final/${id}`);
  revalidatePath(historicoPath);
  revalidatePath("/orcamento/fundos");
  revalidatePath("/orcamento");
  revalidatePath("/planejamento");
}

export async function cancelarVersaoFinal(_estado: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  const id = Number(formData.get("versao_id"));
  if (!Number.isInteger(id) || id <= 0) return falha("Proposta não identificada.");
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (motivo.length < 3) return falha("Informe o motivo do cancelamento.");
  const recusa = await recusaSemPermissao("cancelar_documento");
  if (recusa) return recusa;

  const supabase = await createClient();
  const { error } = await supabase.rpc("transicionar_orcamento_final", {
    p_versao_id: id,
    p_status_destino: "cancelado",
    p_motivo: motivo,
  });
  if (error) return falha(mensagemDoBanco(error));
  revalidarProposta(id);
  return sucesso("Proposta cancelada.");
}

export async function classificarVersaoFinal(_estado: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  const id = Number(formData.get("versao_id"));
  const status = String(formData.get("status") ?? "").trim();
  if (!Number.isInteger(id) || id <= 0 || !STATUS_CLASSIFICACAO.has(status)) {
    return falha("Escolha uma situação válida para a proposta.");
  }

  const motivo = String(formData.get("motivo") ?? "").trim() || null;
  const recusa = await recusaSemPermissao("classificar_final");
  if (recusa) return recusa;
  const supabase = await createClient();
  const { error } = await supabase.rpc("transicionar_orcamento_final", {
    p_versao_id: id,
    p_status_destino: status,
    p_motivo: motivo,
  });
  if (error) return falha(mensagemDoBanco(error));
  revalidarProposta(id);
  return sucesso(status === "aprovado" ? "Proposta aprovada. O planejamento foi criado em rascunho." : "Situação registrada.");
}

/** Mantida com `(formData)`: o formulário de duplicação é idempotente pelo operacao_id do render. */
export async function duplicarVersaoFinal(formData: FormData) {
  const id = Number(formData.get("versao_id"));
  if (!id) return;
  const voltarComErro = (mensagem: string): never =>
    redirect(`/orcamento/final/${id}?erro=${encodeURIComponent(mensagem)}`);

  const recusa = await recusaSemPermissao("duplicar_final");
  if (recusa) voltarComErro(recusa.message ?? "Sem permissão para duplicar.");
  const operacaoId = String(formData.get("operacao_id") ?? "").trim();
  if (!z.string().uuid().safeParse(operacaoId).success) {
    voltarComErro("Identidade da operação de duplicação inválida. Recarregue a página e tente de novo.");
  }
  const validadeDias = Number(formData.get("validade_dias")) || 30;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duplicar_orcamento_final_transacional", {
    p_versao_id: id,
    p_validade_dias: validadeDias,
    p_operacao_id: operacaoId,
  });
  if (error) voltarComErro(mensagemDoBanco(error));
  const nova = data as { id?: number } | null;
  if (!nova?.id) {
    return voltarComErro("A duplicação não devolveu a nova versão. Confira o histórico antes de tentar de novo.");
  }

  revalidatePath(historicoPath);
  revalidatePath("/orcamento");
  redirect(`/orcamento/final/${nova.id}`);
}

/** ORC2-7: gera o planejamento de uma proposta aprovada que está sem plano ativo. */
export async function gerarPlanejamentoDaProposta(_estado: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  const id = Number(formData.get("versao_id"));
  if (!Number.isInteger(id) || id <= 0) return falha("Proposta não identificada.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gerar_planejamento_da_proposta", { p_versao_id: id });
  if (error) return falha(mensagemDoBanco(error));
  const resultado = (data ?? {}) as { plano_id?: number | null; motivo?: string };
  if (resultado.motivo === "sem_analises") {
    return falha("Esta proposta não tem análises laboratoriais: não há planejamento a gerar.");
  }
  revalidarProposta(id);
  if (resultado.plano_id) redirect(`/planejamento/${resultado.plano_id}`);
  return sucesso("Planejamento gerado.");
}
