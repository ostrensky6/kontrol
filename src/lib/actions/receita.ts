"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { semLinhasAfetadas } from "@/lib/supabase/escrita";

// ---- helpers ---------------------------------------------------------
const txt = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v || null;
};
const txtReq = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const numOrNull = (fd: FormData, k: string) => {
  const v = fd.get(k);
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
const MATERIAL_SEM_INSUMO_MSG =
  "Material com consumo informado precisa estar vinculado a um insumo de estoque.";

function revalidarReceita(codigo: string) {
  revalidatePath(`/analises/${codigo}`);
  revalidatePath("/analises");
  revalidatePath("/custeio");
  revalidatePath("/insumos");
}

function validarVinculoMaterial(quantidade_por_amostra: number | null, insumo_id: number | null) {
  if (Number(quantidade_por_amostra ?? 0) > 0 && !insumo_id) {
    throw new Error(MATERIAL_SEM_INSUMO_MSG);
  }
}

const SEM_PERMISSAO_ANALISES =
  "Nada foi alterado: seu perfil não tem permissão para editar análises. Peça a permissão “Editar análises” à coordenação.";

/**
 * O RLS recusa update/delete sem erro, afetando zero linhas; sem esta
 * conferência a tela diria "salvo" sem ter salvo nada.
 */
function garantirEscrita(
  resultado: { data: unknown[] | null; error: { message: string } | null },
) {
  if (resultado.error) throw new Error(resultado.error.message);
  if (!resultado.data || resultado.data.length === 0) throw new Error(SEM_PERMISSAO_ANALISES);
}

export type AnaliseFormState = {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
  codigo?: string;
};

const CODIGO_ANALISE = /^[A-Za-z0-9_.-]{2,60}$/;

function mensagemRpcAnalise(message: string) {
  if (/duplicar_analise|excluir_analise_sem_historico/.test(message) && /function|schema cache/i.test(message)) {
    return "Função ainda não disponível no banco (migration 0114 pendente).";
  }
  return message;
}

/** Nova análise: em branco ou copiando etapas, materiais e equipamentos de outra. */
export async function criarAnaliseAcao(
  _prev: AnaliseFormState,
  formData: FormData,
): Promise<AnaliseFormState> {
  const codigo = txtReq(formData, "codigo");
  const nome = txt(formData, "nome");
  const descricao = txt(formData, "descricao");
  const origem = txt(formData, "origem");
  if (!CODIGO_ANALISE.test(codigo)) {
    return {
      ok: false,
      message: "Verifique os campos.",
      errors: { codigo: "Use de 2 a 60 letras, números, _ . ou -, sem espaços." },
    };
  }

  const supabase = await createClient();
  if (origem) {
    const { error } = await supabase.rpc("duplicar_analise" as never, {
      p_origem: origem,
      p_novo: codigo,
      p_nome: nome,
    } as never);
    if (error) return { ok: false, message: mensagemRpcAnalise(error.message) };
    if (descricao) {
      const { data: descrita, error: descricaoError } = await supabase
        .from("analises")
        .update({ descricao })
        .eq("codigo", codigo)
        .select("codigo");
      if (descricaoError || semLinhasAfetadas(descrita)) {
        // a análise já foi criada pela cópia: diz o que ficou faltando em vez de "tudo certo"
        revalidatePath("/analises");
        return { ok: true, message: "Análise criada, mas a descrição não foi gravada. Abra a análise e preencha a descrição.", codigo };
      }
    }
  } else {
    const { error } = await supabase.from("analises").insert({ codigo, nome, descricao, ativo: true });
    if (error) {
      return {
        ok: false,
        message:
          error.code === "23505"
            ? `Já existe uma análise com o código ${codigo}.`
            : error.code === "42501" || /row-level security/i.test(error.message)
              ? SEM_PERMISSAO_ANALISES
              : error.message,
      };
    }
  }

  revalidatePath("/analises");
  return { ok: true, message: "Análise criada.", codigo };
}

/** Exclui somente análise sem histórico; com histórico, orienta a inativar. */
export async function excluirAnaliseAcao(
  _prev: AnaliseFormState,
  formData: FormData,
): Promise<AnaliseFormState> {
  const codigo = txtReq(formData, "codigo");
  if (!codigo) return { ok: false, message: "Análise inválida." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("excluir_analise_sem_historico" as never, {
    p_codigo: codigo,
  } as never);
  if (error) return { ok: false, message: mensagemRpcAnalise(error.message) };
  revalidatePath("/analises");
  revalidatePath("/custeio");
  return { ok: true, message: "Análise excluída.", codigo };
}

/** Ativa/inativa e coloca/retira da oferta comercial. */
export async function definirSituacaoAnalise(
  _prev: AnaliseFormState,
  formData: FormData,
): Promise<AnaliseFormState> {
  const codigo = txtReq(formData, "codigo");
  const campo = txtReq(formData, "campo");
  const valor = formData.get("valor") === "true";
  if (!codigo || (campo !== "ativo" && campo !== "ofertavel")) {
    return { ok: false, message: "Operação inválida." };
  }
  const supabase = await createClient();
  const alteracao =
    campo === "ativo"
      ? valor
        ? { ativo: true }
        : { ativo: false, ofertavel: false }
      : { ofertavel: valor, ...(valor ? { ativo: true } : {}) };
  const { data, error } = await supabase
    .from("analises")
    .update(alteracao)
    .eq("codigo", codigo)
    .select("codigo");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: SEM_PERMISSAO_ANALISES };
  revalidarReceita(codigo);
  return { ok: true, message: "Situação atualizada.", codigo };
}

/** Atualiza só os campos do catálogo simplificado (módulo Análises): nome simplificado, descrição e status. Não toca em `nome` nem `ativo`. */
export async function atualizarCatalogoAnalise(formData: FormData) {
  const codigo = txtReq(formData, "codigo");
  if (!codigo) return;
  const supabase = await createClient();
  garantirEscrita(
    await supabase
      .from("analises")
      .update({
        nome_simplificado: txt(formData, "nome_simplificado"),
        descricao: txt(formData, "descricao"),
        status: txt(formData, "status"),
      })
      .eq("codigo", codigo)
      .select("codigo"),
  );
  revalidatePath("/analises");
  revalidatePath(`/analises/${codigo}`);
}

export async function inativarAnalise(formData: FormData) {
  const codigo = txtReq(formData, "codigo");
  if (!codigo) return;
  const supabase = await createClient();
  garantirEscrita(
    await supabase
      .from("analises")
      .update({ ativo: false, ofertavel: false })
      .eq("codigo", codigo)
      .select("codigo"),
  );
  revalidarReceita(codigo);
}

// =====================================================================
// Etapas
// =====================================================================

export async function adicionarEtapa(formData: FormData) {
  const codigo = txtReq(formData, "codigo_analise");
  const supabase = await createClient();
  const { error } = await supabase.from("etapas").insert({
    codigo_analise: codigo,
    nome_etapa: txtReq(formData, "nome_etapa") || "Etapa",
    nome_atividade: txtReq(formData, "nome_atividade") || "Atividade",
    execucoes_por_dia: numOrNull(formData, "execucoes_por_dia"),
    amostras_por_execucao: numOrNull(formData, "amostras_por_execucao"),
    tempo_maquina_h: numOrNull(formData, "tempo_maquina_h"),
    tempo_bancada_h: numOrNull(formData, "tempo_bancada_h"),
    tipo_limitacao: txt(formData, "tipo_limitacao"),
    ordem: numOrNull(formData, "ordem"),
    dia_fim_max: numOrNull(formData, "dia_fim_max"),
    atividade_opcional: bool(formData, "atividade_opcional"),
  });
  if (error) throw new Error(error.message);
  revalidarReceita(codigo);
}

export async function atualizarEtapa(formData: FormData) {
  const codigo = txtReq(formData, "codigo_analise");
  const id = Number(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  garantirEscrita(
    await supabase
    .from("etapas")
    .update({
      nome_etapa: txtReq(formData, "nome_etapa") || "Etapa",
      nome_atividade: txtReq(formData, "nome_atividade") || "Atividade",
      execucoes_por_dia: numOrNull(formData, "execucoes_por_dia"),
      amostras_por_execucao: numOrNull(formData, "amostras_por_execucao"),
      tempo_maquina_h: numOrNull(formData, "tempo_maquina_h"),
      tempo_bancada_h: numOrNull(formData, "tempo_bancada_h"),
      tipo_limitacao: txt(formData, "tipo_limitacao"),
      atividade_opcional: bool(formData, "atividade_opcional"),
    })
    .eq("id", id)
    .select("id"),
  );
  revalidarReceita(codigo);
}

export async function removerEtapa(formData: FormData) {
  const codigo = txtReq(formData, "codigo_analise");
  const id = Number(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  garantirEscrita(await supabase.from("etapas").delete().eq("id", id).select("id"));
  revalidarReceita(codigo);
}

// =====================================================================
// Equipamentos (alocação)
// =====================================================================

export async function adicionarEquipamento(formData: FormData) {
  const codigo = txtReq(formData, "codigo_analise");
  const equipamento_id = Number(formData.get("equipamento_id"));
  if (!equipamento_id) throw new Error("Selecione um equipamento.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("equipamento_analise")
    .upsert(
      {
        codigo_analise: codigo,
        equipamento_id,
        peso_alocacao: numOrNull(formData, "peso_alocacao") ?? 1,
      },
      { onConflict: "equipamento_id,codigo_analise" },
    );
  if (error) throw new Error(error.message);
  revalidarReceita(codigo);
}

export async function atualizarEquipamentoAnalise(formData: FormData) {
  const codigo = txtReq(formData, "codigo_analise");
  const id = Number(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  garantirEscrita(
    await supabase
    .from("equipamento_analise")
    .update({ peso_alocacao: numOrNull(formData, "peso_alocacao") ?? 0 })
    .eq("id", id)
    .select("id"),
  );
  revalidarReceita(codigo);
}

export async function removerEquipamento(formData: FormData) {
  const codigo = txtReq(formData, "codigo_analise");
  const id = Number(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  garantirEscrita(await supabase.from("equipamento_analise").delete().eq("id", id).select("id"));
  revalidarReceita(codigo);
}

// =====================================================================
// Materiais (insumo_analise)
// =====================================================================

export async function adicionarMaterial(formData: FormData) {
  const codigo = txtReq(formData, "codigo_analise");
  const insumo_id = numOrNull(formData, "insumo_id");
  const quantidade_por_amostra = numOrNull(formData, "quantidade_por_amostra");
  validarVinculoMaterial(quantidade_por_amostra, insumo_id);
  const grupo_escolha = txt(formData, "grupo_escolha");
  const supabase = await createClient();
  const { error } = await supabase.from("insumo_analise").insert({
    codigo_analise: codigo,
    nome_etapa: txtReq(formData, "nome_etapa") || "—",
    nome_atividade: txtReq(formData, "nome_atividade") || "—",
    especificacao_insumo: txt(formData, "especificacao_insumo"),
    insumo_id,
    quantidade_por_amostra,
    unidade: txt(formData, "unidade"),
    modo_cobranca: txt(formData, "modo_cobranca"),
    grupo_escolha,
    preferencial: Boolean(grupo_escolha) && bool(formData, "preferencial"),
  });
  if (error) throw new Error(error.message);
  revalidarReceita(codigo);
}

export async function atualizarMaterial(formData: FormData) {
  const codigo = txtReq(formData, "codigo_analise");
  const id = Number(formData.get("id"));
  if (!id) return;
  const insumo_id = numOrNull(formData, "insumo_id");
  const quantidade_por_amostra = numOrNull(formData, "quantidade_por_amostra");
  validarVinculoMaterial(quantidade_por_amostra, insumo_id);
  const grupo_escolha = txt(formData, "grupo_escolha");
  const supabase = await createClient();
  garantirEscrita(
    await supabase
    .from("insumo_analise")
    .update({
      especificacao_insumo: txt(formData, "especificacao_insumo"),
      insumo_id,
      quantidade_por_amostra,
      unidade: txt(formData, "unidade"),
      modo_cobranca: txt(formData, "modo_cobranca"),
      grupo_escolha,
      preferencial: Boolean(grupo_escolha) && bool(formData, "preferencial"),
    })
    .eq("id", id)
    .select("id"),
  );
  revalidarReceita(codigo);
}

export async function removerMaterial(formData: FormData) {
  const codigo = txtReq(formData, "codigo_analise");
  const id = Number(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  garantirEscrita(await supabase.from("insumo_analise").delete().eq("id", id).select("id"));
  revalidarReceita(codigo);
}
