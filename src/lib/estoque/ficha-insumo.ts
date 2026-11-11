import { loteVencido, somarReservasPorLote, validadeEfetiva } from "@/lib/estoque/baixa";
import { loteVenceEmBreve } from "@/lib/estoque/situacao-insumo";
import { etapaDoPedido, etapaEmAndamento, rotuloEtapa } from "@/lib/pedido/etapas";
import { pedidoInternoNumero } from "@/lib/pedido/status";
import type { ItemACaminho } from "@/lib/suprimentos/a-caminho";
import {
  montarEstoqueDisponivel,
  type AlertaDisponivelDb,
  type LinhaEstoqueDisponivel,
  type PrevisaoDisponivelDb,
  type SaldoDisponivelDb,
} from "@/lib/suprimentos/estoque-disponivel";

/**
 * Ficha do insumo (revisão de 11/11/2026, F5): tudo o que responde "como está
 * este insumo?" numa página só. Aqui fica a montagem, sem leitura de banco:
 * os números e a situação vêm da mesma regra do "Estoque disponível"
 * (montarEstoqueDisponivel), para o insumo nunca aparecer com rótulos
 * diferentes em telas diferentes.
 */

type Numerico = number | string | null | undefined;

const num = (valor: Numerico) => {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const numOuNulo = (valor: Numerico) => {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

export const ROTULO_STATUS_LOTE: Record<string, string> = {
  quarentena: "Quarentena",
  aceito: "Disponível",
  em_uso: "Em uso",
  bloqueado: "Bloqueado",
  consumido: "Esgotado",
  descartado: "Descartado",
};

const ROTULO_MOVIMENTO: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  ajuste: "Ajuste",
};

export type SaldoFichaDb = SaldoDisponivelDb & {
  em_quarentena?: Numerico;
  bloqueado?: Numerico;
};

export type PrevisaoFichaDb = PrevisaoDisponivelDb & {
  lead_time_dias?: Numerico;
  dias_cobertura?: Numerico;
};

export type LoteFichaDb = {
  id: number;
  codigo_lote: string | null;
  validade: string | null;
  validade_apos_abertura?: string | null;
  quantidade_atual: Numerico;
  status: string | null;
  fornecedor?: string | null;
  nota_fiscal?: string | null;
};

export type ReservaFichaDb = {
  lote_id: number | null;
  planejamento_id: number | null;
  quantidade: Numerico;
  quantidade_consumida: Numerico;
  status: string | null;
};

export type PlanoFichaDb = { id: number; nome: string | null };

export type ItemPedidoFichaDb = {
  id: number;
  pedido_interno_id: number | null;
  quantidade: Numerico;
  unidade: string | null;
  recebido_em: string | null;
};

export type PedidoFichaDb = {
  id: number;
  titulo: string | null;
  status: string | null;
  natureza?: string | null;
  aprovacao_area_em?: string | null;
  pedido_compra_id?: number | null;
};

export type AnaliseFichaDb = {
  codigo_analise: string | null;
  nome_etapa: string | null;
  nome_atividade: string | null;
  quantidade_por_amostra: Numerico;
  unidade: string | null;
};

export type MovimentoFichaDb = {
  id: number;
  data: string | null;
  tipo: string | null;
  quantidade: Numerico;
  motivo: string | null;
  lote_id: number | null;
};

export type LoteDaFicha = {
  id: number;
  codigo: string;
  /** a menor entre a validade do fabricante e a de depois de aberto */
  validade: string | null;
  validadeEstado: "vencido" | "vencendo" | null;
  quantidade: number;
  reservado: number;
  status: string;
  statusRotulo: string;
  fornecedor: string | null;
  notaFiscal: string | null;
};

export type ReservaDaFicha = {
  planejamentoId: number | null;
  plano: string;
  quantidade: number;
};

export type AndamentoDaFicha = {
  chave: string;
  origem: "pedido" | "compra";
  href: string;
  rotulo: string;
  /** etapa do pedido ou situação da compra, como aparece em Pedidos */
  situacao: string;
  quantidade: string;
  /** comprado ou autorizado; falso = ainda em aprovação ou cotação (não é "a caminho") */
  confirmado: boolean;
  previsao: string | null;
  previsaoInformada: boolean;
  diasAtraso: number | null;
};

export type AnaliseDaFicha = {
  chave: string;
  codigo: string;
  etapa: string;
  quantidade: number | null;
  unidade: string;
};

export type MovimentoDaFicha = {
  id: number;
  data: string | null;
  tipo: string;
  quantidade: number;
  motivo: string | null;
  loteId: number | null;
};

export type FichaInsumo = {
  /** números e situação pela regra do Estoque disponível; null = saldo não lido */
  estoque: LinhaEstoqueDisponivel | null;
  emQuarentena: number;
  bloqueado: number;
  /** prazo de compra usado na previsão, em dias; null = sem dado */
  prazoCompraDias: number | null;
  /** dias que o disponível cobre com o consumo médio; null = sem dado */
  coberturaDias: number | null;
  lotes: LoteDaFicha[];
  reservas: ReservaDaFicha[];
  andamento: AndamentoDaFicha[];
  analises: AnaliseDaFicha[];
  movimentos: MovimentoDaFicha[];
};

function quantidadeComUnidade(valor: number, unidade: string | null | undefined) {
  const texto = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(valor);
  return unidade ? `${texto} ${unidade}` : texto;
}

export function montarLotesDaFicha(
  lotes: readonly LoteFichaDb[],
  reservas: readonly ReservaFichaDb[],
  hoje: string,
  janelaVencimento: number,
): LoteDaFicha[] {
  // mesma soma das outras telas: só reserva ativa, descontado o que já foi consumido
  const reservadoPorLote = somarReservasPorLote(
    reservas.map((r) => ({
      lote_id: r.lote_id,
      quantidade: num(r.quantidade),
      quantidade_consumida: num(r.quantidade_consumida),
      status: r.status,
    })),
  );
  return lotes
    .filter((lote) => lote.status !== "consumido" && lote.status !== "descartado")
    .map((lote): LoteDaFicha => {
      const validade = validadeEfetiva(lote.validade, lote.validade_apos_abertura);
      const status = lote.status ?? "";
      return {
        id: lote.id,
        codigo: lote.codigo_lote?.trim() || `Lote #${lote.id}`,
        validade,
        validadeEstado: loteVencido(validade, hoje)
          ? "vencido"
          : loteVenceEmBreve(validade, hoje, janelaVencimento)
            ? "vencendo"
            : null,
        quantidade: num(lote.quantidade_atual),
        reservado: reservadoPorLote.get(lote.id) ?? 0,
        status,
        statusRotulo: ROTULO_STATUS_LOTE[status] ?? (status || "—"),
        fornecedor: lote.fornecedor?.trim() || null,
        notaFiscal: lote.nota_fiscal?.trim() || null,
      };
    })
    // FEFO: o que vence primeiro aparece primeiro; sem validade vai para o fim
    .sort((a, b) => {
      if (a.validade !== b.validade) {
        if (!a.validade) return 1;
        if (!b.validade) return -1;
        return a.validade.localeCompare(b.validade);
      }
      return a.id - b.id;
    });
}

export function montarReservasDaFicha(
  reservas: readonly ReservaFichaDb[],
  planos: readonly PlanoFichaDb[],
): ReservaDaFicha[] {
  const nomePorId = new Map(planos.map((p) => [p.id, p.nome?.trim() || null]));
  const porPlano = new Map<number | null, number>();
  for (const reserva of reservas) {
    if (reserva.status !== "reservado" && reserva.status !== "parcial") continue;
    const pendente = num(reserva.quantidade) - num(reserva.quantidade_consumida);
    if (!(pendente > 0)) continue;
    const id = reserva.planejamento_id ?? null;
    porPlano.set(id, (porPlano.get(id) ?? 0) + pendente);
  }
  return [...porPlano.entries()]
    .map(([planejamentoId, quantidade]): ReservaDaFicha => ({
      planejamentoId,
      plano:
        planejamentoId == null
          ? "Reserva sem plano"
          : (nomePorId.get(planejamentoId) ?? `Plano #${planejamentoId}`),
      quantidade,
    }))
    .sort((a, b) => a.plano.localeCompare(b.plano, "pt-BR") || (a.planejamentoId ?? 0) - (b.planejamentoId ?? 0));
}

/**
 * Pedidos e compras em andamento com este insumo, sem contar a mesma compra
 * duas vezes: o pedido que já virou compra formal aparece uma vez, como
 * pedido, com a previsão da compra. Compra formal sem pedido aparece como compra.
 */
export function montarAndamentoDaFicha({
  itens,
  pedidos,
  compras,
}: {
  itens: readonly ItemPedidoFichaDb[];
  pedidos: readonly PedidoFichaDb[];
  compras: readonly ItemACaminho[];
}): AndamentoDaFicha[] {
  const pedidoPorId = new Map(pedidos.map((p) => [p.id, p]));
  const compraPorPedido = new Map<number, ItemACaminho>();
  for (const compra of compras) {
    if (compra.pedidoInternoId != null && !compraPorPedido.has(compra.pedidoInternoId)) {
      compraPorPedido.set(compra.pedidoInternoId, compra);
    }
  }

  const linhas: AndamentoDaFicha[] = [];
  const pedidosListados = new Set<number>();
  for (const item of itens) {
    if (item.recebido_em || item.pedido_interno_id == null) continue;
    const pedido = pedidoPorId.get(item.pedido_interno_id);
    if (!pedido) continue;
    const etapa = etapaDoPedido(pedido);
    if (!etapaEmAndamento(etapa)) continue;
    const compra = compraPorPedido.get(pedido.id) ?? null;
    pedidosListados.add(pedido.id);
    linhas.push({
      chave: `pedido-${pedido.id}-${item.id}`,
      origem: "pedido",
      href: `/pedido/${pedido.id}`,
      rotulo: `Pedido ${pedidoInternoNumero(pedido.id)}${pedido.titulo?.trim() ? ` · ${pedido.titulo.trim()}` : ""}`,
      situacao: rotuloEtapa(etapa),
      quantidade: quantidadeComUnidade(num(item.quantidade), item.unidade),
      // compra fechada ou autorizada: etapas de compra e de pagamento
      confirmado: etapa === "compra" || etapa === "pagamento",
      previsao: compra?.previsao ?? null,
      previsaoInformada: compra?.previsaoInformada ?? false,
      diasAtraso: compra?.diasAtraso ?? null,
    });
  }

  for (const compra of compras) {
    if (compra.pedidoInternoId != null && pedidosListados.has(compra.pedidoInternoId)) continue;
    linhas.push({
      chave: `compra-${compra.compraId}-${compra.itemId}`,
      origem: "compra",
      href: `/compras/${compra.compraId}`,
      rotulo: `Compra #${compra.compraId}${compra.fornecedor ? ` · ${compra.fornecedor}` : ""}`,
      situacao: compra.situacao,
      quantidade: compra.pendente,
      confirmado: !compra.aguardaAprovacao,
      previsao: compra.previsao,
      previsaoInformada: compra.previsaoInformada,
      diasAtraso: compra.diasAtraso,
    });
  }

  // primeiro o que já é fato (comprado ou autorizado), depois o que espera decisão
  return linhas.sort((a, b) => {
    if (a.confirmado !== b.confirmado) return a.confirmado ? -1 : 1;
    if (a.previsao !== b.previsao) {
      if (!a.previsao) return 1;
      if (!b.previsao) return -1;
      return a.previsao.localeCompare(b.previsao);
    }
    return a.chave.localeCompare(b.chave, "pt-BR", { numeric: true });
  });
}

export function montarAnalisesDaFicha(analises: readonly AnaliseFichaDb[]): AnaliseDaFicha[] {
  return analises
    .filter((a) => a.codigo_analise)
    .map((a, indice): AnaliseDaFicha => ({
      chave: `${a.codigo_analise}-${a.nome_etapa ?? ""}-${a.nome_atividade ?? ""}-${indice}`,
      codigo: String(a.codigo_analise),
      etapa: [a.nome_etapa, a.nome_atividade].map((t) => t?.trim()).filter(Boolean).join(" · ") || "—",
      quantidade: numOuNulo(a.quantidade_por_amostra),
      unidade: a.unidade?.trim() ?? "",
    }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }) || a.etapa.localeCompare(b.etapa, "pt-BR"));
}

export function montarMovimentosDaFicha(movimentos: readonly MovimentoFichaDb[], limite = 8): MovimentoDaFicha[] {
  return [...movimentos]
    .sort((a, b) => (b.data ?? "").localeCompare(a.data ?? "") || b.id - a.id)
    .slice(0, limite)
    .map((m) => ({
      id: m.id,
      data: m.data,
      tipo: ROTULO_MOVIMENTO[m.tipo ?? ""] ?? (m.tipo ?? "—"),
      quantidade: num(m.quantidade),
      motivo: m.motivo?.trim() || null,
      loteId: m.lote_id,
    }));
}

export function montarFichaInsumo({
  saldo,
  previsao,
  alertas,
  lotes,
  reservas,
  planos,
  itensPedido,
  pedidos,
  compras,
  analises,
  movimentos,
  hoje,
  janelaVencimento,
}: {
  saldo: SaldoFichaDb | null;
  previsao: PrevisaoFichaDb | null;
  alertas: readonly AlertaDisponivelDb[];
  lotes: readonly LoteFichaDb[];
  reservas: readonly ReservaFichaDb[];
  planos: readonly PlanoFichaDb[];
  itensPedido: readonly ItemPedidoFichaDb[];
  pedidos: readonly PedidoFichaDb[];
  compras: readonly ItemACaminho[];
  analises: readonly AnaliseFichaDb[];
  movimentos: readonly MovimentoFichaDb[];
  hoje: string;
  janelaVencimento: number;
}): FichaInsumo {
  const estoque = saldo
    ? (montarEstoqueDisponivel({
        // insumo inativo também tem ficha: o saldo dele continua existindo
        saldo: [{ ...saldo, ativo: true }],
        previsao: previsao ? [previsao] : [],
        alertas,
        lotes: lotes.map((lote) => ({ ...lote, insumo_id: saldo.insumo_id })),
        hoje,
        janelaVencimento,
      })[0] ?? null)
    : null;
  return {
    estoque,
    emQuarentena: num(saldo?.em_quarentena),
    bloqueado: num(saldo?.bloqueado),
    prazoCompraDias: numOuNulo(previsao?.lead_time_dias),
    coberturaDias: numOuNulo(previsao?.dias_cobertura),
    lotes: montarLotesDaFicha(lotes, reservas, hoje, janelaVencimento),
    reservas: montarReservasDaFicha(reservas, planos),
    andamento: montarAndamentoDaFicha({ itens: itensPedido, pedidos, compras }),
    analises: montarAnalisesDaFicha(analises),
    movimentos: montarMovimentosDaFicha(movimentos),
  };
}
