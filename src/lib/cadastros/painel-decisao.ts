/**
 * Painel de insumos para decidir: junta ao saldo/mínimo de cada insumo a
 * previsão de compra (v_previsao_suprimentos), o valor em estoque
 * (v_custo_estoque_vigente) e os lotes vencendo (v_alertas_estoque).
 *
 * A lista completa de insumos fica em Cadastros → Insumos; aqui só entra o que
 * pede ação, com o motivo.
 *
 * Regras (as mesmas do Estoque):
 * - Precisa comprar = qtd_sugerida_compra > 0 (o "Repor" do Estoque).
 * - Acaba antes de chegar = dias de cobertura menores que o prazo de entrega
 *   (lead time) e nada pedido em aberto.
 * - Cobertura = disponível ÷ consumo médio diário da janela da previsão.
 */
import { ehCritico, type InsumoPainel } from "@/lib/cadastros/painel-insumos";
import { hrefFichaInsumo } from "@/lib/estoque/ficha-insumo-rota";

type Numerico = number | string | null | undefined;

export type PrevisaoPainelDb = {
  insumo_id: Numerico;
  qtd_sugerida_compra?: Numerico;
  qtd_pedida_aberta?: Numerico;
  /** parte do pedido aberto que ainda espera aprovação (0132) */
  qtd_pedida_pendente?: Numerico;
  qtd_compra_atrasada?: Numerico;
  compra_atrasada_desde?: string | null;
  consumo_medio_diario?: Numerico;
  dias_cobertura?: Numerico;
  lead_time_dias?: Numerico;
};

export type CustoPainelDb = { insumo_id: Numerico; valor_liberado?: Numerico };

export type AlertaPainelDb = {
  tipo: string | null;
  insumo_id: Numerico;
  lote_id?: Numerico;
  especificacao?: string | null;
  validade?: string | null;
  valor?: Numerico;
};

export type Motivo = "em_falta" | "compra_atrasada" | "acaba_antes" | "abaixo_minimo" | "comprar" | "vencido" | "vencendo";

export const META_MOTIVO: Record<Motivo, { rotulo: string; ordem: number; tom: "vermelho" | "ambar" | "azul" }> = {
  em_falta: { rotulo: "Sem estoque", ordem: 0, tom: "vermelho" },
  compra_atrasada: { rotulo: "Compra atrasada", ordem: 1, tom: "vermelho" },
  acaba_antes: { rotulo: "Risco de falta sem pedido aberto", ordem: 2, tom: "vermelho" },
  vencido: { rotulo: "Lote vencido", ordem: 3, tom: "vermelho" },
  abaixo_minimo: { rotulo: "Abaixo do mínimo", ordem: 4, tom: "ambar" },
  comprar: { rotulo: "Repor", ordem: 5, tom: "ambar" },
  vencendo: { rotulo: "Lote vence em breve", ordem: 6, tom: "azul" },
};

export type InsumoDecisao = InsumoPainel & {
  sugestaoCompra: number;
  /** null = a previsão não comprovou a quantidade em aberto. */
  pedidoAberto: number | null;
  /** Parte do pedido aberto que ainda espera aprovação: não é compra feita. */
  pedidoAguardandoAprovacao: number;
  compraAtrasada: boolean;
  consumoDiario: number;
  /** null = sem dados suficientes para estimar. */
  coberturaDias: number | null;
  prazoDias: number;
  valorEstoque: number;
  lotesVencidos: number;
  lotesVencendo: number;
  motivos: Motivo[];
};

export type LoteVencendo = {
  loteId: number | null;
  insumoId: number;
  especificacao: string;
  validade: string;
  quantidade: number;
  vencido: boolean;
};

function numero(valor: Numerico): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function numeroOuNulo(valor: Numerico): number | null {
  if (valor == null || (typeof valor === "string" && !valor.trim())) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function zeroNoSistema(item: InsumoPainel): boolean {
  return item.estadoSaldo === "saldo_sistema" && item.disponivel === 0;
}

export function motivosDoInsumo(item: Omit<InsumoDecisao, "motivos">): Motivo[] {
  const motivos: Motivo[] = [];
  // saldo não lido: não se inventa falta nem cobertura
  const saldoConhecido = item.estadoSaldo === "saldo_sistema";
  if (saldoConhecido && item.situacao === "em_falta") motivos.push("em_falta");
  if (item.compraAtrasada) motivos.push("compra_atrasada");
  if (
    saldoConhecido &&
    !zeroNoSistema(item) &&
    item.coberturaDias !== null &&
    item.prazoDias > 0 &&
    item.coberturaDias < item.prazoDias &&
    item.pedidoAberto === 0
  ) {
    motivos.push("acaba_antes");
  }
  if (item.lotesVencidos > 0) motivos.push("vencido");
  if (saldoConhecido && item.situacao === "abaixo_minimo") motivos.push("abaixo_minimo");
  if (saldoConhecido && item.sugestaoCompra > 0) motivos.push("comprar");
  if (item.lotesVencendo > 0) motivos.push("vencendo");
  return motivos;
}

/** Junta previsão, valor e validade a cada insumo do painel. */
export function montarDecisao(
  itens: readonly InsumoPainel[],
  previsoes: readonly PrevisaoPainelDb[],
  custos: readonly CustoPainelDb[],
  alertas: readonly AlertaPainelDb[],
  { previsoesCompletas = true }: { previsoesCompletas?: boolean } = {},
): { insumos: InsumoDecisao[]; lotes: LoteVencendo[] } {
  const previsaoPor = new Map(previsoes.map((p) => [numero(p.insumo_id), p]));
  const valorPor = new Map(custos.map((c) => [numero(c.insumo_id), numero(c.valor_liberado)]));
  const ativos = new Map(itens.map((i) => [i.id, i]));
  const lotes: LoteVencendo[] = [];
  const contagem = new Map<number, { vencidos: number; vencendo: number }>();
  for (const alerta of alertas) {
    if (alerta.tipo !== "vencido" && alerta.tipo !== "vencimento") continue;
    const insumoId = numero(alerta.insumo_id);
    const insumo = ativos.get(insumoId);
    if (!insumo || !alerta.validade) continue;
    const vencido = alerta.tipo === "vencido";
    const conta = contagem.get(insumoId) ?? { vencidos: 0, vencendo: 0 };
    if (vencido) conta.vencidos += 1;
    else conta.vencendo += 1;
    contagem.set(insumoId, conta);
    lotes.push({
      loteId: numeroOuNulo(alerta.lote_id),
      insumoId,
      especificacao: insumo.especificacao,
      validade: alerta.validade.slice(0, 10),
      quantidade: numero(alerta.valor),
      vencido,
    });
  }
  lotes.sort((a, b) => a.validade.localeCompare(b.validade) || a.especificacao.localeCompare(b.especificacao, "pt-BR"));

  const insumos = itens.map((item) => {
    const leitura = previsaoPor.get(item.id);
    const p = previsoesCompletas ? leitura : undefined;
    const conta = contagem.get(item.id) ?? { vencidos: 0, vencendo: 0 };
    const consumoDiario = numero(p?.consumo_medio_diario);
    const pedidoAberto = numeroOuNulo(p?.qtd_pedida_aberta);
    const pedidoValido = pedidoAberto !== null && pedidoAberto >= 0 ? pedidoAberto : null;
    const base = {
      ...item,
      sugestaoCompra: item.estadoSaldo === "saldo_sistema" ? numero(p?.qtd_sugerida_compra) : 0,
      pedidoAberto: pedidoValido,
      pedidoAguardandoAprovacao:
        pedidoValido === null ? 0 : Math.min(Math.max(numero(p?.qtd_pedida_pendente), 0), pedidoValido),
      compraAtrasada: numero(leitura?.qtd_compra_atrasada) > 0 || Boolean(leitura?.compra_atrasada_desde),
      consumoDiario,
      coberturaDias:
        item.estadoSaldo !== "saldo_sistema" || item.disponivel === null || !(consumoDiario > 0)
          ? null
          : numeroOuNulo(p?.dias_cobertura) ?? item.disponivel / consumoDiario,
      prazoDias: numero(p?.lead_time_dias),
      valorEstoque: valorPor.get(item.id) ?? 0,
      lotesVencidos: conta.vencidos,
      lotesVencendo: conta.vencendo,
    };
    return { ...base, motivos: motivosDoInsumo(base) };
  });
  return { insumos, lotes };
}

/** Itens que pedem ação, do mais urgente para o menos; `motivo` filtra. */
export function filaDeAcao(itens: readonly InsumoDecisao[], motivo?: Motivo | ""): InsumoDecisao[] {
  return itens
    .filter((item) => (motivo ? item.motivos.includes(motivo) : item.motivos.length > 0))
    .sort((a, b) => {
      const pa = META_MOTIVO[a.motivos[0]].ordem;
      const pb = META_MOTIVO[b.motivos[0]].ordem;
      if (pa !== pb) return pa - pb;
      // mesmo motivo principal: menos cobertura primeiro, depois mais motivos
      const ca = a.coberturaDias ?? Number.POSITIVE_INFINITY;
      const cb = b.coberturaDias ?? Number.POSITIVE_INFINITY;
      if (ca !== cb) return ca - cb;
      return b.motivos.length - a.motivos.length || a.especificacao.localeCompare(b.especificacao, "pt-BR");
    });
}

export type ResumoDecisao = {
  insumos: number;
  valorEstoque: number;
  comprar: number;
  critico: number;
  emFalta: number;
  abaixoMinimo: number;
  acabaAntes: number;
  compraAtrasada: number;
  aCaminho: number;
  lotesVencidos: number;
  lotesVencendo: number;
  semMinimo: number;
  naoConferido: number;
  saldoIndisponivel: number;
};

export function resumirDecisao(itens: readonly InsumoDecisao[]): ResumoDecisao {
  const conta = (teste: (item: InsumoDecisao) => boolean) => itens.filter(teste).length;
  return {
    insumos: itens.length,
    valorEstoque: itens.reduce((soma, item) => soma + item.valorEstoque, 0),
    comprar: conta((i) => i.motivos.includes("comprar")),
    critico: conta((i) => ehCritico(i.situacao)),
    emFalta: conta((i) => i.motivos.includes("em_falta")),
    abaixoMinimo: conta((i) => i.situacao === "abaixo_minimo"),
    acabaAntes: conta((i) => i.motivos.includes("acaba_antes")),
    compraAtrasada: conta((i) => i.compraAtrasada),
    // a caminho é fato: só o que já foi comprado ou autorizado
    aCaminho: conta((i) => (i.pedidoAberto ?? 0) - i.pedidoAguardandoAprovacao > 0),
    lotesVencidos: itens.reduce((soma, i) => soma + i.lotesVencidos, 0),
    lotesVencendo: itens.reduce((soma, i) => soma + i.lotesVencendo, 0),
    semMinimo: conta((i) => i.situacao === "sem_minimo"),
    naoConferido: conta((i) => i.estadoSaldo === "nao_conferido"),
    saldoIndisponivel: conta((i) => i.estadoSaldo === "saldo_indisponivel"),
  };
}

export type FaixaCobertura = { faixa: string; insumos: number; tom: "vermelho" | "ambar" | "verde" | "cinza" };

/** Quantos insumos duram quanto tempo, no consumo atual. */
export function faixasCobertura(itens: readonly InsumoDecisao[]): FaixaCobertura[] {
  const faixas: FaixaCobertura[] = [
    { faixa: "Sem estoque", insumos: 0, tom: "ambar" },
    { faixa: "< 15 dias", insumos: 0, tom: "vermelho" },
    { faixa: "15–30 dias", insumos: 0, tom: "ambar" },
    { faixa: "30–90 dias", insumos: 0, tom: "verde" },
    { faixa: "> 90 dias", insumos: 0, tom: "verde" },
    { faixa: "Sem estimativa", insumos: 0, tom: "cinza" },
  ];
  for (const item of itens) {
    if (item.disponivel === null) continue;
    if (item.disponivel <= 0) faixas[0].insumos += 1;
    else if (item.coberturaDias === null) faixas[5].insumos += 1;
    else if (item.coberturaDias < 15) faixas[1].insumos += 1;
    else if (item.coberturaDias < 30) faixas[2].insumos += 1;
    else if (item.coberturaDias < 90) faixas[3].insumos += 1;
    else faixas[4].insumos += 1;
  }
  return faixas;
}

export type ValorCategoria = { categoria: string; valor: number };

/** Onde está o dinheiro parado: valor em estoque por categoria (as maiores). */
export function valorPorCategoria(
  itens: readonly InsumoDecisao[],
  campo: "categoriaCurta" | "categoriaCompra",
  limite = 8,
): ValorCategoria[] {
  const mapa = new Map<string, number>();
  for (const item of itens) {
    if (!(item.valorEstoque > 0)) continue;
    mapa.set(item[campo], (mapa.get(item[campo]) ?? 0) + item.valorEstoque);
  }
  return [...mapa.entries()]
    .map(([categoria, valor]) => ({ categoria, valor }))
    .sort((a, b) => b.valor - a.valor || a.categoria.localeCompare(b.categoria, "pt-BR"))
    .slice(0, limite);
}

export type MaisUsado = { id: number; especificacao: string; saidas: number };

/** Insumos com mais registros de saída na janela (giro). */
export function maisUsados(
  itens: readonly InsumoDecisao[],
  movimentos: readonly { insumo_id: Numerico; tipo: string | null }[],
  limite = 8,
): MaisUsado[] {
  const ids = new Map(itens.map((i) => [i.id, i]));
  const saidas = new Map<number, number>();
  for (const mov of movimentos) {
    if (mov.tipo !== "saida") continue;
    const id = numero(mov.insumo_id);
    if (!ids.has(id)) continue;
    saidas.set(id, (saidas.get(id) ?? 0) + 1);
  }
  return [...saidas.entries()]
    .map(([id, total]) => ({ id, especificacao: ids.get(id)!.especificacao, saidas: total }))
    .sort((a, b) => b.saidas - a.saidas || a.especificacao.localeCompare(b.especificacao, "pt-BR"))
    .slice(0, limite);
}

// ── Painel de alertas ─────────────────────────────────────────────────────

export type LotePainelDb = {
  id: Numerico;
  insumo_id: Numerico;
  codigo_lote?: string | null;
  status: string | null;
  quantidade_atual?: Numerico;
  validade?: string | null;
  validade_apos_abertura?: string | null;
  data_abertura?: string | null;
  data_recebimento?: string | null;
  criado_em?: string | null;
};

export type TomAlerta = "vermelho" | "ambar" | "azul" | "cinza";

export type ItemAlerta = {
  chave: string;
  titulo: string;
  detalhe: string;
  href: string;
  /** até quando: "hoje", uma data ou "em N dia(s)"; vazio quando o alerta não tem prazo */
  prazo?: string;
};

export type Alerta = {
  chave: string;
  titulo: string;
  /** uma frase: o que o alerta quer dizer e o que fazer */
  descricao: string;
  tom: TomAlerta;
  itens: ItemAlerta[];
  /** onde resolver, quando é outra tela (repor fica no botão do topo da Situação: D6) */
  acao?: { rotulo: string; href: string };
};

const ORDEM_TOM: Record<TomAlerta, number> = { vermelho: 0, ambar: 1, azul: 2, cinza: 3 };

export type ResumoAlertas = {
  /** itens nos quadros vermelhos: pedem ação agora */
  urgentes: number;
  /** itens nos quadros âmbar */
  atencao: number;
  /** nomes dos quadros urgentes e de atenção com item, do mais grave para o menos */
  quadros: string[];
};

/**
 * Contagem do painel único que as outras telas mostram (D1 da revisão de
 * 11/11). Conta itens de quadro: o mesmo insumo pode estar em dois quadros.
 */
export function resumirAlertas(alertas: readonly Alerta[]): ResumoAlertas {
  const soma = (tons: TomAlerta[]) =>
    alertas.filter((a) => tons.includes(a.tom)).reduce((total, a) => total + a.itens.length, 0);
  return {
    urgentes: soma(["vermelho"]),
    atencao: soma(["ambar"]),
    quadros: [...alertas]
      .filter((a) => (a.tom === "vermelho" || a.tom === "ambar") && a.itens.length > 0)
      .sort((x, y) => ORDEM_TOM[x.tom] - ORDEM_TOM[y.tom])
      .map((a) => a.titulo),
  };
}

/** Texto curto da contagem, igual em todas as telas que a mostram. */
export function textoResumoAlertas(resumo: ResumoAlertas | null): string {
  if (!resumo) return "sem dado";
  if (resumo.urgentes === 0 && resumo.atencao === 0) return "nada urgente";
  return [
    resumo.urgentes > 0 ? `${resumo.urgentes} urgente${resumo.urgentes === 1 ? "" : "s"}` : null,
    resumo.atencao > 0 ? `${resumo.atencao} de atenção` : null,
  ].filter(Boolean).join(" · ");
}

export type LinhaAtencao = {
  chave: string;
  tom: "vermelho" | "ambar";
  /** chave do alerta do painel ("em-falta", "vencendo"…) */
  alerta: string;
  /** nome do quadro do painel de onde a linha veio */
  quadro: string;
  titulo: string;
  detalhe: string;
  href: string;
  /** até quando, do jeito que o painel calcula; null quando o alerta não tem prazo */
  prazo: string | null;
};

/**
 * Primeiras linhas urgentes e de atenção do painel, na ordem do painel, para
 * a lista "Precisa de atenção hoje" do Início: as mesmas regras, os mesmos
 * nomes e o mesmo destino de cada item.
 */
export function linhasDeAtencao(alertas: readonly Alerta[]): LinhaAtencao[] {
  return [...alertas]
    .map((alerta, ordem) => ({ alerta, ordem }))
    .filter(({ alerta }) => alerta.tom === "vermelho" || alerta.tom === "ambar")
    .sort((x, y) => ORDEM_TOM[x.alerta.tom] - ORDEM_TOM[y.alerta.tom] || x.ordem - y.ordem)
    .flatMap(({ alerta }) =>
      alerta.itens.map((item) => ({
        chave: `${alerta.chave}-${item.chave}`,
        tom: alerta.tom as "vermelho" | "ambar",
        alerta: alerta.chave,
        quadro: alerta.titulo,
        titulo: item.titulo,
        detalhe: item.detalhe,
        href: item.href,
        prazo: item.prazo ?? null,
      })),
    );
}

function dataBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

/** Validade que vale para o lote: a menor entre a do fabricante e a de depois de aberto. */
export function validadeDoLote(lote: Pick<LotePainelDb, "validade" | "validade_apos_abertura">): string | null {
  const datas = [lote.validade, lote.validade_apos_abertura].filter((d): d is string => Boolean(d)).map((d) => d.slice(0, 10));
  return datas.length ? datas.sort()[0] : null;
}

function loteAberto(lote: LotePainelDb): boolean {
  return lote.status === "em_uso" || Boolean(lote.data_abertura);
}

function comSaldo(lote: LotePainelDb): boolean {
  return numero(lote.quantidade_atual) > 0 && lote.status !== "consumido" && lote.status !== "descartado";
}

function nomeLote(lote: LotePainelDb): string {
  return lote.codigo_lote ? `lote ${lote.codigo_lote}` : `lote #${numero(lote.id)}`;
}

/**
 * Lote aberto fora da ordem de validade (FEFO: o que vence primeiro sai
 * primeiro): há outro lote do mesmo insumo, ainda fechado e não vencido, que
 * vence antes do que foi aberto.
 */
export function abertosForaDeOrdem(lotes: readonly LotePainelDb[], hojeIso: string) {
  const porInsumo = new Map<number, LotePainelDb[]>();
  for (const lote of lotes) {
    if (!comSaldo(lote)) continue;
    const id = numero(lote.insumo_id);
    porInsumo.set(id, [...(porInsumo.get(id) ?? []), lote]);
  }
  const achados: { insumoId: number; aberto: LotePainelDb; antes: LotePainelDb }[] = [];
  for (const [insumoId, doInsumo] of porInsumo) {
    const fechados = doInsumo
      .filter((l) => !loteAberto(l) && l.status === "aceito")
      .map((l) => ({ lote: l, validade: validadeDoLote(l) }))
      .filter((l): l is { lote: LotePainelDb; validade: string } => l.validade !== null && l.validade >= hojeIso);
    for (const aberto of doInsumo.filter(loteAberto)) {
      const validadeAberto = aberto.validade?.slice(0, 10) ?? null;
      if (!validadeAberto) continue;
      const antes = fechados.filter((f) => f.validade < validadeAberto).sort((a, b) => a.validade.localeCompare(b.validade))[0];
      if (antes) achados.push({ insumoId, aberto, antes: antes.lote });
    }
  }
  return achados;
}

/** Itens com saldo em mãos e nenhuma saída em 12 meses (nem entrada nos últimos 90 dias). */
export function estoqueParado(
  itens: readonly InsumoDecisao[],
  movimentos: readonly { insumo_id: Numerico; tipo: string | null; data: string | null }[],
  hojeIso: string,
): InsumoDecisao[] {
  const inicio90 = new Date(`${hojeIso.slice(0, 10)}T00:00:00Z`);
  inicio90.setUTCDate(inicio90.getUTCDate() - 90);
  const corte = inicio90.toISOString().slice(0, 10);
  const comSaida = new Set<number>();
  const entradaRecente = new Set<number>();
  for (const mov of movimentos) {
    const id = numero(mov.insumo_id);
    if (mov.tipo === "saida") comSaida.add(id);
    else if (mov.tipo === "entrada" && String(mov.data ?? "").slice(0, 10) >= corte) entradaRecente.add(id);
  }
  return itens
    .filter((i) => i.estadoSaldo === "saldo_sistema" && Math.max(i.emMaos ?? 0, i.disponivel ?? 0) > 0 && !comSaida.has(i.id) && !entradaRecente.has(i.id))
    .sort((a, b) => b.valorEstoque - a.valorEstoque || a.especificacao.localeCompare(b.especificacao, "pt-BR"));
}

/**
 * Todos os alertas do painel, cada um com os itens que o disparam. Os que
 * têm itens vêm primeiro, pela gravidade; os vazios ficam no fim ("tudo
 * certo").
 */
export function montarAlertas({
  itens,
  lotesVencendo,
  lotes,
  movimentos,
  movimentosCompletos = false,
  hojeIso,
}: {
  itens: readonly InsumoDecisao[];
  lotesVencendo: readonly LoteVencendo[];
  lotes: readonly LotePainelDb[];
  movimentos: readonly { insumo_id: Numerico; tipo: string | null; data: string | null }[];
  /** true só quando toda a janela de movimentos foi lida com sucesso. */
  movimentosCompletos?: boolean;
  hojeIso: string;
}): Alerta[] {
  const ids = new Map(itens.map((i) => [i.id, i]));
  const doRecorte = lotes.filter((l) => ids.has(numero(l.insumo_id)));
  const nome = (insumoId: number) => ids.get(insumoId)?.especificacao ?? `Insumo ${insumoId}`;
  // F5: alerta de estoque abre a ficha do insumo; o que falta preencher abre o cadastro
  const fichaInsumo = (id: number) => hrefFichaInsumo(id) ?? "/estoque";
  const cadastroInsumo = (id: number) => `/cadastros/insumos?focus=${id}`;
  const fichaLote = (id: Numerico) => `/estoque/lotes/${numero(id)}`;
  const saldo = (i: InsumoDecisao) => i.disponivel !== null
    ? `${formatar(i.disponivel)} ${i.unidade}`.trim()
    : i.estadoSaldo === "nao_conferido" ? "Sem dado de saldo nesta leitura" : "saldo indisponível";
  const pedido = (i: InsumoDecisao) => i.pedidoAberto === null
    ? "previsão indisponível"
    : i.pedidoAberto > 0
      ? [
          i.pedidoAberto - i.pedidoAguardandoAprovacao > 0
            ? `${formatar(i.pedidoAberto - i.pedidoAguardandoAprovacao)} a caminho`
            : null,
          i.pedidoAguardandoAprovacao > 0 ? `${formatar(i.pedidoAguardandoAprovacao)} aguardando aprovação` : null,
        ].filter(Boolean).join(" · ")
      : "nada pedido";
  const porCobertura = (a: InsumoDecisao, b: InsumoDecisao) =>
    (a.coberturaDias ?? Number.POSITIVE_INFINITY) - (b.coberturaDias ?? Number.POSITIVE_INFINITY) ||
    a.especificacao.localeCompare(b.especificacao, "pt-BR");

  const emFalta = itens.filter((i) => i.motivos.includes("em_falta")).sort(porCobertura);
  const abaixo = itens.filter((i) => i.situacao === "abaixo_minimo").sort(porCobertura);
  const acaba = itens.filter((i) => i.motivos.includes("acaba_antes")).sort(porCobertura);
  const atrasadas = itens.filter((i) => i.compraAtrasada);
  const repor = itens.filter((i) => i.motivos.includes("comprar") && !zeroNoSistema(i) && i.situacao !== "abaixo_minimo");
  const vencidos = lotesVencendo.filter((l) => l.vencido);
  const vencendo = lotesVencendo.filter((l) => !l.vencido);
  const foraDeOrdem = abertosForaDeOrdem(doRecorte, hojeIso);
  const abertosPorInsumo = new Map<number, LotePainelDb[]>();
  for (const lote of doRecorte.filter((l) => comSaldo(l) && loteAberto(l))) {
    const id = numero(lote.insumo_id);
    abertosPorInsumo.set(id, [...(abertosPorInsumo.get(id) ?? []), lote]);
  }
  const variosAbertos = [...abertosPorInsumo.entries()].filter(([, abertos]) => abertos.length > 1);
  const quarentena = doRecorte.filter((l) => l.status === "quarentena" && numero(l.quantidade_atual) > 0);
  const bloqueados = doRecorte.filter((l) => l.status === "bloqueado" && numero(l.quantidade_atual) > 0);
  const semValidade = doRecorte.filter((l) => comSaldo(l) && l.status !== "quarentena" && !validadeDoLote(l));
  const parados = movimentosCompletos ? estoqueParado(itens, movimentos, hojeIso) : [];
  const semMinimo = itens.filter((i) => i.situacao === "sem_minimo");
  const indisponivel = itens.filter((i) => i.estadoSaldo === "saldo_indisponivel");
  const naoConferidos = itens.filter((i) => i.estadoSaldo === "nao_conferido");

  const alertas: Alerta[] = [
    {
      chave: "saldo-indisponivel",
      titulo: "Saldo indisponível",
      descricao: "Não foi possível ler o saldo destes insumos; os outros alertas deles podem estar incompletos.",
      tom: "ambar",
      itens: indisponivel.map((i) => ({ chave: `i${i.id}`, titulo: i.especificacao, detalhe: "recarregue a página", href: fichaInsumo(i.id) })),
    },
    {
      chave: "saldo-nao-conferido",
      titulo: "Saldo não conferido",
      descricao: "Sem dado de saldo nesta leitura. Confira antes de decidir.",
      tom: "ambar",
      itens: naoConferidos.map((i) => ({ chave: `i${i.id}`, titulo: i.especificacao, detalhe: saldo(i), href: fichaInsumo(i.id) })),
    },
    {
      chave: "em-falta",
      titulo: "Sem estoque",
      descricao: "O sistema registra zero disponível. Confira o estoque antes de decidir.",
      tom: "vermelho",
      itens: emFalta.map((i) => ({
        chave: `i${i.id}`,
        titulo: i.especificacao,
        detalhe: `mínimo ${formatar(i.minimo)} · ${pedido(i)}`,
        href: fichaInsumo(i.id),
        prazo: "hoje",
      })),
    },
    {
      chave: "acaba-antes",
      titulo: "Risco de falta sem pedido aberto",
      descricao: "A cobertura estimada é menor que o prazo de referência para compra.",
      tom: "vermelho",
      itens: acaba.map((i) => ({
        chave: `i${i.id}`,
        titulo: i.especificacao,
        detalhe: `cobertura estimada: ${Math.floor(i.coberturaDias ?? 0)} dia(s) · prazo de referência: ${i.prazoDias} dia(s)`,
        href: fichaInsumo(i.id),
        prazo: `acaba em ${Math.floor(i.coberturaDias ?? 0)} dia(s)`,
      })),
    },
    {
      chave: "vencidos",
      titulo: "Lotes vencidos com saldo",
      descricao: "Não podem ser usados. Descartar ou conferir a validade.",
      tom: "vermelho",
      itens: vencidos.map((l) => ({
        chave: `l${l.loteId ?? l.insumoId}-${l.validade}`,
        titulo: l.especificacao,
        detalhe: `venceu em ${dataBr(l.validade)} · ${formatar(l.quantidade)} no lote`,
        href: l.loteId ? fichaLote(l.loteId) : fichaInsumo(l.insumoId),
        prazo: dataBr(l.validade),
      })),
    },
    {
      chave: "compra-atrasada",
      titulo: "Compras atrasadas",
      descricao: "Pedido aberto além do prazo do fornecedor. Cobrar o fornecedor.",
      tom: "vermelho",
      itens: atrasadas.map((i) => ({
        chave: `i${i.id}`,
        titulo: i.especificacao,
        detalhe: `${pedido(i)} · disponível ${saldo(i)}`,
        href: fichaInsumo(i.id),
      })),
      acao: { rotulo: "Ver compras", href: "/compras" },
    },
    {
      chave: "fora-de-ordem",
      titulo: "Aberto fora da ordem de validade",
      descricao: "Abriram um lote enquanto outro, fechado, vence antes. Usar primeiro o que vence primeiro.",
      tom: "ambar",
      itens: foraDeOrdem.map(({ insumoId, aberto, antes }) => ({
        chave: `l${numero(aberto.id)}`,
        titulo: nome(insumoId),
        detalhe: `aberto: ${nomeLote(aberto)} (vence ${dataBr(aberto.validade)}) · fechado: ${nomeLote(antes)} (vence ${dataBr(validadeDoLote(antes))})`,
        href: fichaLote(antes.id),
        // o prazo é o do lote fechado que vence antes: é ele que tem de sair primeiro
        prazo: dataBr(validadeDoLote(antes)),
      })),
    },
    {
      chave: "varios-abertos",
      titulo: "Mais de um frasco aberto",
      descricao: "O mesmo insumo com vários lotes abertos ao mesmo tempo. Terminar um antes de abrir outro.",
      tom: "ambar",
      itens: variosAbertos.map(([insumoId, abertos]) => ({
        chave: `i${insumoId}`,
        titulo: nome(insumoId),
        detalhe: `${abertos.length} abertos: ${abertos.map(nomeLote).join(", ")}`,
        href: fichaInsumo(insumoId),
      })),
    },
    {
      chave: "vencendo",
      titulo: "Vencem em breve",
      descricao: "Lotes dentro da janela de vencimento. Priorizar o uso.",
      tom: "ambar",
      itens: vencendo.map((l) => ({
        chave: `l${l.loteId ?? l.insumoId}-${l.validade}`,
        titulo: l.especificacao,
        detalhe: `vence em ${dataBr(l.validade)} · ${formatar(l.quantidade)} no lote`,
        href: l.loteId ? fichaLote(l.loteId) : fichaInsumo(l.insumoId),
        prazo: dataBr(l.validade),
      })),
    },
    {
      chave: "abaixo-minimo",
      titulo: "Abaixo do mínimo",
      descricao: "Ainda tem, mas menos que o mínimo.",
      tom: "ambar",
      itens: abaixo.map((i) => ({
        chave: `i${i.id}`,
        titulo: i.especificacao,
        detalhe: `${saldo(i)} de mínimo ${formatar(i.minimo)}`,
        href: fichaInsumo(i.id),
      })),
    },
    {
      chave: "repor",
      titulo: "Repor",
      descricao: "Acima do mínimo, mas o consumo e o prazo pedem compra (sugestão do Estoque).",
      tom: "azul",
      itens: repor.map((i) => ({
        chave: `i${i.id}`,
        titulo: i.especificacao,
        detalhe: `comprar ${formatar(i.sugestaoCompra)} · disponível ${saldo(i)}`,
        href: fichaInsumo(i.id),
      })),
    },
    {
      chave: "quarentena",
      titulo: "Aguardando aceite",
      descricao: "Lotes recebidos em quarentena: ainda não contam como disponíveis.",
      tom: "azul",
      itens: quarentena.map((l) => ({
        chave: `l${numero(l.id)}`,
        titulo: nome(numero(l.insumo_id)),
        detalhe: `${nomeLote(l)} · ${formatar(numero(l.quantidade_atual))} no lote`,
        href: fichaLote(l.id),
      })),
    },
    {
      chave: "bloqueados",
      titulo: "Lotes bloqueados",
      descricao: "Com saldo, mas fora de uso. Liberar ou descartar.",
      tom: "azul",
      itens: bloqueados.map((l) => ({
        chave: `l${numero(l.id)}`,
        titulo: nome(numero(l.insumo_id)),
        detalhe: `${nomeLote(l)} · ${formatar(numero(l.quantidade_atual))} no lote`,
        href: fichaLote(l.id),
      })),
    },
    {
      chave: "parado",
      titulo: "Estoque parado",
      descricao: "Com saldo e sem nenhuma saída em 12 meses. Avaliar uso, troca ou descarte.",
      tom: "cinza",
      itens: parados.map((i) => ({
        chave: `i${i.id}`,
        titulo: i.especificacao,
        detalhe: `${formatar(Math.max(i.emMaos ?? 0, i.disponivel ?? 0))} ${i.unidade}${i.valorEstoque > 0 ? ` · ${moeda(i.valorEstoque)}` : ""}`.trim(),
        href: fichaInsumo(i.id),
      })),
    },
    {
      chave: "sem-validade",
      titulo: "Lotes sem validade",
      descricao: "Sem data, o vencimento não é avisado. Completar no lote.",
      tom: "cinza",
      itens: semValidade.map((l) => ({
        chave: `l${numero(l.id)}`,
        titulo: nome(numero(l.insumo_id)),
        detalhe: nomeLote(l),
        href: fichaLote(l.id),
      })),
    },
    {
      chave: "sem-minimo",
      titulo: "Sem mínimo definido",
      descricao: "Sem mínimo para comparar o saldo. Completar no cadastro.",
      tom: "cinza",
      itens: semMinimo.map((i) => ({
        chave: `i${i.id}`,
        titulo: i.especificacao,
        detalhe: zeroNoSistema(i) ? "Sem estoque · confira antes de decidir" : `disponível ${saldo(i)}`,
        href: cadastroInsumo(i.id),
      })),
    },
  ];
  return alertas
    .filter((a) => a.chave !== "parado" || movimentosCompletos)
    .filter((a) => !a.chave.startsWith("saldo-") || a.itens.length > 0)
    .map((a, ordem) => ({ a, ordem }))
    .sort((x, y) => {
      const vazioX = x.a.itens.length === 0 ? 1 : 0;
      const vazioY = y.a.itens.length === 0 ? 1 : 0;
      return vazioX - vazioY || ORDEM_TOM[x.a.tom] - ORDEM_TOM[y.a.tom] || x.ordem - y.ordem;
    })
    .map(({ a }) => a);
}

function formatar(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(valor);
}

function moeda(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(valor);
}
