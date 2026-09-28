"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { roundMoney } from "@/lib/costing/pricing";
import { falha, mensagemDoBanco, sucesso, type EstadoAcao } from "@/lib/erros";
import { calcularPropostaEconomica, parametrosDeRates } from "@/lib/orcamento/engine-economica";
import { gravarPercentuaisDaDemanda, lerPercentuais } from "@/lib/orcamento/gravar-percentuais";
import { recusaSemPermissao } from "@/lib/orcamento/permissao-acao";
import type { Json } from "@/lib/supabase/database.types";
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

type SnapshotReemissao = {
  consolidado?: {
    economia?: { politica?: string; custoLaboratorioTecnico?: number; custoDiretoProjeto?: number };
    totalLaboratorioCusto?: number;
    totalProjetoCusto?: number;
    origens?: Array<{ campo?: string; valor?: number; regra?: string }>;
    [chave: string]: unknown;
  };
  textos_proposta?: unknown;
  orcamentos_analises?: Array<{ id?: number }>;
  orcamentos_projeto?: Array<{ id?: number }>;
  [chave: string]: unknown;
};

/**
 * "Alterar percentuais" de uma proposta emitida (28/09): o total muda, então
 * nasce a versão seguinte (mesma RPC da emissão, que substitui a atual e
 * encerra o link dela). Custos congelados da versão atual + percentuais novos.
 */
export async function reemitirComPercentuais(formData: FormData) {
  const id = Number(formData.get("versao_id"));
  if (!Number.isInteger(id) || id <= 0) return;
  const voltarComErro = (mensagem: string): never =>
    redirect(`/orcamento/final/${id}?sub=operacionais&erro=${encodeURIComponent(mensagem)}`);

  const recusa = (await recusaSemPermissao("emitir_final")) ?? (await recusaSemPermissao("editar_parametros"));
  if (recusa) voltarComErro(recusa.message ?? "Sem permissão para alterar os percentuais.");
  const operacaoId = String(formData.get("operacao_id") ?? "").trim();
  if (!z.string().uuid().safeParse(operacaoId).success) {
    voltarComErro("Identidade da operação inválida. Recarregue a página e tente de novo.");
  }
  const percentuais = lerPercentuais(formData);
  if (!percentuais) return voltarComErro("Use percentuais positivos com soma menor que 100%.");

  const supabase = await createClient();
  const { data: versao } = await supabase.from("orcamento_final_versoes").select("*").eq("id", id).single();
  if (!versao) return voltarComErro("Proposta não encontrada.");
  if (["aprovado", "convertido_projeto"].includes(versao.status)) {
    voltarComErro("Proposta aprovada: os percentuais não podem mais mudar. Cancele a aprovação antes.");
  }
  const snapshot = (versao.snapshot ?? {}) as SnapshotReemissao;
  const consolidado = snapshot.consolidado ?? {};
  if (consolidado.economia?.politica !== "A_GROSS_UP_TOTAL") {
    voltarComErro("Versão emitida com a regra econômica anterior: altere os percentuais na elaboração e emita de novo.");
  }

  const custoLab = Number(consolidado.economia?.custoLaboratorioTecnico ?? consolidado.totalLaboratorioCusto ?? 0);
  const custoProj = Number(consolidado.economia?.custoDiretoProjeto ?? consolidado.totalProjetoCusto ?? 0);
  const economia = calcularPropostaEconomica({
    custoLaboratorioTecnico: custoLab,
    custoDiretoProjeto: custoProj,
    parametros: parametrosDeRates(percentuais),
  });
  if (!economia.valido) voltarComErro(economia.alertas[0] ?? "Percentuais inválidos.");

  const totalProjetoFinal = economia.subtotal > 0 ? roundMoney(economia.totalFinal * (custoProj / economia.subtotal)) : 0;
  const novoConsolidado = {
    ...consolidado,
    economia,
    subtotalTecnico: economia.subtotal,
    somaPercentual: economia.somaPercentual,
    fatorGrossUp: economia.fatorGrossUp,
    totalParametros: economia.totalParametros,
    totalProjetoFinal,
    totalFinal: economia.totalFinal,
    parametros: economia.parametros,
    parametrosProjeto: economia.parametros.map((p) => ({ key: p.chave, label: p.label, nominalRate: p.percentual, amount: p.valorNominal })),
    markupProjeto: economia.somaPercentual,
    origens: (consolidado.origens ?? []).map((o) =>
      o.campo === "totalFinal" ? { ...o, valor: economia.totalFinal, regra: economia.formula } : o,
    ),
  };
  const novoSnapshot = {
    ...snapshot,
    consolidado: novoConsolidado,
    // textos editados na versão atual seguem para a nova
    textos_proposta: versao.textos_proposta ?? snapshot.textos_proposta ?? null,
    origem_versao: { versao_id: versao.id, numero: versao.numero, motivo: "percentuais alterados" },
  } as Json;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id || !user.email) return voltarComErro("Sua sessão expirou. Entre de novo.");

  const { data, error } = await supabase.rpc("emitir_orcamento_final_transacional", {
    p_demanda_id: versao.demanda_id,
    p_validade_dias: Number(versao.validade_dias ?? 30) || 30,
    p_total_laboratorio_custo: custoLab,
    p_total_laboratorio_preco: Number(versao.total_laboratorio_preco ?? 0),
    p_total_projeto_custo: custoProj,
    p_total_projeto_final: totalProjetoFinal,
    p_total_final: economia.totalFinal,
    p_snapshot: novoSnapshot,
    p_parametros: {
      orcamento_laboratorial_id: snapshot.orcamentos_analises?.at(-1)?.id ?? null,
      orcamento_projeto_id: snapshot.orcamentos_projeto?.at(-1)?.id ?? null,
      metodo_calculo: "GROSS_UP",
      laboratorio_modo: "CUSTO_TECNICO",
      subtotal_laboratorio: custoLab,
      subtotal_projeto: custoProj,
      subtotal_custos: economia.subtotal,
      total_parametros: economia.totalParametros,
      total_final: economia.totalFinal,
      parametros_snapshot: economia.parametros,
      formula_snapshot: {
        politica: economia.politica,
        formula: economia.formula,
        somaPercentual: economia.somaPercentual,
        fatorGrossUp: economia.fatorGrossUp,
        origens: novoConsolidado.origens,
      },
      alertas_snapshot: economia.alertas,
    } as Json,
    p_criado_por: user.id,
    p_usuario_email: user.email,
    p_operacao_id: operacaoId,
  });
  if (error) return voltarComErro(mensagemDoBanco(error));
  const nova = data as { id?: number } | null;
  if (!nova?.id) return voltarComErro("A nova versão não foi confirmada. Confira o histórico antes de tentar de novo.");

  // A elaboração passa a mostrar os mesmos percentuais da versão nova.
  const erroElaboracao = await gravarPercentuaisDaDemanda(supabase, versao.demanda_id, percentuais);
  revalidatePath(historicoPath);
  revalidatePath("/orcamento");
  revalidatePath(`/orcamento/demandas/${versao.demanda_id}`);
  const aviso = erroElaboracao
    ? `?erro=${encodeURIComponent(`Versão nova criada, mas os percentuais da elaboração não foram atualizados: ${erroElaboracao}`)}`
    : "";
  redirect(`/orcamento/final/${nova.id}${aviso}`);
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
