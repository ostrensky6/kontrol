"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { exigirPapelOrcamento } from "@/lib/orcamento/governanca";
import { lerItemCatalogo } from "@/lib/orcamento/catalogo-custos";
import {
  lerPlanilhaCatalogo,
  lerPreviaImportacao,
  mensagemImportacao,
  payloadImportacao,
  resumirImportacao,
  type LinhaPreviaImportacao,
  type ResumoImportacao,
} from "@/lib/orcamento/catalogo-planilha";
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

/**
 * Pendência de pessoal (0139): valor de PE informado por quem não tinha a permissão de pessoal
 * na conclusão da revisão. Quem tem "Modelos e catálogos" + pessoal aplica ou descarta.
 */
export async function resolverPendenciaCatalogo(formData: FormData): Promise<EstadoAcao> {
  try {
    await exigirPapelOrcamento("gerir_modelos");
    const id = Number(formData.get("pendencia_id"));
    if (!Number.isInteger(id) || id <= 0) return falha("Pendência não informada.");
    const aplicar = formData.get("aplicar") === "1";
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("catalogo_projeto_resolver_pendencia", {
      p_pendencia_id: id,
      p_aplicar: aplicar,
    });
    if (error) return falha(mensagemDoBanco(error));
    revalidatePath(CAMINHO_CATALOGO);
    return sucesso(aplicar ? `Valor aplicado ao catálogo (${String(data)}).` : "Pendência descartada; o catálogo fica como está.");
  } catch (erro) {
    unstable_rethrow(erro);
    return falha(mensagemDoBanco(erro instanceof Error ? erro.message : erro));
  }
}

export type EstadoImportacaoCatalogo = EstadoAcao & {
  aplicado?: boolean;
  linhas?: LinhaPreviaImportacao[];
  ignoradas?: string[];
  resumo?: ResumoImportacao;
};

/**
 * Importa a planilha do catálogo. Sem `aplicar=1` só devolve a prévia; com ele grava novos e
 * valores alterados (uma transação, sob a mesma trava da conclusão de revisão). Nada é apagado.
 */
export async function importarPlanilhaCatalogo(
  _anterior: EstadoImportacaoCatalogo,
  formData: FormData,
): Promise<EstadoImportacaoCatalogo> {
  try {
    await exigirPapelOrcamento("gerir_modelos");
    const arquivo = formData.get("arquivo");
    if (!(arquivo instanceof File) || arquivo.size === 0) return falha("Escolha a planilha (.xlsx).");
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(await arquivo.arrayBuffer());
    } catch {
      return falha("Não foi possível ler a planilha. Confira se é um arquivo .xlsx (Excel).");
    }
    const leitura = lerPlanilhaCatalogo(workbook);
    if (!leitura.abas.length) {
      return falha('Nenhuma aba de rubrica encontrada. Use a planilha de "Exportar planilha" (abas PE, MC, MP, ST, VD, OU).');
    }
    if (!leitura.linhas.length) {
      return { ok: false, message: "A planilha não tem linhas para importar.", ignoradas: leitura.ignoradas };
    }
    const aplicar = formData.get("aplicar") === "1";
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("catalogo_projeto_importar", {
      p_itens: payloadImportacao(leitura.linhas),
      p_aplicar: aplicar,
    });
    if (error) return falha(mensagemDoBanco(error));
    const linhas = lerPreviaImportacao(leitura.linhas, data);
    const resumo = resumirImportacao(linhas);
    if (aplicar) revalidatePath(CAMINHO_CATALOGO);
    return {
      ok: true,
      aplicado: aplicar,
      message: mensagemImportacao(resumo, aplicar),
      linhas,
      resumo,
      ignoradas: leitura.ignoradas,
    };
  } catch (erro) {
    unstable_rethrow(erro);
    return falha(mensagemDoBanco(erro instanceof Error ? erro.message : erro));
  }
}
