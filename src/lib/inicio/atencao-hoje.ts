import type { LinhaAtencao } from "@/lib/cadastros/painel-decisao";
import { caminhoNotificacao, rotuloTipoNotificacao } from "@/lib/notifications/links";
import { SITUACAO_COMPRA_A_CAMINHO, diasEntre, type ItemACaminho } from "@/lib/suprimentos/a-caminho";

/**
 * Tabela "Precisa de atenção hoje" do Início (organização de 11/11/2026,
 * etapa 4). Junta, numa tabela só, as quatro listas que o Início tinha:
 * prioridade de compra (Estoque), validade, compras em andamento e avisos.
 * Regras puras: a tela só desenha o que sai daqui.
 */

export const ORIGENS_ATENCAO = ["Estoque", "Validade", "Compras", "Aviso"] as const;
export type OrigemAtencao = (typeof ORIGENS_ATENCAO)[number];

/** Do mais grave para o menos grave. */
export const GRAVIDADES_ATENCAO = ["urgente", "atencao", "andamento"] as const;
export type GravidadeAtencao = (typeof GRAVIDADES_ATENCAO)[number];

export const ROTULO_GRAVIDADE: Record<GravidadeAtencao, string> = {
  urgente: "Urgente",
  atencao: "Atenção",
  andamento: "Em andamento",
};

export type LinhaAtencaoHoje = {
  chave: string;
  origem: OrigemAtencao;
  item: string;
  /** o número ou a frase que explica a situação; fica embaixo do item */
  detalhe: string | null;
  situacao: string;
  gravidade: GravidadeAtencao;
  /** "hoje", uma data, "desde …" ou "—" quando não há prazo */
  prazo: string;
  acao: { rotulo: string; href: string };
};

/** Quantas linhas a tabela mostra antes do "Ver todos". */
export const LIMITE_ATENCAO_HOJE = 10;

export const SEM_PRAZO = "—";

function dataBr(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : null;
}

/** Alertas do painel que falam de lote e validade; os outros são de saldo e compra. */
const ALERTAS_DE_VALIDADE = new Set(["vencidos", "vencendo", "fora-de-ordem", "varios-abertos"]);

function acaoDoEstoque(href: string): LinhaAtencaoHoje["acao"] {
  if (href.startsWith("/estoque/lotes/")) return { rotulo: "Abrir o lote", href };
  if (href.startsWith("/cadastros/")) return { rotulo: "Completar o cadastro", href };
  return { rotulo: "Abrir a ficha", href };
}

/** Linhas urgentes e de atenção do painel de situação do estoque (as mesmas regras do painel). */
export function linhasDoEstoque(linhas: readonly LinhaAtencao[]): LinhaAtencaoHoje[] {
  return linhas.map((linha) => ({
    chave: `estoque-${linha.chave}`,
    origem: ALERTAS_DE_VALIDADE.has(linha.alerta) ? "Validade" : "Estoque",
    item: linha.titulo,
    detalhe: linha.detalhe || null,
    situacao: linha.quadro,
    gravidade: linha.tom === "vermelho" ? "urgente" : "atencao",
    prazo: linha.prazo ?? SEM_PRAZO,
    acao: acaoDoEstoque(linha.href),
  }));
}

export type SugestaoCompraInicio = { insumoId: number; titulo: string; meta: string };

/** Quem vê Compras sem ver Estoque não abre o painel: fica com a sugestão de compra da previsão. */
export function linhasDeSugestao(sugestoes: readonly SugestaoCompraInicio[]): LinhaAtencaoHoje[] {
  return sugestoes.map((s) => ({
    chave: `repor-${s.insumoId}`,
    origem: "Estoque",
    item: s.titulo,
    detalhe: s.meta || null,
    situacao: "Repor",
    gravidade: "atencao",
    prazo: SEM_PRAZO,
    acao: { rotulo: "Ver compras", href: "/compras" },
  }));
}

export type CompraInicio = {
  id: number;
  status: string;
  dataSolicitacao: string | null;
  projeto: string | null;
  fornecedor: string | null;
  /** previsão de entrega: a informada na compra ou, sem ela, a estimada pelo prazo */
  previsao: string | null;
  previsaoInformada: boolean;
  /** dias depois da previsão; null quando não passou ou não há previsão */
  diasAtraso: number | null;
};

export type PedidoCompraInicioDb = {
  id: number;
  status: string;
  data_solicitacao: string | null;
  data_prevista_entrega: string | null;
  projeto: string | null;
  fornecedores?: { nome: string | null } | { nome: string | null }[] | null;
};

/**
 * Junta cada compra aberta com o prazo dos itens que ainda faltam chegar (a
 * mesma leitura do quadro "A caminho"). A data informada na compra vale como
 * prevista; sem ela, vale a estimada pelo prazo do insumo ou do fornecedor.
 * `aCaminho` nulo = a leitura dos prazos falhou: só a data informada é usada.
 */
export function comprasDoInicio(
  pedidos: readonly PedidoCompraInicioDb[],
  aCaminho: readonly Pick<ItemACaminho, "compraId" | "previsao" | "diasAtraso">[] | null,
  hojeIso: string,
): CompraInicio[] {
  return pedidos.map((pedido) => {
    const informada = pedido.data_prevista_entrega?.slice(0, 10) ?? null;
    const itens = (aCaminho ?? []).filter((item) => item.compraId === pedido.id);
    const estimada = itens.map((item) => item.previsao).filter((d): d is string => Boolean(d)).sort()[0] ?? null;
    const atrasoDosItens = itens.reduce<number | null>(
      (maior, item) => (item.diasAtraso != null && item.diasAtraso > (maior ?? 0) ? item.diasAtraso : maior),
      null,
    );
    // sem a leitura dos itens, o atraso só pode ser afirmado pela data informada na compra
    const atrasoPelaData = informada && diasEntre(informada, hojeIso) > 0 ? diasEntre(informada, hojeIso) : null;
    const fornecedor = Array.isArray(pedido.fornecedores) ? pedido.fornecedores[0] : pedido.fornecedores;
    return {
      id: pedido.id,
      status: pedido.status,
      dataSolicitacao: pedido.data_solicitacao,
      projeto: pedido.projeto?.trim() || null,
      fornecedor: fornecedor?.nome?.trim() || null,
      previsao: informada ?? estimada,
      previsaoInformada: Boolean(informada),
      diasAtraso: aCaminho ? atrasoDosItens : atrasoPelaData,
    };
  });
}

/**
 * Compras abertas. "A caminho" é fato: compra só solicitada ainda espera
 * aprovação e nunca aparece como atrasada, porque ninguém a enviou.
 */
export function linhasDeCompras(compras: readonly CompraInicio[]): LinhaAtencaoHoje[] {
  return compras.map((compra) => {
    const atrasada = compra.status !== "solicitado" && compra.diasAtraso != null && compra.diasAtraso > 0;
    const previsao = dataBr(compra.previsao);
    const desde = dataBr(compra.dataSolicitacao);
    return {
      chave: `compra-${compra.id}`,
      origem: "Compras",
      item: `Compra #${compra.id}${compra.fornecedor ? `, ${compra.fornecedor}` : ""}`,
      detalhe:
        [atrasada ? `${compra.diasAtraso} dia(s) de atraso` : null, compra.projeto].filter(Boolean).join(" · ") || null,
      situacao: atrasada ? "Entrega atrasada" : (SITUACAO_COMPRA_A_CAMINHO[compra.status] ?? compra.status),
      gravidade: atrasada ? "urgente" : "andamento",
      prazo:
        previsao && compra.status !== "solicitado"
          ? compra.previsaoInformada
            ? previsao
            : `${previsao} (estimada)`
          : desde
            ? `desde ${desde}`
            : SEM_PRAZO,
      acao: { rotulo: "Abrir a compra", href: `/compras/${compra.id}` },
    };
  });
}

export type AvisoInicio = {
  id: number;
  tipo: string;
  titulo: string;
  corpo: string | null;
  entidadeTipo: string | null;
  entidadeId: number | null;
  criadoEm: string | null;
};

const ACAO_DO_AVISO: Record<string, string> = {
  planejamento: "Abrir o plano",
  pedido_compra: "Abrir a compra",
  pedido_interno: "Abrir o pedido",
  disputa_reserva: "Abrir a disputa",
  incidente: "Abrir o incidente",
  lote: "Abrir o lote",
  insumo: "Abrir a ficha",
  demanda: "Abrir a demanda",
  proposta_final: "Abrir a proposta",
  orcamento: "Abrir o orçamento",
};

/** Avisos ainda não lidos de quem está logado. Sem tela ligada, o aviso abre em Notificações. */
export function linhasDeAvisos(avisos: readonly AvisoInicio[]): LinhaAtencaoHoje[] {
  return avisos.map((aviso) => {
    const destino = caminhoNotificacao(aviso.entidadeTipo, aviso.entidadeId);
    const rotulo = aviso.entidadeTipo ? ACAO_DO_AVISO[aviso.entidadeTipo] : undefined;
    const desde = dataBr(aviso.criadoEm);
    return {
      chave: `aviso-${aviso.id}`,
      origem: "Aviso",
      item: aviso.titulo,
      detalhe: aviso.corpo,
      situacao: rotuloTipoNotificacao(aviso.tipo),
      gravidade: "atencao",
      prazo: desde ? `desde ${desde}` : SEM_PRAZO,
      acao: destino && destino !== "/" && rotulo ? { rotulo, href: destino } : { rotulo: "Ver o aviso", href: "/notificacoes" },
    };
  });
}

/**
 * Ordem da tabela: do mais grave para o menos grave. Com a mesma gravidade,
 * as origens se alternam (Estoque, Validade, Compras, Aviso), cada uma na
 * ordem em que veio: assim uma origem com muitos itens não esconde as outras
 * nas primeiras linhas.
 */
export function ordenarAtencaoHoje(linhas: readonly LinhaAtencaoHoje[]): LinhaAtencaoHoje[] {
  const ordenadas: LinhaAtencaoHoje[] = [];
  for (const gravidade of GRAVIDADES_ATENCAO) {
    const filas = ORIGENS_ATENCAO.map((origem) => linhas.filter((l) => l.gravidade === gravidade && l.origem === origem));
    const maior = Math.max(0, ...filas.map((fila) => fila.length));
    for (let i = 0; i < maior; i += 1) {
      for (const fila of filas) {
        if (fila[i]) ordenadas.push(fila[i]);
      }
    }
  }
  return ordenadas;
}

/** Quantas linhas cada origem tem (para os botões de filtro). */
export function contarPorOrigem(linhas: readonly LinhaAtencaoHoje[]): Record<OrigemAtencao, number> {
  const contagem: Record<OrigemAtencao, number> = { Estoque: 0, Validade: 0, Compras: 0, Aviso: 0 };
  for (const linha of linhas) contagem[linha.origem] += 1;
  return contagem;
}

export type FiltroOrigemAtencao = "todas" | OrigemAtencao;

export function filtrarPorOrigem(linhas: readonly LinhaAtencaoHoje[], filtro: FiltroOrigemAtencao): LinhaAtencaoHoje[] {
  return filtro === "todas" ? [...linhas] : linhas.filter((linha) => linha.origem === filtro);
}
