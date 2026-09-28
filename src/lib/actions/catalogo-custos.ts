"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { exigirPapelOrcamento } from "@/lib/orcamento/governanca";
import { lerItemCatalogo } from "@/lib/orcamento/catalogo-custos";
import { falha, mensagemDoBanco, sucesso, type EstadoAcao } from "@/lib/erros";

/**
 * Edição do catálogo de custos de projeto (Fase D, migration 0138). As regras
 * (item repetido, pessoal, histórico, trava) ficam nas RPCs; aqui só a leitura
 * do formulário, a permissão da tela e o aviso de resultado.
 */

// A seção "Catálogo institucional de custos" vive na página de Modelos e catálogo.
const CAMINHO_CATALOGO = "/orcamento/modelos";

function texto(formData: FormData, chave: string) {
  const valor = String(formData.get(chave) ?? "").trim();
  return valor || null;
}

/** Cria (sem `id`) ou edita um item. Devolve o aviso para o formulário em diálogo. */
export async function salvarItemCatalogo(formData: FormData): Promise<EstadoAcao> {
  try {
    await exigirPapelOrcamento("gerir_modelos");
    const lido = lerItemCatalogo(formData);
    if (!lido.ok) return falha(lido.message);
    const { item } = lido;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("catalogo_projeto_salvar_item", {
      p_id: item.id,
      p_rubrica: item.rubrica,
      p_descricao: item.descricao,
      p_unidade: item.unidade,
      p_categoria: item.categoria,
      p_preco: item.preco,
    });
    if (error) return falha(mensagemDoBanco(error));
    revalidatePath(CAMINHO_CATALOGO);
    return sucesso(item.id ? `${item.id} atualizado.` : `Item ${String(data)} criado no catálogo.`);
  } catch (erro) {
    unstable_rethrow(erro);
    return falha(mensagemDoBanco(erro instanceof Error ? erro.message : erro));
  }
}

/**
 * Arquiva (`ativo=0`) ou reativa (`ativo=1`) um item. Usada pelo botão com
 * confirmação, que espera uma ação sem retorno: a recusa é lançada.
 */
export async function definirAtivoItemCatalogo(formData: FormData): Promise<void> {
  await exigirPapelOrcamento("gerir_modelos");
  const id = texto(formData, "catalogo_item_id");
  if (!id) throw new Error("Item do catálogo não informado.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("catalogo_projeto_definir_ativo", {
    p_id: id,
    p_ativo: formData.get("ativo") === "1",
  });
  if (error) throw new Error(mensagemDoBanco(error));
  revalidatePath(CAMINHO_CATALOGO);
}

/** Junta dois itens da mesma rubrica: `remover` passa a apontar para `manter`. */
export async function unificarItensCatalogo(formData: FormData): Promise<EstadoAcao> {
  try {
    await exigirPapelOrcamento("gerir_modelos");
    const manter = texto(formData, "manter");
    const remover = texto(formData, "remover");
    if (!manter || !remover) return falha("Escolha o item que fica.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("catalogo_projeto_unificar", { p_manter: manter, p_remover: remover });
    if (error) return falha(mensagemDoBanco(error));
    revalidatePath(CAMINHO_CATALOGO);
    return sucesso(`${remover} unificado em ${manter}.`);
  } catch (erro) {
    unstable_rethrow(erro);
    return falha(mensagemDoBanco(erro instanceof Error ? erro.message : erro));
  }
}
