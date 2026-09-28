// Visão interna da proposta (28/09): custos efetivos por rubrica × custos
// operacionais (impostos, taxas, fundos, margem), com a compensação de imposto
// do gross-up explícita. Só APRESENTA: o cálculo autoritativo continua em
// engine-economica.ts e os totais emitidos nunca são recalculados.
import { roundMoney } from "@/lib/costing/pricing";
import { itemProjetoTotal } from "@/lib/project-budget/orcamento-projeto";
import { calcularFundos, type FundosLancamentos } from "./fundos";

export type GrupoCustoId = "laboratorio" | "PE" | "MC" | "MP" | "ST" | "VD" | "OU" | "analises_projeto";

const GRUPOS: Record<GrupoCustoId, { rotulo: string; rotuloCliente: string }> = {
  laboratorio: { rotulo: "Laboratório", rotuloCliente: "Análises laboratoriais" },
  PE: { rotulo: "PE · Pessoal", rotuloCliente: "Pessoal técnico" },
  MC: { rotulo: "MC · Material de consumo", rotuloCliente: "Material de consumo" },
  MP: { rotulo: "MP · Material permanente", rotuloCliente: "Material permanente" },
  ST: { rotulo: "ST · Serviços de terceiros", rotuloCliente: "Serviços de terceiros" },
  VD: { rotulo: "VD · Viagens e diárias", rotuloCliente: "Viagens e diárias" },
  OU: { rotulo: "OU · Outros", rotuloCliente: "Outros custos" },
  analises_projeto: { rotulo: "Análises do projeto", rotuloCliente: "Análises laboratoriais do projeto" },
};

export const ORDEM_GRUPOS: GrupoCustoId[] = ["laboratorio", "PE", "MC", "MP", "ST", "VD", "OU", "analises_projeto"];

export type ItemInterno = {
  id: string;
  grupo: GrupoCustoId;
  codigo: string | null;
  descricao: string;
  detalhe: string | null;
  quantidade: number;
  unidade: string | null;
  custoUnitario: number;
  custoTotal: number;
  precoReferencia: number | null;
  naProposta: number;
  descricaoAusente: boolean;
};

export type GrupoInterno = {
  id: GrupoCustoId;
  rotulo: string;
  rotuloCliente: string;
  itens: ItemInterno[];
  custoTotal: number;
  naProposta: number;
  percentualDoTotal: number;
};

export type TipoOperacional = "imposto" | "taxa" | "fundo" | "margem";

export type LinhaOperacional = {
  chave: string;
  rotulo: string;
  tipo: TipoOperacional;
  percentualInformado: number;
  percentualSobrePreco: number;
  valorLimpo: number;
  /** null na linha de impostos e em versões com a regra anterior */
  impostoCompensado: number | null;
  parteNota: number | null;
};

export type VisaoInterna = {
  legado: boolean;
  grupos: GrupoInterno[];
  custosEfetivos: number;
  efetivosCompensacao: { impostoCompensado: number; parteNota: number } | null;
  operacionais: LinhaOperacional[];
  custosOperacionais: number;
  total: number;
  somaPercentual: number;
  fatorGrossUp: number;
};

export type ItemLabEntrada = {
  id?: number | null;
  codigo_analise?: string | null;
  n_amostras?: number | null;
  custo_unitario?: number | null;
  preco_unitario?: number | null;
};

export type ItemProjetoEntrada = {
  id?: number | null;
  rubrica?: string | null;
  descricao?: string | null;
  categoria?: string | null;
  unidade?: string | null;
  quantidade?: number | null;
  custo_unitario?: number | null;
  preco_unitario?: number | null;
  meses_selecionados?: number[] | null;
};

export type ParametroEntrada = { chave: string; label: string; percentual: number; valorNominal: number };

export type EntradaVisaoInterna = {
  itensLaboratorio: ItemLabEntrada[];
  custosProjeto: ItemProjetoEntrada[];
  analisesProjeto: ItemLabEntrada[];
  parametros: ParametroEntrada[];
  total: number;
  legado: boolean;
  nomesAnalises?: Record<string, string>;
};

const TIPOS: Record<string, TipoOperacional> = {
  impostos_legacy: "imposto",
  impostos: "imposto",
  incubacao: "taxa",
  reserva: "fundo",
  investimentos: "fundo",
  lucro: "margem",
};

const ROTULOS_OPERACIONAIS: Record<string, string> = {
  impostos_legacy: "Impostos",
  impostos: "Impostos",
  incubacao: "Incubação UFPR",
  reserva: "Fundo de reserva",
  investimentos: "Fundo de investimento",
  lucro: "Lucro",
};

export const ROTULO_TIPO_OPERACIONAL: Record<TipoOperacional, string> = {
  imposto: "Imposto",
  taxa: "Taxa",
  fundo: "Fundo",
  margem: "Margem",
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function grupoDaRubrica(rubrica: string | null | undefined): GrupoCustoId {
  const r = (rubrica ?? "").toUpperCase();
  return r === "PE" || r === "MC" || r === "MP" || r === "ST" || r === "VD" ? r : "OU";
}

export function descreverMeses(meses: number[] | null | undefined): string | null {
  const lista = [...new Set((meses ?? []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (lista.length === 0) return null;
  if (lista.length === 1) return `mês ${lista[0]}`;
  const continuo = lista.every((m, i) => i === 0 || m === lista[i - 1] + 1);
  if (continuo) return `meses ${lista[0]} a ${lista[lista.length - 1]}`;
  return `meses ${lista.slice(0, -1).join(", ")} e ${lista[lista.length - 1]}`;
}

const PLURAIS: Record<string, string> = { amostra: "amostras", mês: "meses", mes: "meses", diária: "diárias", hora: "horas" };

export function formatarQuantidade(quantidade: number, unidade: string | null | undefined): string {
  const numero = quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const u = unidade?.trim();
  if (!u) return numero;
  const plural = quantidade === 1 ? u : PLURAIS[u.toLowerCase()] ?? u;
  return `${numero} ${plural}`;
}

type ItemBase = Omit<ItemInterno, "naProposta">;

function itensDeEntrada(e: EntradaVisaoInterna): ItemBase[] {
  const nomes = e.nomesAnalises ?? {};
  const analise = (item: ItemLabEntrada, grupo: GrupoCustoId, i: number): ItemBase => {
    const codigo = texto(item.codigo_analise);
    const quantidade = num(item.n_amostras);
    const custoUnitario = num(item.custo_unitario);
    const preco = item.preco_unitario == null ? null : num(item.preco_unitario);
    return {
      id: `${grupo}-${item.id ?? i}`,
      grupo,
      codigo,
      descricao: (codigo && nomes[codigo]) || codigo || "Análise laboratorial",
      detalhe: null,
      quantidade,
      unidade: "amostra",
      custoUnitario,
      custoTotal: roundMoney(quantidade * custoUnitario),
      precoReferencia: preco,
      descricaoAusente: false,
    };
  };

  return [
    ...e.itensLaboratorio.map((item, i) => analise(item, "laboratorio", i)),
    ...e.custosProjeto.map((item, i): ItemBase => {
      const grupo = grupoDaRubrica(item.rubrica);
      const custoUnitario = num(item.custo_unitario ?? item.preco_unitario);
      const meses = grupo === "PE" && (item.meses_selecionados?.length ?? 0) > 0 ? item.meses_selecionados! : null;
      const descricao = texto(item.descricao);
      return {
        id: `${grupo}-${item.id ?? i}`,
        grupo,
        codigo: null,
        descricao: descricao ?? "Descrição não registrada na emissão",
        detalhe: meses ? descreverMeses(meses) : texto(item.categoria),
        quantidade: meses ? meses.length : num(item.quantidade),
        unidade: meses ? "mês" : texto(item.unidade),
        custoUnitario,
        custoTotal: itemProjetoTotal({
          rubrica: item.rubrica,
          quantidade: item.quantidade,
          preco_unitario: custoUnitario,
          meses_selecionados: item.meses_selecionados ?? [],
        }),
        precoReferencia: null,
        descricaoAusente: !descricao,
      };
    }),
    ...e.analisesProjeto.map((item, i) => analise(item, "analises_projeto", i)),
  ];
}

/**
 * Reparte o total pelos itens na proporção do custo, como a composição comercial
 * (reconciliarComposicao): arredonda por linha e joga o resíduo na última linha
 * com custo, para a soma fechar exatamente com o total.
 */
function repartir(itens: ItemBase[], total: number): ItemInterno[] {
  const base = roundMoney(itens.reduce((acc, i) => acc + Math.max(0, i.custoTotal), 0));
  const alvo = roundMoney(Math.max(0, total));
  const resultado = itens.map((i) => ({
    ...i,
    naProposta: base > 0 && i.custoTotal > 0 ? roundMoney(alvo * (i.custoTotal / base)) : 0,
  }));
  const ultima = [...resultado].reverse().find((i) => i.custoTotal > 0);
  if (ultima) {
    const residuo = roundMoney(alvo - resultado.reduce((acc, i) => acc + i.naProposta, 0));
    ultima.naProposta = roundMoney(ultima.naProposta + residuo);
  }
  return resultado;
}

export function montarVisaoInterna(e: EntradaVisaoInterna): VisaoInterna {
  const total = roundMoney(num(e.total));
  const itens = repartir(itensDeEntrada(e), total);
  const custosEfetivos = roundMoney(itens.reduce((acc, i) => acc + i.custoTotal, 0));

  const grupos: GrupoInterno[] = ORDEM_GRUPOS.flatMap((id) => {
    const doGrupo = itens.filter((i) => i.grupo === id);
    if (doGrupo.length === 0) return [];
    const custoTotal = roundMoney(doGrupo.reduce((acc, i) => acc + i.custoTotal, 0));
    return [{
      id,
      ...GRUPOS[id],
      itens: doGrupo,
      custoTotal,
      naProposta: roundMoney(doGrupo.reduce((acc, i) => acc + i.naProposta, 0)),
      percentualDoTotal: total > 0 ? (custoTotal / total) * 100 : 0,
    }];
  });

  const impostos = e.parametros.find((p) => TIPOS[p.chave] === "imposto")?.percentual ?? 0;
  const operacionaisBase = e.parametros.map((p) => {
    const tipo = TIPOS[p.chave] ?? "taxa";
    const percentualInformado = num(p.percentual);
    // Regra da engine: a incubação incide sobre o preço sem impostos.
    const percentualSobrePreco =
      !e.legado && p.chave === "incubacao" ? percentualInformado * Math.max(0, 1 - impostos / 100) : percentualInformado;
    return {
      chave: p.chave,
      rotulo: ROTULOS_OPERACIONAIS[p.chave] ?? p.label,
      tipo,
      percentualInformado,
      percentualSobrePreco,
      valorLimpo: roundMoney(num(p.valorNominal)),
    };
  });
  const somaPercentual = operacionaisBase.reduce((acc, o) => acc + o.percentualSobrePreco, 0);

  let efetivosCompensacao: VisaoInterna["efetivosCompensacao"] = null;
  let operacionais: LinhaOperacional[];
  if (e.legado) {
    operacionais = operacionaisBase.map((o) => ({ ...o, impostoCompensado: null, parteNota: null }));
  } else {
    // Gross-up: cada valor limpo "carrega" o imposto que incide sobre ele.
    const divisor = 1 - impostos / 100;
    const parte = (limpo: number) => (divisor > 0 ? roundMoney(limpo / divisor) : limpo);
    const parteEfetivos = parte(custosEfetivos);
    operacionais = operacionaisBase.map((o) =>
      o.tipo === "imposto"
        ? { ...o, impostoCompensado: null, parteNota: null }
        : { ...o, parteNota: parte(o.valorLimpo), impostoCompensado: roundMoney(parte(o.valorLimpo) - o.valorLimpo) },
    );
    // Resíduo de centavo nos efetivos, a maior linha: a nota fecha com o total.
    const somaPartes = operacionais.reduce((acc, o) => acc + (o.parteNota ?? 0), 0);
    const parteAjustada = total > 0 ? roundMoney(total - somaPartes) : parteEfetivos;
    efetivosCompensacao = {
      parteNota: parteAjustada,
      impostoCompensado: roundMoney(parteAjustada - custosEfetivos),
    };
  }

  return {
    legado: e.legado,
    grupos,
    custosEfetivos,
    efetivosCompensacao,
    operacionais,
    custosOperacionais: roundMoney(Math.max(0, total - custosEfetivos)),
    total,
    somaPercentual,
    fatorGrossUp: somaPercentual < 100 ? 1 / (1 - somaPercentual / 100) : 0,
  };
}

type SnapshotLoose = {
  nomes_analises?: Record<string, unknown>;
  orcamentos_analises?: Array<{ orcamento_itens?: ItemLabEntrada[] | null }> | null;
  orcamentos_projeto?: Array<{
    orcamento_projeto_custos?: ItemProjetoEntrada[] | null;
    orcamento_projeto_analises?: ItemLabEntrada[] | null;
  }> | null;
  consolidado?: {
    economia?: { politica?: string; parametros?: Array<{ chave?: string; label?: string; percentual?: number; valorNominal?: number }> };
    parametrosProjeto?: Array<{ key?: string; label?: string; nominalRate?: number; amount?: number }>;
  } | null;
};

const lista = <T,>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);

/** Lê o snapshot congelado de uma versão emitida (formato atual ou legado). */
export function entradaDoSnapshot(
  snapshot: unknown,
  total: number,
  nomesCatalogo: Record<string, string> = {},
): EntradaVisaoInterna {
  const snap: SnapshotLoose =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? (snapshot as SnapshotLoose) : {};
  const economia = snap.consolidado?.economia;
  const legado = economia?.politica !== "A_GROSS_UP_TOTAL";
  const nomesCongelados = Object.fromEntries(
    Object.entries(snap.nomes_analises ?? {}).filter((par): par is [string, string] => typeof par[1] === "string"),
  );
  const parametros: ParametroEntrada[] = legado
    ? lista(snap.consolidado?.parametrosProjeto).map((p) => ({
        chave: String(p.key ?? p.label ?? ""),
        label: String(p.label ?? p.key ?? ""),
        percentual: num(p.nominalRate),
        valorNominal: num(p.amount),
      }))
    : lista(economia?.parametros).map((p) => ({
        chave: String(p.chave ?? ""),
        label: String(p.label ?? p.chave ?? ""),
        percentual: num(p.percentual),
        valorNominal: num(p.valorNominal),
      }));

  return {
    itensLaboratorio: lista(snap.orcamentos_analises).flatMap((o) => lista(o.orcamento_itens)),
    custosProjeto: lista(snap.orcamentos_projeto).flatMap((o) => lista(o.orcamento_projeto_custos)),
    analisesProjeto: lista(snap.orcamentos_projeto).flatMap((o) => lista(o.orcamento_projeto_analises)),
    parametros,
    total,
    legado,
    nomesAnalises: { ...nomesCatalogo, ...nomesCongelados },
  };
}

export type LinhaFundo = {
  chave: "reserva" | "investimentos";
  rotulo: string;
  percentual: number;
  previsto: number;
  impostoCompensado: number | null;
  liberado: number | null;
  usado: number | null;
  saldo: number | null;
};

/** Fundos da proposta; com acompanhamento lançado, a mesma regra da tela Fundos e taxas. */
export function montarFundos(
  visao: VisaoInterna,
  acompanhamento: FundosLancamentos | null,
): { linhas: LinhaFundo[]; percentualRecebido: number | null } {
  const valor = (chave: string) => visao.operacionais.find((o) => o.chave === chave);
  const calculo = acompanhamento
    ? calcularFundos({
        totalFinal: visao.total,
        previstos: {
          impostos: visao.operacionais.find((o) => o.tipo === "imposto")?.valorLimpo ?? 0,
          incubacao: valor("incubacao")?.valorLimpo ?? 0,
          reserva: valor("reserva")?.valorLimpo ?? 0,
          investimentos: valor("investimentos")?.valorLimpo ?? 0,
        },
        lancamentos: acompanhamento,
      })
    : null;

  const linhas = (["reserva", "investimentos"] as const).flatMap((chave): LinhaFundo[] => {
    const op = valor(chave);
    if (!op) return [];
    return [{
      chave,
      rotulo: chave === "reserva" ? "Reserva" : "Investimento",
      percentual: op.percentualSobrePreco,
      previsto: op.valorLimpo,
      impostoCompensado: op.impostoCompensado,
      liberado: calculo ? calculo.liberado[chave] : null,
      usado: calculo ? calculo.executado[chave] : null,
      saldo: calculo ? calculo.saldo[chave] : null,
    }];
  });
  return { linhas, percentualRecebido: calculo ? calculo.percentualRecebido : null };
}
