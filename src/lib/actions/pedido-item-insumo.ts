"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { pode } from "@/lib/auth/permissao-efetiva";
import { mensagemDoBanco } from "@/lib/erros";
import {
  ehItemNovo,
  lerDadosInsumoDoItem,
  MSG_SEM_EDITAR_INSUMOS,
  nomeNormalizado,
  STATUS_CADASTRA_ITEM_NOVO,
} from "@/lib/pedido/item-novo";
import { semLinhasAfetadas } from "@/lib/supabase/escrita";
import { lerTudo } from "@/lib/supabase/ler-tudo";
import { createClientUntyped } from "@/lib/supabase/server";
import type { FormState } from "./cadastros";

type Supabase = Awaited<ReturnType<typeof createClientUntyped>>;
type InsumoDoCadastro = { id: number; especificacao: string | null; codigo_fabricante: string | null; ativo: boolean | null };

/** Telas que mostram o insumo ou o item: a mesma lista de quem salva em Cadastros > Insumos. */
const DEPENDENTES = ["/cadastros", "/cadastros/insumos", "/estoque", "/estoque/situacao", "/compras", "/pedido", "/"];

function revalidar(pedidoId: number) {
  revalidatePath(`/pedido/${pedidoId}`);
  for (const caminho of DEPENDENTES) revalidatePath(caminho);
}

/** Descrição e fornecedores escritos no item, nos campos do insumo (0187). */
function textosDoItemParaInsumo(item: {
  caracteristicas?: string | null;
  fornecedor_sugerido?: string | null;
  outros_fornecedores?: string | null;
}): Record<string, string> | null {
  const textos: Record<string, string> = {};
  const descricao = item.caracteristicas?.trim();
  if (descricao) textos.descricao_detalhada = descricao.slice(0, 4000);
  const fornecedores = [item.fornecedor_sugerido, item.outros_fornecedores]
    .map((valor) => valor?.trim())
    .filter(Boolean)
    .join("; ");
  if (fornecedores) textos.fornecedores_sugeridos = fornecedores.slice(0, 2000);
  return Object.keys(textos).length > 0 ? textos : null;
}

/** Liga o item ao insumo só se ele ainda estiver sem insumo; devolve o motivo quando não liga. */
async function ligarItem(supabase: Supabase, itemId: number, pedidoId: number, insumoId: number): Promise<string | null> {
  const { data, error } = await supabase
    .from("pedidos_internos_itens")
    .update({ insumo_id: insumoId })
    .eq("id", itemId)
    .eq("pedido_interno_id", pedidoId)
    .is("insumo_id", null)
    .select("id");
  if (error) return mensagemDoBanco(error, "o item não foi alterado");
  if (semLinhasAfetadas(data)) return "o item já foi alterado por outra pessoa ou seu perfil não pode mexer nele nesta etapa";
  return null;
}

/**
 * Item novo do pedido (algo nunca comprado): cadastra o insumo com os dados
 * conferidos por quem conduz a compra e liga o item a ele, ou liga o item a
 * um insumo que já existia. Decisão de Antonio em 19/11/2026.
 *
 * Vale a mesma regra de sempre: mexer no item pede a etapa certa (e "Aprovar
 * pedidos" na aprovação); criar insumo pede "Editar insumos" (o banco exige
 * os dois). O insumo nasce sem lote, pela mesma função de Cadastros > Insumos.
 */
export async function cadastrarInsumoDoItemPedido(_prev: FormState, formData: FormData): Promise<FormState> {
  const itemId = Number(formData.get("item_id"));
  const pedidoId = Number(formData.get("pedido_interno_id"));
  if (!Number.isSafeInteger(itemId) || itemId <= 0 || !Number.isSafeInteger(pedidoId) || pedidoId <= 0) {
    return { ok: false, message: "Item não informado." };
  }

  const supabase = await createClientUntyped();
  const [{ data: pedido }, { data: item }] = await Promise.all([
    supabase.from("pedidos_internos").select("status").eq("id", pedidoId).maybeSingle(),
    supabase
      .from("pedidos_internos_itens")
      .select("id, tipo, insumo_id, caracteristicas, fornecedor_sugerido, outros_fornecedores")
      .eq("id", itemId)
      .eq("pedido_interno_id", pedidoId)
      .maybeSingle(),
  ]);
  if (!pedido || !item) return { ok: false, message: "Item não encontrado neste pedido. Atualize a tela." };
  const status = String(pedido.status ?? "");
  if (!STATUS_CADASTRA_ITEM_NOVO.includes(status)) {
    return { ok: false, message: "Nesta etapa os itens não mudam. Devolva o pedido para ajuste antes de alterar a lista." };
  }
  if (["em_validacao", "validado", "aguardando_area", "aguardando_financeiro"].includes(status) && !(await pode("pedido.aprovar"))) {
    return { ok: false, message: "Nesta etapa, só quem tem a permissão “Aprovar pedidos” mexe nos itens." };
  }
  if (item.tipo === "servico") return { ok: false, message: "Serviço não tem insumo no cadastro." };
  if (!ehItemNovo(item)) return { ok: false, message: "Este item já está ligado a um insumo. Atualize a tela." };

  // "Ligar a este": o item passa a apontar para um insumo que já existia
  const ligarA = Number(formData.get("ligar_insumo_id") ?? 0);
  if (ligarA > 0) {
    const { data: existente } = await supabase.from("insumos").select("id, especificacao, ativo").eq("id", ligarA).maybeSingle();
    if (!existente || existente.ativo === false) {
      return { ok: false, message: "Esse insumo não está mais ativo no cadastro. Atualize a tela e escolha outro." };
    }
    const motivo = await ligarItem(supabase, itemId, pedidoId, ligarA);
    if (motivo) return { ok: false, message: `O item não foi ligado: ${motivo}.` };
    revalidar(pedidoId);
    return { ok: true, message: `Item ligado ao insumo “${existente.especificacao ?? `#${ligarA}`}”.` };
  }

  if (!(await pode("insumos.editar"))) return { ok: false, message: MSG_SEM_EDITAR_INSUMOS };
  const lido = lerDadosInsumoDoItem(formData);
  if (!lido.ok) return { ok: false, message: lido.message };
  const { dados } = lido;

  // cadastro repetido: mesmo nome ou mesmo código do fabricante já existe
  const cadastro = await lerTudo<InsumoDoCadastro>((de, ate) =>
    supabase.from("insumos").select("id, especificacao, codigo_fabricante, ativo").order("id").range(de, ate),
  );
  if (cadastro.error) {
    return { ok: false, message: "Não foi possível conferir o cadastro de insumos. Nada foi gravado; tente de novo." };
  }
  const nome = nomeNormalizado(dados.especificacao);
  const codigo = nomeNormalizado(dados.codigo_fabricante);
  const repetido = cadastro.data.find(
    (insumo) =>
      nomeNormalizado(insumo.especificacao) === nome ||
      (codigo !== "" && nomeNormalizado(insumo.codigo_fabricante) === codigo),
  );
  if (repetido) {
    const qual = `“${repetido.especificacao ?? `#${repetido.id}`}”`;
    return {
      ok: false,
      message:
        repetido.ativo === false
          ? `Já existe no cadastro o insumo ${qual}, inativo. Reative-o em Cadastros > Insumos ou mude o nome.`
          : `Já existe no cadastro o insumo ${qual}. Use “Ligar a este”, em “Parecidos no cadastro”, ou mude o nome.`,
    };
  }

  // a mesma função de Cadastros > Insumos, com zero embalagens: o insumo nasce sem lote
  const { data: criado, error } = await supabase.rpc("criar_insumo_com_quantidade", {
    p_dados_insumo: dados,
    p_quantidade_embalagens: 0,
    p_operacao_id: randomUUID(),
  });
  if (error) return { ok: false, message: mensagemDoBanco(error, "Não foi possível cadastrar o insumo.") };
  const insumoId = Number((criado as { insumo_id?: number } | null)?.insumo_id);
  if (!Number.isSafeInteger(insumoId) || insumoId <= 0) {
    return { ok: false, message: "Não foi possível confirmar o insumo criado. Confira em Cadastros > Insumos antes de tentar de novo." };
  }

  // 0187: o que quem pediu escreveu no item segue para o cadastro (descrição e
  // fornecedores da planilha de compras). Fora da lista fechada da RPC: grava
  // logo depois; se falhar, o insumo já existe e se completa em Cadastros.
  const textos = textosDoItemParaInsumo(item);
  if (textos) {
    const { error: erroTextos } = await supabase.from("insumos").update(textos).eq("id", insumoId).select("id");
    if (erroTextos) console.warn(`Kontrol: textos do item ${itemId} não foram para o insumo ${insumoId}:`, erroTextos.message);
  }

  const motivo = await ligarItem(supabase, itemId, pedidoId, insumoId);
  revalidar(pedidoId);
  if (motivo) {
    return {
      ok: false,
      message: `O insumo “${dados.especificacao}” foi cadastrado, mas o item não foi ligado a ele: ${motivo}. Use “Editar” no item e escolha esse insumo em “Insumo existente”.`,
    };
  }
  return {
    ok: true,
    message: `Insumo “${dados.especificacao}” cadastrado e ligado ao item. Tipo técnico, mínimo e armazenamento se completam em Cadastros > Insumos.`,
  };
}
