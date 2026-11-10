import type { SupabaseClient } from "@supabase/supabase-js";

import { rotuloQuantidadeItem } from "@/lib/estoque/quantidade-compra";
import { lerTudo } from "@/lib/supabase/ler-tudo";

/**
 * "A caminho": itens de compra feitos e ainda não recebidos por inteiro.
 *
 * Fato e expectativa ficam separados: compra aprovada, enviada ou em trânsito
 * está a caminho; compra só solicitada (aguardaAprovacao) ainda não foi
 * autorizada e não garante entrega.
 *
 * A fonte é a mesma do "pedido aberto" do Estoque e do painel
 * (v_compras_prazo): só entra a quantidade que falta receber. O que já chegou
 * está no estoque e não aparece aqui, para não contar duas vezes.
 *
 * Previsão: a data informada na compra (data_prevista_entrega) vale como
 * prevista; sem ela, a view estima pelo prazo do insumo ou do fornecedor, e a
 * tela mostra essa data como "estimada", nunca como data combinada.
 */

type Numerico = number | string | null | undefined;

export type PrazoCompraDb = {
  pedido_id: number;
  item_id: number;
  insumo_id: number | null;
  status: string | null;
  qtd_restante: Numerico;
  prevista: string | null;
};

export type CompraACaminhoDb = {
  id: number;
  data_solicitacao: string | null;
  data_prevista_entrega: string | null;
  fornecedores?: { nome: string | null } | { nome: string | null }[] | null;
};

export type ItemCompraACaminhoDb = {
  id: number;
  pedido_id: number;
  quantidade: Numerico;
  quantidade_recebida: Numerico;
  quantidade_em: string | null;
  conteudo_embalagem: Numerico;
  lote_id: number | null;
};

export type PedidoInternoLigadoDb = {
  id: number;
  pedido_compra_id: number | null;
  instituicao_destino: string | null;
  modalidade_compra: string | null;
};

export type InsumoACaminhoDb = {
  id: number;
  especificacao: string | null;
  unidade: string | null;
};

export type ItemACaminho = {
  itemId: number;
  compraId: number;
  pedidoInternoId: number | null;
  insumoId: number | null;
  especificacao: string;
  fornecedor: string | null;
  caminho: string | null;
  situacao: string;
  /** compra ainda sem aprovação: pedido feito, não compra a caminho */
  aguardaAprovacao: boolean;
  solicitado: string;
  recebido: string;
  pendente: string;
  /** Quantidade pendente na unidade do estoque (a mesma do "pedido aberto"). */
  pendenteEstoque: number;
  previsao: string | null;
  previsaoInformada: boolean;
  /** Dias depois da previsão; null quando não passou ou não há previsão. */
  diasAtraso: number | null;
};

export const SITUACAO_COMPRA_A_CAMINHO: Record<string, string> = {
  solicitado: "Compra aguardando aprovação",
  aprovado: "Compra aprovada",
  enviado: "Enviada ao fornecedor",
  em_transito: "Em trânsito",
};

const MODALIDADE: Record<string, string> = {
  compra_direta: "Compra direta",
  fundacao: "Fundação",
  universidade: "Universidade",
  outra: "Outra instituição",
};

function num(valor: Numerico) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function primeira<T>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor ?? null;
}

/** Dias inteiros de `de` até `ate` (datas AAAA-MM-DD). */
export function diasEntre(de: string, ate: string) {
  const a = Date.UTC(Number(de.slice(0, 4)), Number(de.slice(5, 7)) - 1, Number(de.slice(8, 10)));
  const b = Date.UTC(Number(ate.slice(0, 4)), Number(ate.slice(5, 7)) - 1, Number(ate.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

export function montarACaminho({
  prazos,
  compras,
  itens,
  pedidosInternos,
  insumos,
  hojeIso,
}: {
  prazos: PrazoCompraDb[];
  compras: CompraACaminhoDb[];
  itens: ItemCompraACaminhoDb[];
  pedidosInternos: PedidoInternoLigadoDb[];
  insumos: InsumoACaminhoDb[];
  hojeIso: string;
}): ItemACaminho[] {
  const compraPorId = new Map(compras.map((c) => [c.id, c]));
  const itemPorId = new Map(itens.map((i) => [i.id, i]));
  const insumoPorId = new Map(insumos.map((i) => [i.id, i]));
  const internoPorCompra = new Map<number, PedidoInternoLigadoDb>();
  for (const p of [...pedidosInternos].sort((a, b) => a.id - b.id)) {
    if (p.pedido_compra_id != null && !internoPorCompra.has(p.pedido_compra_id)) internoPorCompra.set(p.pedido_compra_id, p);
  }

  const lista: ItemACaminho[] = [];
  for (const prazo of prazos) {
    const pendenteEstoque = num(prazo.qtd_restante);
    if (!(pendenteEstoque > 0)) continue;
    const item = itemPorId.get(prazo.item_id);
    const compra = compraPorId.get(prazo.pedido_id);
    const insumo = prazo.insumo_id != null ? insumoPorId.get(prazo.insumo_id) : undefined;
    const interno = internoPorCompra.get(prazo.pedido_id) ?? null;
    const unidade = insumo?.unidade ?? null;

    const solicitado = num(item?.quantidade);
    // mesma regra da view: item com lote e sem quantidade recebida conta como recebido
    const recebido = item?.quantidade_recebida != null
      ? num(item.quantidade_recebida)
      : item?.lote_id != null ? solicitado : 0;
    const pendenteItem = Math.max(solicitado - recebido, 0);
    const formato = { quantidade: solicitado, quantidade_em: item?.quantidade_em ?? null, conteudo_embalagem: num(item?.conteudo_embalagem) };

    const informada = compra?.data_prevista_entrega ?? null;
    const previsao = informada ?? prazo.prevista ?? null;
    const atraso = previsao ? diasEntre(previsao, hojeIso) : null;

    const caminho = interno?.instituicao_destino
      ? interno.instituicao_destino
      : interno?.modalidade_compra ? MODALIDADE[interno.modalidade_compra] ?? interno.modalidade_compra : null;

    lista.push({
      itemId: prazo.item_id,
      compraId: prazo.pedido_id,
      pedidoInternoId: interno?.id ?? null,
      insumoId: prazo.insumo_id,
      especificacao: insumo?.especificacao?.trim() || "Item sem insumo cadastrado",
      fornecedor: primeira(compra?.fornecedores)?.nome ?? null,
      caminho,
      situacao: SITUACAO_COMPRA_A_CAMINHO[prazo.status ?? ""] ?? (prazo.status ?? "—"),
      aguardaAprovacao: prazo.status === "solicitado",
      solicitado: item ? rotuloQuantidadeItem(formato, unidade, solicitado) : "—",
      recebido: item ? rotuloQuantidadeItem(formato, unidade, recebido) : "—",
      pendente: item ? rotuloQuantidadeItem(formato, unidade, pendenteItem) : "—",
      pendenteEstoque,
      previsao,
      previsaoInformada: Boolean(informada),
      diasAtraso: atraso != null && atraso > 0 ? atraso : null,
    });
  }

  return lista.sort((a, b) => {
    const atrasoA = a.diasAtraso ?? -1;
    const atrasoB = b.diasAtraso ?? -1;
    if (atrasoA !== atrasoB) return atrasoB - atrasoA;
    if (a.previsao !== b.previsao) {
      if (!a.previsao) return 1;
      if (!b.previsao) return -1;
      return a.previsao.localeCompare(b.previsao);
    }
    return a.compraId - b.compraId || a.itemId - b.itemId;
  });
}

export type ResumoACaminho = {
  /** itens de compra aprovada, enviada ou em trânsito */
  itens: number;
  compras: number;
  atrasados: number;
  semPrevisaoInformada: number;
  /** itens de compra ainda sem aprovação (não contam como a caminho) */
  aguardandoAprovacao: number;
};

export function resumirACaminho(lista: ItemACaminho[]): ResumoACaminho {
  const confirmados = lista.filter((i) => !i.aguardaAprovacao);
  return {
    itens: confirmados.length,
    compras: new Set(confirmados.map((i) => i.compraId)).size,
    atrasados: confirmados.filter((i) => i.diasAtraso != null).length,
    semPrevisaoInformada: confirmados.filter((i) => !i.previsaoInformada).length,
    aguardandoAprovacao: lista.length - confirmados.length,
  };
}

/** Lê tudo o que o quadro precisa. Sem a caixinha de compras, a RLS devolve vazio. */
export async function lerACaminho(supabase: SupabaseClient, hojeIso: string) {
  const prazos = await lerTudo<PrazoCompraDb>((de, ate) =>
    supabase
      .from("v_compras_prazo")
      .select("pedido_id, item_id, insumo_id, status, qtd_restante, prevista")
      .gt("qtd_restante", 0)
      .order("pedido_id")
      .order("item_id")
      .range(de, ate),
  );
  if (prazos.error) return { itens: [] as ItemACaminho[], erro: prazos.error.message };
  const compraIds = [...new Set(prazos.data.map((p) => p.pedido_id))];
  const itemIds = [...new Set(prazos.data.map((p) => p.item_id))];
  const insumoIds = [...new Set(prazos.data.map((p) => p.insumo_id).filter((id): id is number => id != null))];
  if (compraIds.length === 0) return { itens: [] as ItemACaminho[], erro: null };

  // listas grandes vão em blocos para não estourar o tamanho da URL
  const blocos = <T,>(ids: number[], ler: (ids: number[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) =>
    Promise.all(
      Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ler(ids.slice(i * 200, i * 200 + 200))),
    ).then((partes) => ({
      data: partes.flatMap((p) => p.data ?? []),
      error: partes.find((p) => p.error)?.error ?? null,
    }));

  const [compras, itens, internos, insumos] = await Promise.all([
    blocos<CompraACaminhoDb>(compraIds, (ids) =>
      supabase.from("pedidos_compra").select("id, data_solicitacao, data_prevista_entrega, fornecedores(nome)").in("id", ids),
    ),
    blocos<ItemCompraACaminhoDb>(itemIds, (ids) =>
      supabase
        .from("pedidos_compra_itens")
        .select("id, pedido_id, quantidade, quantidade_recebida, quantidade_em, conteudo_embalagem, lote_id")
        .in("id", ids),
    ),
    blocos<PedidoInternoLigadoDb>(compraIds, (ids) =>
      supabase
        .from("pedidos_internos")
        .select("id, pedido_compra_id, instituicao_destino, modalidade_compra")
        .neq("status", "cancelado")
        .in("pedido_compra_id", ids),
    ),
    insumoIds.length
      ? blocos<InsumoACaminhoDb>(insumoIds, (ids) => supabase.from("insumos").select("id, especificacao, unidade").in("id", ids))
      : Promise.resolve({ data: [] as InsumoACaminhoDb[], error: null }),
  ]);
  const erro = [compras, itens, internos, insumos].map((r) => r.error?.message).filter(Boolean).join("; ") || null;
  return {
    itens: montarACaminho({
      prazos: prazos.data,
      compras: compras.data,
      itens: itens.data,
      pedidosInternos: internos.data,
      insumos: insumos.data,
      hojeIso,
    }),
    erro,
  };
}
