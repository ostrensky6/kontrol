/**
 * Painel de insumos da tela Cadastros: visão geral do que o laboratório tem,
 * do que está em falta e do que está em nível crítico.
 *
 * Regras (as mesmas de todo o app):
 * - Quantidade = **disponível** de v_estoque_saldo (em mãos menos reservado,
 *   quarentena, bloqueado e vencido), na unidade de saldo do insumo.
 * - Estoque mínimo = **ponto de reposição** do cadastro do insumo.
 * - Nível crítico = disponível abaixo do mínimo (inclui o que está em falta).
 * - Sem mínimo = ponto de reposição zero ou vazio: não entra no crítico, mas
 *   aparece para o cadastro ser completado.
 * - Saldo indisponível = a leitura do saldo falhou e este insumo ficou sem
 *   linha: não é zero nem crítico, porque não se sabe quanto há.
 */

import { normalizarBusca } from "@/lib/busca";

export type SituacaoPainel = "em_falta" | "abaixo_minimo" | "ok" | "sem_minimo" | "saldo_indisponivel";

export const META_SITUACAO_PAINEL: Record<SituacaoPainel, { rotulo: string; ordem: number }> = {
  em_falta: { rotulo: "Em falta", ordem: 0 },
  abaixo_minimo: { rotulo: "Abaixo do mínimo", ordem: 1 },
  sem_minimo: { rotulo: "Sem mínimo definido", ordem: 2 },
  ok: { rotulo: "Acima do mínimo", ordem: 3 },
  saldo_indisponivel: { rotulo: "Saldo indisponível", ordem: 4 },
};

export const SEM_CATEGORIA = "Sem categoria";

type Numerico = number | string | null | undefined;

export type InsumoPainelDb = {
  id: number;
  especificacao: string | null;
  nome_item?: string | null;
  categoria_compra?: string | null;
  fabricante?: string | null;
  codigo_fabricante?: string | null;
  unidade?: string | null;
  ponto_reposicao?: Numerico;
};

export type SaldoPainelDb = {
  insumo_id: Numerico;
  disponivel?: Numerico;
  em_maos?: Numerico;
  unidade_saldo?: string | null;
  unidade?: string | null;
};

export type MovimentoPainelDb = {
  insumo_id: Numerico;
  tipo: string | null;
  data: string | null;
};

export type InsumoPainel = {
  id: number;
  especificacao: string;
  categoriaCurta: string;
  categoriaCompra: string;
  fabricante: string;
  codigoFabricante: string;
  unidade: string;
  /** null = saldo não consultado (falha de leitura); 0 = zero confirmado */
  disponivel: number | null;
  emMaos: number | null;
  minimo: number;
  situacao: SituacaoPainel;
};

function numero(valor: Numerico): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function texto(valor: string | null | undefined): string {
  return (valor ?? "").trim();
}

export function situacaoPainel(disponivel: number, minimo: number): SituacaoPainel {
  if (!(minimo > 0)) return "sem_minimo";
  if (disponivel <= 0) return "em_falta";
  if (disponivel < minimo) return "abaixo_minimo";
  return "ok";
}

export function ehCritico(situacao: SituacaoPainel): boolean {
  return situacao === "em_falta" || situacao === "abaixo_minimo";
}

/**
 * Junta cadastro e saldo. Com a leitura de saldo completa, insumo sem linha
 * conta como zero (não tem lote). Se a leitura falhou (`saldosCompletos`
 * falso), insumo sem linha fica com saldo indisponível: não vira zero nem
 * crítico.
 */
export function montarInsumosPainel(
  insumos: readonly InsumoPainelDb[],
  saldos: readonly SaldoPainelDb[],
  { saldosCompletos = true }: { saldosCompletos?: boolean } = {},
): InsumoPainel[] {
  const saldoPorInsumo = new Map<number, SaldoPainelDb>();
  for (const saldo of saldos) saldoPorInsumo.set(Number(saldo.insumo_id), saldo);

  return insumos
    .map((insumo) => {
      const saldo = saldoPorInsumo.get(Number(insumo.id));
      const conhecido = saldo !== undefined || saldosCompletos;
      const disponivel = conhecido ? numero(saldo?.disponivel) : null;
      const minimo = numero(insumo.ponto_reposicao);
      return {
        id: Number(insumo.id),
        especificacao: texto(insumo.especificacao) || `Insumo ${insumo.id}`,
        categoriaCurta: texto(insumo.nome_item) || SEM_CATEGORIA,
        categoriaCompra: texto(insumo.categoria_compra) || SEM_CATEGORIA,
        fabricante: texto(insumo.fabricante),
        codigoFabricante: texto(insumo.codigo_fabricante),
        unidade: texto(saldo?.unidade_saldo) || texto(saldo?.unidade) || texto(insumo.unidade),
        disponivel,
        emMaos: conhecido ? numero(saldo?.em_maos) : null,
        minimo,
        situacao: disponivel === null ? ("saldo_indisponivel" as const) : situacaoPainel(disponivel, minimo),
      };
    })
    .sort(
      (a, b) =>
        META_SITUACAO_PAINEL[a.situacao].ordem - META_SITUACAO_PAINEL[b.situacao].ordem ||
        a.especificacao.localeCompare(b.especificacao, "pt-BR"),
    );
}

// ── Filtros ──────────────────────────────────────────────────────────────

export type FiltrosPainel = {
  categoriaCompra: string;
  categoriaCurta: string;
  codigoFabricante: string;
  /** busca livre pelo item específico / SKU, fabricante ou código */
  busca: string;
  /** "todos", "critico" ou uma SituacaoPainel */
  situacao: string;
};

export const FILTROS_PAINEL_VAZIOS: FiltrosPainel = {
  categoriaCompra: "",
  categoriaCurta: "",
  codigoFabricante: "",
  busca: "",
  situacao: "todos",
};

/** Sem acento e em minúsculas (a mesma busca das outras listas do app). */
export { normalizarBusca };

// ── Filtros na URL ───────────────────────────────────────────────────────

export const FILTROS_URL: Record<keyof FiltrosPainel, string> = {
  categoriaCompra: "compra",
  categoriaCurta: "curta",
  codigoFabricante: "codigo",
  busca: "busca",
  situacao: "situacao",
};

/** Filtros a partir da URL (?compra=&curta=&codigo=&busca=&situacao=). */
export function filtrosDaUrl(busca: string): FiltrosPainel {
  const params = new URLSearchParams(busca);
  const filtros = { ...FILTROS_PAINEL_VAZIOS };
  for (const [campo, chave] of Object.entries(FILTROS_URL) as [keyof FiltrosPainel, string][]) {
    const valor = params.get(chave);
    if (valor) filtros[campo] = valor;
  }
  return filtros;
}

/** Junta os filtros à URL atual, sem os vazios; preserva os outros parâmetros. */
export function urlComFiltros(busca: string, filtros: FiltrosPainel): string {
  const params = new URLSearchParams(busca);
  for (const [campo, chave] of Object.entries(FILTROS_URL) as [keyof FiltrosPainel, string][]) {
    const valor = filtros[campo];
    if (valor && valor !== FILTROS_PAINEL_VAZIOS[campo]) params.set(chave, valor);
    else params.delete(chave);
  }
  const texto = params.toString();
  return texto ? `?${texto}` : "";
}

export function atendeSituacao(situacao: SituacaoPainel, filtro: string): boolean {
  if (!filtro || filtro === "todos") return true;
  if (filtro === "critico") return ehCritico(situacao);
  return situacao === filtro;
}

/** Filtros de seleção (sem a situação), usados também para as opções em cascata. */
function atendeSelecao(item: InsumoPainel, filtros: FiltrosPainel, ignorar?: keyof FiltrosPainel): boolean {
  if (ignorar !== "categoriaCompra" && filtros.categoriaCompra && item.categoriaCompra !== filtros.categoriaCompra) return false;
  if (ignorar !== "categoriaCurta" && filtros.categoriaCurta && item.categoriaCurta !== filtros.categoriaCurta) return false;
  if (ignorar !== "codigoFabricante" && filtros.codigoFabricante && item.codigoFabricante !== filtros.codigoFabricante) return false;
  const busca = normalizarBusca(filtros.busca);
  if (busca) {
    const alvo = normalizarBusca(`${item.especificacao} ${item.fabricante} ${item.codigoFabricante} ${item.categoriaCurta}`);
    if (!alvo.includes(busca)) return false;
  }
  return true;
}

/** Itens do recorte, sem o filtro de situação (é a base dos indicadores e gráficos). */
export function filtrarRecorte(itens: readonly InsumoPainel[], filtros: FiltrosPainel): InsumoPainel[] {
  return itens.filter((item) => atendeSelecao(item, filtros));
}

/** Itens da lista: recorte + situação. */
export function filtrarLista(itens: readonly InsumoPainel[], filtros: FiltrosPainel): InsumoPainel[] {
  return itens.filter((item) => atendeSelecao(item, filtros) && atendeSituacao(item.situacao, filtros.situacao));
}

/**
 * Opções de um filtro respeitando os outros já escolhidos (cascata): ao
 * escolher a categoria de compra, a categoria curta só mostra as dela.
 */
export function opcoesFiltro(
  itens: readonly InsumoPainel[],
  filtros: FiltrosPainel,
  campo: "categoriaCompra" | "categoriaCurta" | "codigoFabricante",
): string[] {
  const valores = new Set<string>();
  for (const item of itens) {
    if (!atendeSelecao(item, { ...filtros, busca: "" }, campo)) continue;
    const valor = item[campo];
    if (valor) valores.add(valor);
  }
  // o valor escolhido continua na lista mesmo que outro filtro o esconda
  if (filtros[campo]) valores.add(filtros[campo]);
  return [...valores].sort((a, b) => {
    if (a === SEM_CATEGORIA) return 1;
    if (b === SEM_CATEGORIA) return -1;
    return a.localeCompare(b, "pt-BR");
  });
}

// ── Indicadores ──────────────────────────────────────────────────────────

export type ResumoPainel = {
  cadastrados: number;
  comEstoque: number;
  acimaMinimo: number;
  critico: number;
  emFalta: number;
  abaixoMinimo: number;
  semMinimo: number;
  /** saldo não consultado: fica fora de crítico, com estoque e saúde */
  saldoIndisponivel: number;
  /** % dos itens com mínimo definido que estão acima dele */
  saude: number | null;
};

export function resumirPainel(itens: readonly InsumoPainel[]): ResumoPainel {
  const conta = (situacao: SituacaoPainel) => itens.filter((item) => item.situacao === situacao).length;
  const emFalta = conta("em_falta");
  const abaixoMinimo = conta("abaixo_minimo");
  const acimaMinimo = conta("ok");
  const comMinimo = emFalta + abaixoMinimo + acimaMinimo;
  return {
    cadastrados: itens.length,
    comEstoque: itens.filter((item) => item.disponivel !== null && item.disponivel > 0).length,
    acimaMinimo,
    critico: emFalta + abaixoMinimo,
    emFalta,
    abaixoMinimo,
    semMinimo: conta("sem_minimo"),
    saldoIndisponivel: conta("saldo_indisponivel"),
    saude: comMinimo > 0 ? acimaMinimo / comMinimo : null,
  };
}

export type CategoriaResumo = {
  categoria: string;
  total: number;
  ok: number;
  critico: number;
  semMinimo: number;
  saldoIndisponivel: number;
};

/** Situação por categoria (curta ou de compra), das mais críticas para as menos. */
export function resumoPorCategoria(
  itens: readonly InsumoPainel[],
  campo: "categoriaCurta" | "categoriaCompra",
  limite = 10,
): CategoriaResumo[] {
  const mapa = new Map<string, CategoriaResumo>();
  for (const item of itens) {
    const categoria = item[campo];
    const linha = mapa.get(categoria) ?? { categoria, total: 0, ok: 0, critico: 0, semMinimo: 0, saldoIndisponivel: 0 };
    linha.total += 1;
    if (ehCritico(item.situacao)) linha.critico += 1;
    else if (item.situacao === "ok") linha.ok += 1;
    else if (item.situacao === "saldo_indisponivel") linha.saldoIndisponivel += 1;
    else linha.semMinimo += 1;
    mapa.set(categoria, linha);
  }
  return [...mapa.values()]
    .sort((a, b) => b.critico - a.critico || b.total - a.total || a.categoria.localeCompare(b.categoria, "pt-BR"))
    .slice(0, limite);
}

// ── Movimentações por mês ────────────────────────────────────────────────

export type MovimentoMes = { mes: string; rotulo: string; entradas: number; saidas: number };

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Primeiro dia (aaaa-mm-01) do mês que abre a janela de `meses` meses até o de `hojeIso`. */
export function inicioJanelaMeses(hojeIso: string, meses = 12): string {
  const [ano, mes] = hojeIso.slice(0, 10).split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1 - (meses - 1), 1));
  return data.toISOString().slice(0, 10);
}

/**
 * Registros de entrada e de saída por mês, só dos insumos do recorte.
 * Conta registros (não soma quantidades), porque cada insumo tem sua unidade.
 * Ajustes de inventário ficam de fora.
 */
export function movimentosPorMes(
  movimentos: readonly MovimentoPainelDb[],
  idsDoRecorte: ReadonlySet<number> | null,
  hojeIso: string,
  meses = 12,
): MovimentoMes[] {
  const inicio = inicioJanelaMeses(hojeIso, meses);
  const [anoInicio, mesInicio] = inicio.split("-").map(Number);
  const serie: MovimentoMes[] = [];
  const indice = new Map<string, MovimentoMes>();
  for (let i = 0; i < meses; i += 1) {
    const data = new Date(Date.UTC(anoInicio, mesInicio - 1 + i, 1));
    const chave = data.toISOString().slice(0, 7);
    const linha = {
      mes: chave,
      rotulo: `${MESES[data.getUTCMonth()]}/${String(data.getUTCFullYear()).slice(2)}`,
      entradas: 0,
      saidas: 0,
    };
    serie.push(linha);
    indice.set(chave, linha);
  }
  for (const movimento of movimentos) {
    if (idsDoRecorte && !idsDoRecorte.has(Number(movimento.insumo_id))) continue;
    const linha = indice.get(String(movimento.data ?? "").slice(0, 7));
    if (!linha) continue;
    if (movimento.tipo === "entrada") linha.entradas += 1;
    else if (movimento.tipo === "saida") linha.saidas += 1;
  }
  return serie;
}
