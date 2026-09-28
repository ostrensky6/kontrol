"use server";

import { revalidatePath } from "next/cache";

import { pode } from "@/lib/auth/permissao-efetiva";
import { falha, mensagemDoBanco, sucesso, type EstadoAcao } from "@/lib/erros";
import { recusaSemPermissao } from "@/lib/orcamento/permissao-acao";
import { normalizarTexto, textoVazio } from "@/lib/orcamento/texto-rico";
import { CHAVE_SECAO_REGEX, normalizarTextosProposta, type TextosProposta } from "@/lib/orcamento/textos-proposta";
import { createClient } from "@/lib/supabase/server";

const LIMITE_JSON = 200_000;

/**
 * Lê o campo `textos` do formulário. Recusa em vez de cortar calado: texto
 * acima do limite volta como erro, não como seção vazia.
 */
function lerTextos(formData: FormData): TextosProposta | string {
  const bruto = String(formData.get("textos") ?? "");
  if (!bruto || bruto.length > LIMITE_JSON) return "Texto grande demais para salvar. Divida em seções menores.";
  let valor: unknown;
  try {
    valor = JSON.parse(bruto);
  } catch {
    return "Não foi possível ler o texto. Recarregue a página e tente de novo.";
  }
  const textos = normalizarTextosProposta(valor);
  if (!textos) return "Não foi possível ler o texto. Recarregue a página e tente de novo.";
  const original = valor as { descricao?: unknown; secoes?: Array<{ texto?: unknown }> };
  const perdido = [original.descricao, ...(original.secoes ?? []).map((s) => s?.texto)].some(
    (t) => t != null && !textoVazio(t as never) && normalizarTexto(t) === null,
  );
  if (perdido) return "Um dos textos passou de 20.000 caracteres. Encurte antes de salvar.";
  return textos;
}

function id(formData: FormData, campo: string) {
  const n = Number(formData.get(campo));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Textos de uma versão emitida ou enviada: grava na própria versão (0135), com auditoria. */
export async function salvarTextosVersao(_estado: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  const versaoId = id(formData, "versao_id");
  if (!versaoId) return falha("Proposta não identificada.");
  const recusa = await recusaSemPermissao("emitir_final");
  if (recusa) return recusa;
  const textos = lerTextos(formData);
  if (typeof textos === "string") return falha(textos);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("atualizar_textos_versao_final", {
    p_versao_id: versaoId,
    p_textos: textos,
  });
  if (error) return falha(mensagemDoBanco(error));
  if (!(data as { id?: number } | null)?.id) return falha("O banco não confirmou a gravação. Nada foi salvo.");
  revalidatePath(`/orcamento/final/${versaoId}`);
  return sucesso("Texto salvo nesta versão.");
}

/** Textos do orçamento em elaboração: vão para a próxima emissão. */
export async function salvarTextosDemanda(_estado: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  const demandaId = id(formData, "demanda_id");
  if (!demandaId) return falha("Orçamento não identificado.");
  const recusa = await recusaSemPermissao("criar_demanda");
  if (recusa) return recusa;
  const textos = lerTextos(formData);
  if (typeof textos === "string") return falha(textos);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("demandas_propostas")
    .update({ textos_proposta: textos })
    .eq("id", demandaId)
    .select("id");
  if (error) return falha(mensagemDoBanco(error));
  if (!data?.length) return falha("Nada foi salvo: seu perfil não pode alterar este orçamento.");
  revalidatePath(`/orcamento/demandas/${demandaId}`);
  return sucesso("Texto salvo.");
}

/** Dados cadastrais da empresa emissora (cabeçalho e rodapé da proposta). */
export async function salvarEmpresaEmissora(_estado: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  if (!(await pode("cadastros.editar"))) {
    return falha("Alterar os dados da empresa exige a permissão “Cadastros: editar”.");
  }
  const codigo = String(formData.get("codigo") ?? "");
  if (codigo !== "ATGC" && codigo !== "GIA") return falha("Empresa inválida.");
  const campo = (nome: string, max: number) => {
    const valor = String(formData.get(nome) ?? "").trim();
    return valor ? valor.slice(0, max) : null;
  };
  const nomeLegal = campo("nome_legal", 160);
  if (!nomeLegal || nomeLegal.length < 3) return falha("Informe a razão social.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("empresas_emissoras")
    .update({
      nome_legal: nomeLegal,
      cnpj: campo("cnpj", 30),
      endereco: campo("endereco", 240),
      telefone: campo("telefone", 60),
      email: campo("email", 120),
      site: campo("site", 120),
      atualizado_em: new Date().toISOString(),
    })
    .eq("codigo", codigo)
    .select("id");
  if (error) return falha(mensagemDoBanco(error));
  if (!data?.length) return falha("Nada foi salvo: seu perfil não pode alterar os dados da empresa.");
  revalidatePath("/orcamento/documento-proposta");
  return sucesso("Dados da empresa salvos. Valem para as próximas emissões.");
}

/** Seção padrão de uma empresa (Orçamentos › Documento da proposta). */
export async function salvarSecaoPadrao(_estado: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  const recusa = await recusaSemPermissao("emitir_final");
  if (recusa) return recusa;
  const empresa = String(formData.get("empresa_codigo") ?? "");
  if (empresa !== "ATGC" && empresa !== "GIA") return falha("Empresa inválida.");
  const chave = String(formData.get("chave") ?? "").trim();
  if (!CHAVE_SECAO_REGEX.test(chave)) {
    return falha("Identificador inválido: use de 2 a 40 letras minúsculas, números ou _ (ex.: garantia_resultados).");
  }
  const titulo = String(formData.get("titulo") ?? "").trim();
  if (titulo.length < 2 || titulo.length > 120) return falha("Informe um título de 2 a 120 caracteres.");
  const ordem = Math.round(Number(formData.get("ordem")));
  if (!Number.isFinite(ordem) || ordem < 0 || ordem > 1000) return falha("Ordem deve ser um número entre 0 e 1000.");
  const ativo = formData.get("ativo") === "on" || formData.get("ativo") === "true";
  const brutoTexto = String(formData.get("texto") ?? "");
  let texto: unknown = null;
  try {
    texto = brutoTexto ? JSON.parse(brutoTexto) : null;
  } catch {
    return falha("Não foi possível ler o texto.");
  }
  const doc = normalizarTexto(texto) ?? { type: "doc" as const, content: [] };
  if (texto != null && normalizarTexto(texto) === null) return falha("Texto grande demais ou inválido.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proposta_secoes_padrao")
    .upsert(
      { empresa_codigo: empresa, chave, titulo, texto: doc, ordem, ativo, atualizado_em: new Date().toISOString() },
      { onConflict: "empresa_codigo,chave" },
    )
    .select("id");
  if (error) return falha(mensagemDoBanco(error));
  if (!data?.length) return falha("Nada foi salvo: seu perfil não pode alterar os textos padrão.");
  revalidatePath("/orcamento/documento-proposta");
  return sucesso("Seção padrão salva.");
}
