"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createClientUntyped } from "@/lib/supabase/server";
import { usuarioAtual } from "@/lib/auth/roles";
import { pode } from "@/lib/auth/permissao-efetiva";
import { computarDemandaPlano } from "@/lib/costing/demanda";
import { falha, mensagemDoBanco, type EstadoAcao } from "@/lib/erros";
import type { FormState } from "./cadastros";

const SEM_PERMISSAO: FormState = {
  ok: false,
  message: "Seu perfil não tem permissão para esta ação. Peça ao administrador para liberar em Usuários.",
};
const MSG_VALIDADE_CRITICO = "Validade é obrigatória para receber insumo crítico.";
const UUID_RECEBIMENTO = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function leadTimeEfetivo(
  leadTimeInsumo: unknown,
  prazoFornecedor: unknown,
): number | null {
  const lead = Number(leadTimeInsumo);
  if (Number.isFinite(lead) && lead > 0) return lead;
  const prazo = Number(prazoFornecedor);
  return Number.isFinite(prazo) && prazo > 0 ? prazo : null;
}

function dataPrevistaPorPrazo(prazoDias: number | null): string | null {
  if (!(prazoDias && prazoDias > 0)) return null;
  return new Date(Date.now() + prazoDias * 86400000).toISOString().slice(0, 10);
}

export async function criarPedido(_prev: FormState, formData: FormData): Promise<FormState> {
  const u = await usuarioAtual();
  const fornecedor_id = formData.get("fornecedor_id")
    ? Number(formData.get("fornecedor_id"))
    : null;
  const projeto = (formData.get("projeto") as string)?.trim() || null;
  const projeto_id = formData.get("projeto_id") ? Number(formData.get("projeto_id")) : null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pedidos_compra")
    .insert({ fornecedor_id, projeto, projeto_id, solicitante: u?.email ?? null, status: "solicitado" })
    .select("id")
    .single();
  if (error) return { ok: false, message: mensagemDoBanco(error, "Não foi possível criar a solicitação.") };
  revalidatePath("/compras");
  redirect(`/compras/${data.id}`);
}

export async function gerarRascunhosReposicao(_prev: FormState): Promise<FormState> {
  void _prev;
  if (!(await pode("compras.solicitar"))) return SEM_PERMISSAO;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gerar_reposicao_automatica");
  if (error) return { ok: false, message: mensagemDoBanco(error) };

  const resultado = data as {
    pedidos_criados?: number;
    itens_criados?: number;
    notificacoes_criadas?: number;
  } | null;
  revalidatePath("/compras");
  revalidatePath("/suprimentos");
  revalidatePath("/estoque");
  revalidatePath("/estoque/controle");
  revalidatePath("/notificacoes");
  revalidatePath("/");
  return {
    ok: true,
    message: `${resultado?.pedidos_criados ?? 0} rascunho(s), ${resultado?.itens_criados ?? 0} item(ns) de reposição e ${resultado?.notificacoes_criadas ?? 0} notificação(ões) gerados.`,
  };
}

/**
 * 2.3 — Falta do plano → pedido interno. A falta operacional nasce como
 * demanda rastreável do laboratório/campo; a formalização em compra acontece
 * depois da aprovação do coordenador. A RPC é transacional e desconta o que já
 * está pedido para o plano (dois cliques não geram dois pedidos).
 */
export async function comprarFaltasDoPlano(_prev: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  const planId = Number(formData.get("planejamento_id"));
  if (!planId) return falha("Planejamento não informado.");
  if (!(await pode("pedido.criar"))) {
    return falha("Seu perfil não tem permissão para criar pedido interno. Peça ao administrador para liberar em Usuários.");
  }
  const supabase = await createClientUntyped();

  const demanda = await computarDemandaPlano(supabase, planId);
  const faltas = demanda.filter((d) => d.falta > 0);
  if (faltas.length === 0) return falha("Este plano não tem faltas para comprar.");

  const { data: insumos } = await supabase
    .from("insumos")
    .select("id, custo_unitario, fornecedores!insumos_fornecedor_id_fkey(nome)")
    .in("id", faltas.map((f) => f.insumo_id));
  const infoMap = new Map((insumos ?? []).map((i) => [i.id, i]));

  const itens = faltas.map((f) => {
    const info = infoMap.get(f.insumo_id) as {
      custo_unitario?: number | null;
      fornecedores?: { nome: string | null } | { nome: string | null }[] | null;
    } | undefined;
    const fornecedor = Array.isArray(info?.fornecedores)
      ? info?.fornecedores[0]?.nome
      : info?.fornecedores?.nome;
    const quantidadePedido = f.quantidadeCompra > 0 ? f.quantidadeCompra : f.falta;
    const minimoCompra = f.quantidadeMinimaCompra ?? f.quantidadeEmbalagem;
    const unidade = f.unidade ?? "";
    const regraCompra = minimoCompra
      ? ` Pedido ajustado para ${quantidadePedido} ${unidade} pela quantidade mínima/múltiplo de compra de ${minimoCompra} ${unidade}.`
      : "";
    const custoUnidade = f.custoUnitario ?? info?.custo_unitario ?? null;
    // Compra em frascos (unidade oficial do estoque): a falta vem na unidade
    // física e é arredondada para frascos inteiros.
    const conteudo = f.quantidadeEmbalagem && f.quantidadeEmbalagem > 0 ? f.quantidadeEmbalagem : null;
    const frascos = conteudo ? Math.ceil(quantidadePedido / conteudo) : null;
    return {
      insumo_id: f.insumo_id,
      especificacao: f.especificacao,
      quantidade: frascos ?? quantidadePedido,
      unidade: frascos ? `frasco(s) de ${conteudo} ${unidade}`.trim() : f.unidade,
      quantidade_em: frascos ? "embalagem" : "unidade",
      conteudo_embalagem: conteudo,
      orcamento_previo: custoUnidade == null ? null : frascos && conteudo ? custoUnidade * conteudo : custoUnidade,
      fornecedor_sugerido: fornecedor ?? null,
      observacao: `Falta operacional gerada pelo planejamento #${planId}: falta de ${f.falta} ${unidade}.${regraCompra}`,
    };
  });

  const { data, error } = await supabase.rpc("criar_pedido_faltas_planejamento", {
    p_planejamento_id: planId,
    p_itens: itens,
  });
  if (error) return falha(mensagemDoBanco(error));
  const pedidoId = Number((data as { pedido_id?: number } | null)?.pedido_id);
  if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
    return falha("Não foi possível criar o pedido interno para as faltas do planejamento.");
  }

  revalidatePath("/pedido");
  revalidatePath(`/planejamento/${planId}`);
  revalidatePath("/suprimentos");
  redirect(`/pedido/${pedidoId}`);
}

export async function adicionarItemPedido(_prev: FormState, formData: FormData): Promise<FormState> {
  const pedido_id = Number(formData.get("pedido_id"));
  const insumo_id = Number(formData.get("insumo_id"));
  const quantidade = Number(formData.get("quantidade"));
  const custo = formData.get("custo_unitario_estimado")
    ? Number(formData.get("custo_unitario_estimado"))
    : null;
  if (!pedido_id || !insumo_id || !(quantidade > 0)) {
    return { ok: false, message: "Escolha o insumo e informe uma quantidade maior que zero." };
  }
  const supabase = await createClient();
  // Compra em frascos: com embalagem cadastrada, a quantidade digitada é de
  // frascos e o volume de cada um vem do cadastro (ajustável na chegada).
  const { data: insumo } = await supabase
    .from("insumos")
    .select("quantidade_embalagem")
    .eq("id", insumo_id)
    .maybeSingle();
  const conteudo = Number(insumo?.quantidade_embalagem) > 0 ? Number(insumo?.quantidade_embalagem) : null;
  if (conteudo && !Number.isInteger(quantidade)) {
    return { ok: false, message: "Informe a quantidade em frascos inteiros." };
  }
  const { error } = await supabase.from("pedidos_compra_itens").insert({
    pedido_id,
    insumo_id,
    quantidade,
    custo_unitario_estimado: custo,
    quantidade_em: conteudo ? "embalagem" : "unidade",
    conteudo_embalagem: conteudo,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error, "Não foi possível adicionar o item.") };
  revalidatePath(`/compras/${pedido_id}`);
  return { ok: true, message: "Item adicionado." };
}

export async function removerItemPedido(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = Number(formData.get("item_id"));
  const pedido_id = Number(formData.get("pedido_id"));
  if (!id) return { ok: false, message: "Item não informado." };
  const supabase = await createClient();
  const { error } = await supabase.from("pedidos_compra_itens").delete().eq("id", id);
  if (error) return { ok: false, message: mensagemDoBanco(error, "Não foi possível remover o item.") };
  revalidatePath(`/compras/${pedido_id}`);
  return { ok: true, message: "Item removido." };
}

/**
 * Define o fornecedor de uma compra ainda solicitada. A formalização do pedido
 * interno cria a compra sem fornecedor; sem ele a impressão sai incompleta.
 * A RLS (0127) já restringe a alteração a `solicitado` para quem só solicita.
 */
export async function definirFornecedorCompra(_prev: FormState, formData: FormData): Promise<FormState> {
  const pedidoId = Number(formData.get("pedido_id"));
  const fornecedorId = Number(formData.get("fornecedor_id"));
  if (!(pedidoId > 0)) return { ok: false, message: "Compra não informada." };
  if (!(fornecedorId > 0)) return { ok: false, message: "Escolha o fornecedor." };
  const [podeSolicitar, podeAprovar] = await Promise.all([pode("compras.solicitar"), pode("compras.aprovar")]);
  if (!podeSolicitar && !podeAprovar) return SEM_PERMISSAO;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pedidos_compra")
    .update({ fornecedor_id: fornecedorId })
    .eq("id", pedidoId)
    .eq("status", "solicitado")
    .select("id");
  if (error) return { ok: false, message: mensagemDoBanco(error, "Não foi possível definir o fornecedor.") };
  if ((data ?? []).length === 0) {
    return { ok: false, message: "Só é possível definir o fornecedor enquanto a compra está solicitada." };
  }
  revalidatePath(`/compras/${pedidoId}`);
  revalidatePath(`/compras/${pedidoId}/imprimir`);
  revalidatePath("/compras");
  return { ok: true, message: "Fornecedor definido." };
}

function revalidarPedidoCompra(pedidoId: number) {
  revalidatePath(`/compras/${pedidoId}`);
  revalidatePath("/compras");
  revalidatePath("/recebimento");
  revalidatePath("/suprimentos");
}

export async function aprovarPedido(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("compras.aprovar"))) return SEM_PERMISSAO;
  const pedido_id = Number(formData.get("pedido_id"));
  const supabase = await createClient();

  const [{ data: ped }, { data: itens }] = await Promise.all([
    supabase
      .from("pedidos_compra")
      .select("fornecedor_id, fornecedores(prazo_medio_dias)")
      .eq("id", pedido_id)
      .single(),
    supabase
      .from("pedidos_compra_itens")
      .select("insumos(lead_time_dias, fornecedores!insumos_fornecedor_id_fkey(prazo_medio_dias))")
      .eq("pedido_id", pedido_id),
  ]);

  const prazosItens = (itens ?? [])
    .map((item) => {
      const insumo = item.insumos as unknown as {
        lead_time_dias: number | null;
        fornecedores: { prazo_medio_dias: number | null } | null;
      } | null;
      return leadTimeEfetivo(
        insumo?.lead_time_dias,
        insumo?.fornecedores?.prazo_medio_dias,
      );
    })
    .filter((prazo): prazo is number => prazo != null);

  const prazoFornecedorPedido = (ped?.fornecedores as unknown as { prazo_medio_dias: number | null } | null)
    ?.prazo_medio_dias;
  const maiorPrazo = prazosItens.length > 0
    ? Math.max(...prazosItens)
    : leadTimeEfetivo(null, prazoFornecedorPedido);
  const prevista = dataPrevistaPorPrazo(maiorPrazo);

  const { error } = await supabase.rpc("transicionar_pedido_compra", {
    p_pedido_id: pedido_id,
    p_status_destino: "aprovado",
    p_observacao: "Aprovação administrativa da compra.",
    p_data_prevista_entrega: prevista ?? undefined,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidarPedidoCompra(pedido_id);
  return { ok: true, message: "Pedido aprovado." };
}

export async function marcarEnviado(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("compras.aprovar"))) return SEM_PERMISSAO;
  const pedido_id = Number(formData.get("pedido_id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("transicionar_pedido_compra", {
    p_pedido_id: pedido_id,
    p_status_destino: "enviado",
    p_observacao: "Pedido enviado ao fornecedor.",
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidarPedidoCompra(pedido_id);
  return { ok: true, message: "Pedido marcado como enviado." };
}

export async function cancelarPedido(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await pode("compras.cancelar"))) return SEM_PERMISSAO;
  const pedido_id = Number(formData.get("pedido_id"));
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (motivo.length < 3) return { ok: false, message: "Informe o motivo do cancelamento." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("transicionar_pedido_compra", {
    p_pedido_id: pedido_id,
    p_status_destino: "cancelado",
    p_observacao: `Compra cancelada: ${motivo}`,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidarPedidoCompra(pedido_id);
  return { ok: true, message: "Compra cancelada." };
}

/** Encerra uma compra recebida em parte: o restante não será mais esperado. */
export async function encerrarPedidoComPendencia(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await pode("compras.aprovar"))) return SEM_PERMISSAO;
  const pedido_id = Number(formData.get("pedido_id"));
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (!motivo) return { ok: false, message: "Informe por que o restante não será recebido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("transicionar_pedido_compra", {
    p_pedido_id: pedido_id,
    p_status_destino: "recebido",
    p_observacao: motivo,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };
  revalidarPedidoCompra(pedido_id);
  return { ok: true, message: "Compra encerrada. A pendência ficou registrada nos itens." };
}

/** Recebe um item do pedido: cria lote em quarentena (FEFO) e vincula. */
export async function receberItemPedido(formData: FormData): Promise<FormState> {
  if (!(await pode("compras.receber"))) return SEM_PERMISSAO;
  const pedido_id = Number(formData.get("pedido_id"));
  const item_id = Number(formData.get("item_id"));
  const operacaoId = String(formData.get("operacao_id") ?? "").trim();
  if (!UUID_RECEBIMENTO.test(operacaoId)) {
    return { ok: false, message: "Identificador da operação de recebimento inválido." };
  }
  const validade = (formData.get("validade") as string) || null;
  const codigo = (formData.get("codigo") as string) || null;
  const quantidadeRecebida = formData.get("quantidade_recebida")
    ? Number(formData.get("quantidade_recebida"))
    : null;
  const supabase = await createClient();
  const u = await usuarioAtual();
  const responsavel = u?.nome ?? u?.email ?? null;

  const { data: item } = await supabase
    .from("pedidos_compra_itens")
    .select("insumos(categoria_compra)")
    .eq("id", item_id)
    .eq("pedido_id", pedido_id)
    .single();
  const insumo = item?.insumos as { categoria_compra: string | null } | null | undefined;
  if (insumo?.categoria_compra === "critico" && !validade) {
    return { ok: false, message: MSG_VALIDADE_CRITICO };
  }

  // Frasco com volume diferente do cadastro e local de guarda: valem só para
  // esta entrega (lote e livro); o item da compra não muda (EST2-6/CAD2-8).
  const conteudoInformado = Number(formData.get("conteudo_embalagem"));
  const localInformado = Number(formData.get("local_id"));

  const { error } = await supabase.rpc("receber_item_pedido_compra", {
    p_pedido_id: pedido_id,
    p_item_id: item_id,
    p_operacao_id: operacaoId,
    p_quantidade: quantidadeRecebida ?? undefined,
    p_validade: validade ?? undefined,
    p_codigo: codigo ?? undefined,
    p_responsavel: responsavel ?? undefined,
    p_conteudo_embalagem: conteudoInformado > 0 ? conteudoInformado : undefined,
    p_local_id: Number.isInteger(localInformado) && localInformado > 0 ? localInformado : undefined,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error) };

  revalidatePath(`/compras/${pedido_id}`);
  revalidatePath("/compras");
  revalidatePath("/recebimento");
  revalidatePath("/suprimentos");
  revalidatePath("/estoque");
  return {
    ok: true,
    message: "Chegada registrada. O lote entrou em quarentena e precisa ser aceito por outra pessoa.",
  };
}
