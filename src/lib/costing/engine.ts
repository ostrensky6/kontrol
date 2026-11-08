/**
 * Engine de custeio — funções puras.
 *
 * Calcula o custo analítico por amostra de uma análise e o preço ao cliente,
 * a partir dos dados crus das tabelas + parâmetros + um cenário (tamanho do lote
 * e escolhas de grupo). Toda premissa está comentada; os números devem ser
 * validados contra a expectativa do laboratório.
 */

export type Etapa = {
  nome_etapa: string;
  nome_atividade: string;
  escopo_operacional?: string | null;
  execucoes_por_dia: number | null;
  amostras_por_execucao: number | null;
  tempo_maquina_h: number | null;
  tempo_bancada_h: number | null;
};

export type EquipAlloc = { peso: number; custoDia: number }; // custoDia já calculado

export type InsumoLinha = {
  nome_etapa: string;
  nome_atividade: string;
  especificacao_insumo: string | null;
  grupo_escolha: string | null;
  quantidade_por_amostra: number | null;
  modo_cobranca: string | null; // 'por_execucao' | 'por_amostra' | null
  custo_unitario: number | null; // do insumo ligado (null se não cadastrado)
  insumo_id?: number | null; // usado p/ demanda de estoque
  /** 0159: 'invalida' tira a alternativa do cálculo enquanto o grupo tiver outra. */
  alternativa_situacao?: string | null;
  unidade_estoque?: string | null;
  unidade_consumo?: string | null;
  fator_conversao?: number | null;
  fonte_custo?: string | null;
  referencia_custo?: string | null;
  custo_unitario_estoque?: number | null;
  custo_unitario_consumo?: number | null;
};

export type ProvenienciaDimensional = {
  insumo_id: number | null;
  unidade_estoque: string | null;
  unidade_consumo: string | null;
  fator_conversao: number | null;
  fonte_custo: string | null;
  referencia_custo: string | null;
  custo_unitario_estoque: number | null;
  custo_unitario_consumo: number | null;
  quantidade_consumo: number;
  quantidade_estoque: number | null;
};

export type Parametros = {
  dias_uteis_ano: number;
  // fatores de preço (em %)
  margem_lucro: number;
  impostos: number;
  taxas: number;
  fundo_reserva: number;
  fundo_investimento: number;
};

export type Cenario = {
  /** nº de amostras que dividem uma corrida (lote). Default = tamanho da execução-gargalo. */
  loteAmostras?: number;
  /** escolha por grupo: chave = grupo_escolha, valor = especificacao escolhida. */
  escolhasGrupo?: Record<string, string>;
};

const n = (v: number | null | undefined) => (typeof v === "number" ? v : 0);
const custoUnitarioNormalizado = (linha: InsumoLinha) =>
  n(linha.custo_unitario_consumo ?? linha.custo_unitario);
const isPosAnalise = (e: Etapa) =>
  e.escopo_operacional === "pos_analise" ||
  /bioinform/i.test(`${e.nome_etapa ?? ""} ${e.nome_atividade ?? ""}`);
const etapasLaboratorio = (etapas: Etapa[]) => etapas.filter((e) => !isPosAnalise(e));

/** custo/dia de um equipamento com depreciação LINEAR pela vida útil. */
export function equipCustoDia(
  e: {
    quantidade: number | null;
    custo_unitario: number | null;
    vida_util_anos: number | null;
    percentual_manutencao_anual: number | null;
    manutencao_anual_fixa: number | null;
  },
  diasUteisAno: number,
): number {
  const custoTotal = n(e.quantidade) * n(e.custo_unitario);
  const manut =
    e.manutencao_anual_fixa != null
      ? n(e.manutencao_anual_fixa)
      : custoTotal * n(e.percentual_manutencao_anual);
  const deprec = n(e.vida_util_anos) > 0 ? custoTotal / n(e.vida_util_anos) : 0;
  const dias = diasUteisAno > 0 ? diasUteisAno : 222;
  return (manut + deprec) / dias;
}

/** Gargalo: replica a lógica da planilha (mínimos ignorando Qubit). */
export function gargalo(etapas: Etapa[]) {
  const laboratorio = etapasLaboratorio(etapas);
  const baseOperacional = laboratorio.length ? laboratorio : etapas;
  const semQubit = baseOperacional.filter(
    (e) => !/qubit/i.test(e.nome_atividade ?? ""),
  );
  const base = semQubit.length ? semQubit : baseOperacional;
  const minExec = Math.min(...base.map((e) => n(e.execucoes_por_dia) || Infinity));
  const minAmExec = Math.min(
    ...base.map((e) => n(e.amostras_por_execucao) || Infinity),
  );
  const execucoesDia = Number.isFinite(minExec) ? minExec : 0;
  const amostrasPorExecucao = Number.isFinite(minAmExec) ? minAmExec : 0;
  return {
    execucoesDia,
    amostrasPorExecucao,
    amostrasDia: execucoesDia * amostrasPorExecucao,
  };
}

function etapasSemQubit(etapas: Etapa[]) {
  const laboratorio = etapasLaboratorio(etapas);
  const base = laboratorio.length ? laboratorio : etapas;
  const semQubit = base.filter(
    (e) => !/qubit/i.test(e.nome_atividade ?? ""),
  );
  return semQubit.length ? semQubit : base;
}

/** Horas de bancada por execução = soma da síntese operacional, ignorando Qubit. */
export function horasBancadaPorExecucao(etapas: Etapa[]): number {
  return etapasSemQubit(etapas).reduce((acc, e) => acc + n(e.tempo_bancada_h), 0);
}

/** Horas de bancada por amostra = horas por execução divididas pelo gargalo/lote. */
export function horasBancadaPorAmostra(etapas: Etapa[]): number {
  const lote = gargalo(etapas).amostrasPorExecucao;
  return lote > 0 ? horasBancadaPorExecucao(etapas) / lote : 0;
}

/**
 * Consumo de um insumo: por execução (lote) ou por amostra. Regra única para
 * previsão da proposta e demanda do planejamento/compras.
 */
export function consumoInsumo(
  linha: Pick<InsumoLinha, "quantidade_por_amostra" | "modo_cobranca">,
  amostras: number,
  execucoes: number,
) {
  const q = n(linha.quantidade_por_amostra);
  return linha.modo_cobranca === "por_execucao" ? q * execucoes : q * amostras;
}

/** Nomes dos insumos selecionados cujo custo não pôde ser calculado. */
export function insumosSemCusto(linhas: InsumoLinha[]): string[] {
  const nomes = linhas
    .filter((l) => n(l.quantidade_por_amostra) > 0 && !(custoUnitarioNormalizado(l) > 0))
    .map((l) => l.especificacao_insumo ?? "(insumo sem nome)");
  return [...new Set(nomes)];
}

/** Seleciona as linhas de insumo válidas aplicando as escolhas de grupo. */
export function insumosSelecionados<T extends InsumoLinha>(
  linhas: T[],
  escolhasGrupo: Record<string, string> = {},
): T[] {
  // agrupa por grupo_escolha; sem grupo => sempre incluído.
  const semGrupo = linhas.filter((l) => !l.grupo_escolha);
  const comGrupo = linhas.filter((l) => l.grupo_escolha);
  const grupos = new Map<string, T[]>();
  for (const l of comGrupo) {
    const k = l.grupo_escolha as string;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(l);
  }
  const escolhidas: T[] = [];
  for (const [grupo, todas] of grupos) {
    // Alternativa invalidada pelo laboratório (0159) não é orçada, salvo se
    // o grupo não tiver outra (o banco já impede esse caso).
    const validas = todas.filter((o) => o.alternativa_situacao !== "invalida");
    const opcoes = validas.length > 0 ? validas : todas;
    const escolhida = escolhasGrupo[grupo];
    if (escolhida) {
      escolhidas.push(
        ...opcoes.filter((o) => o.especificacao_insumo === escolhida),
      );
    } else {
      // Padrão de segurança (plano de evolução, 07/11/2026): entre alternativas
      // válidas, orçar a de MAIOR custo por amostra. Opção sem preço não vence
      // por "custo zero"; ela aparece em insumosSemCusto quando escolhida.
      const ord = [...opcoes].sort(
        (a, b) =>
          custoUnitarioNormalizado(b) * n(b.quantidade_por_amostra) -
          custoUnitarioNormalizado(a) * n(a.quantidade_por_amostra),
      );
      if (ord[0]) escolhidas.push(ord[0]);
    }
  }
  return [...semGrupo, ...escolhidas];
}

/**
 * Reagentes por amostra.
 * - por_amostra (default): custo_unitario × quantidade_por_amostra  (independe do lote)
 * - por_execucao: custo fixo por corrida, dividido pelo tamanho do lote
 *   (custo_unitario × quantidade_por_amostra) / loteAmostras
 */
export function reagentesPorAmostra(
  linhas: InsumoLinha[],
  loteAmostras: number,
): { total: number; detalhe: { nome: string; porAmostra: boolean; valor: number }[] } {
  const lote = loteAmostras > 0 ? loteAmostras : 1;
  const detalhe = linhas.map((l) => {
    const base = custoUnitarioNormalizado(l) * n(l.quantidade_por_amostra);
    const porExec = l.modo_cobranca === "por_execucao";
    const valor = porExec ? base / lote : base;
    return {
      nome: l.especificacao_insumo ?? "(sem insumo)",
      porAmostra: !porExec,
      valor,
    };
  });
  return { total: detalhe.reduce((a, d) => a + d.valor, 0), detalhe };
}

export function reagentesTotal(
  linhas: InsumoLinha[],
  numeroAmostras: number,
  loteAmostras: number,
  lotePorLinha?: (linha: InsumoLinha) => number | null | undefined,
): { total: number; detalhe: { nome: string; porAmostra: boolean; valor: number }[] } {
  const amostras = Math.max(0, numeroAmostras);
  const loteFallback = loteAmostras > 0 ? loteAmostras : 1;
  const detalhe = linhas.map((l) => {
    const base = custoUnitarioNormalizado(l) * n(l.quantidade_por_amostra);
    const porExec = l.modo_cobranca === "por_execucao";
    const loteLinha = n(lotePorLinha?.(l)) > 0 ? n(lotePorLinha?.(l)) : loteFallback;
    const execucoes = amostras > 0 ? Math.ceil(amostras / loteLinha) : 0;
    const valor = porExec ? base * execucoes : base * amostras;
    return {
      nome: l.especificacao_insumo ?? "(sem insumo)",
      porAmostra: !porExec,
      valor,
    };
  });
  return { total: detalhe.reduce((a, d) => a + d.valor, 0), detalhe };
}

function chaveEtapa(nomeEtapa: string | null | undefined, nomeAtividade: string | null | undefined) {
  return `${nomeEtapa ?? ""}\u0000${nomeAtividade ?? ""}`;
}

function lotePorEtapa(etapas: Etapa[]) {
  const lotes = new Map<string, number>();
  for (const etapa of etapasLaboratorio(etapas)) {
    const lote = n(etapa.amostras_por_execucao);
    if (lote > 0) {
      lotes.set(chaveEtapa(etapa.nome_etapa, etapa.nome_atividade), lote);
    }
  }
  return lotes;
}

function horasBancadaTotal(etapas: Etapa[], numeroAmostras: number, loteFallback: number): number {
  const amostras = Math.max(0, numeroAmostras);
  const fallback = loteFallback > 0 ? loteFallback : 1;
  return etapasSemQubit(etapas).reduce((total, etapa) => {
    const loteEtapa = n(etapa.amostras_por_execucao) > 0 ? n(etapa.amostras_por_execucao) : fallback;
    const execucoesEtapa = amostras > 0 ? Math.ceil(amostras / loteEtapa) : 0;
    return total + n(etapa.tempo_bancada_h) * execucoesEtapa;
  }, 0);
}

export type Breakdown = {
  codigo: string;
  /**
   * Insumos que entraram no cálculo sem preço (ou sem conversão de unidade).
   * O custo deles foi contado como zero, então o total está INCOMPLETO.
   */
  insumosSemCusto: string[];
  lote: number;
  reagentes: number;
  equipamento: number;
  pessoal: number;
  custoAnalitico: number;
  overhead: number;
  custoTotal: number;
  fatores: number; // soma % aplicada
  preco: number;
  provenienciaDimensional?: ProvenienciaDimensional[];
};

export type BreakdownOrcamento = Breakdown & {
  nAmostras: number;
  numeroExecucoes: number;
  totais: {
    reagentes: number;
    equipamento: number;
    pessoal: number;
    overhead: number;
    custoAnalitico: number;
    custoTotal: number;
    preco: number;
  };
  escolhasGrupo: Record<string, string>;
};

export type CurvaCustoAmostrasPonto = {
  amostras: number;
  ciclo: number;
  amostrasNoCiclo: number;
  capacidadeOperacional: number;
  custoUnitarioCiclo: number;
  custoUnitarioMedio: number;
  custoTotalPedido: number;
  custoTotalCiclo: number;
};

function equipamentoDiaTotal(equip: EquipAlloc[]) {
  return equip.reduce((a, e) => {
    const peso = Number.isFinite(e.peso) && e.peso > 0 ? e.peso : 0;
    const custoDia = Number.isFinite(e.custoDia) && e.custoDia > 0 ? e.custoDia : 0;
    return a + peso * custoDia;
  }, 0);
}

export function calcularAnalise(args: {
  codigo: string;
  etapas: Etapa[];
  equip: EquipAlloc[];
  insumos: InsumoLinha[];
  valorHoraPessoal: number; // Σ valor_hh dos técnicos
  custoHoraOverhead: number; // Σ custo_hora_bancada do overhead
  params: Parametros;
  cenario?: Cenario;
}): Breakdown {
  const g = gargalo(args.etapas);
  const lote = args.cenario?.loteAmostras ?? g.amostrasPorExecucao;

  const selic = insumosSelecionados(
    args.insumos,
    args.cenario?.escolhasGrupo,
  );
  const reagentes = reagentesPorAmostra(selic, lote).total;

  const equipDia = equipamentoDiaTotal(args.equip);
  const equipamento = g.amostrasDia > 0 ? equipDia / g.amostrasDia : 0;

  const hBancada = horasBancadaPorAmostra(args.etapas);
  const pessoal = hBancada * args.valorHoraPessoal;
  const overhead = hBancada * args.custoHoraOverhead;

  const custoAnalitico = reagentes + equipamento + pessoal;
  const custoTotal = custoAnalitico + overhead;

  const p = args.params;
  const fatores =
    (n(p.margem_lucro) +
      n(p.impostos) +
      n(p.taxas) +
      n(p.fundo_reserva) +
      n(p.fundo_investimento)) /
    100;
  const preco = custoTotal * (1 + fatores);
  const provenienciaDimensional = selic.map((linha) => {
    const quantidadeConsumo = n(linha.quantidade_por_amostra);
    const fatorConversao = n(linha.fator_conversao);

    return {
      insumo_id: linha.insumo_id ?? null,
      unidade_estoque: linha.unidade_estoque ?? null,
      unidade_consumo: linha.unidade_consumo ?? null,
      fator_conversao: fatorConversao > 0 ? fatorConversao : null,
      fonte_custo: linha.fonte_custo ?? null,
      referencia_custo: linha.referencia_custo ?? null,
      custo_unitario_estoque: linha.custo_unitario_estoque ?? null,
      custo_unitario_consumo:
        linha.custo_unitario_consumo ?? linha.custo_unitario ?? null,
      quantidade_consumo: quantidadeConsumo,
      quantidade_estoque:
        fatorConversao > 0 ? quantidadeConsumo / fatorConversao : null,
    } satisfies ProvenienciaDimensional;
  });

  return {
    codigo: args.codigo,
    insumosSemCusto: insumosSemCusto(selic),
    lote,
    reagentes,
    equipamento,
    pessoal,
    custoAnalitico,
    overhead,
    custoTotal,
    fatores,
    preco,
    provenienciaDimensional,
  };
}

export function calcularCurvaCustoAmostras(args: {
  codigo: string;
  etapas: Etapa[];
  equip: EquipAlloc[];
  insumos: InsumoLinha[];
  valorHoraPessoal: number;
  custoHoraOverhead: number;
  params: Parametros;
  maxAmostras?: number;
}): CurvaCustoAmostrasPonto[] {
  const g = gargalo(args.etapas);
  const capacidadeOperacional = Math.max(1, Math.floor(g.amostrasDia || g.amostrasPorExecucao || 1));
  const maxAmostras = Math.max(1, Math.min(1000, Math.floor(args.maxAmostras ?? capacidadeOperacional * 3)));
  const equipamentoDia = equipamentoDiaTotal(args.equip);
  const custoPorTamanhoDeCiclo = new Map<number, number>();

  const custoTotalDoCiclo = (amostrasNoCiclo: number) => {
    const amostras = Math.max(1, Math.floor(amostrasNoCiclo));
    const cached = custoPorTamanhoDeCiclo.get(amostras);
    if (cached != null) return cached;

    const parcial = calcularAnaliseOrcamento({
      ...args,
      numeroAmostras: amostras,
    });
    const equipamento = equipamentoDia > 0 ? equipamentoDia : parcial.totais.equipamento;
    const custoAnalitico = parcial.totais.reagentes + equipamento + parcial.totais.pessoal;
    const custoTotal = custoAnalitico + parcial.totais.overhead;
    custoPorTamanhoDeCiclo.set(amostras, custoTotal);
    return custoTotal;
  };

  const custoCicloCheio = custoTotalDoCiclo(capacidadeOperacional);

  return Array.from({ length: maxAmostras }, (_, index) => {
    const amostras = index + 1;
    const ciclosCheiosAntes = Math.floor((amostras - 1) / capacidadeOperacional);
    const amostrasNoCiclo = amostras - ciclosCheiosAntes * capacidadeOperacional;
    const ciclo = ciclosCheiosAntes + 1;
    const custoTotalCiclo = custoTotalDoCiclo(amostrasNoCiclo);
    const custoTotalPedido = ciclosCheiosAntes * custoCicloCheio + custoTotalCiclo;

    return {
      amostras,
      ciclo,
      amostrasNoCiclo,
      capacidadeOperacional,
      custoUnitarioCiclo: custoTotalCiclo / amostrasNoCiclo,
      custoUnitarioMedio: custoTotalPedido / amostras,
      custoTotalPedido,
      custoTotalCiclo,
    };
  });
}

export function calcularAnaliseOrcamento(args: {
  codigo: string;
  etapas: Etapa[];
  equip: EquipAlloc[];
  insumos: InsumoLinha[];
  valorHoraPessoal: number;
  custoHoraOverhead: number;
  params: Parametros;
  numeroAmostras: number;
  cenario?: Cenario;
}): BreakdownOrcamento {
  const amostras = Math.max(0, args.numeroAmostras);
  const base = calcularAnalise(args);
  const lote = args.cenario?.loteAmostras ?? base.lote;
  const loteSeguro = lote > 0 ? lote : 1;
  const numeroExecucoes = amostras > 0 ? Math.ceil(amostras / loteSeguro) : 0;
  const sel = insumosSelecionados(args.insumos, args.cenario?.escolhasGrupo);
  const lotesPorEtapa = lotePorEtapa(args.etapas);
  const reagentes = reagentesTotal(
    sel,
    amostras,
    loteSeguro,
    (linha) => lotesPorEtapa.get(chaveEtapa(linha.nome_etapa, linha.nome_atividade)),
  ).total;
  const equipamento = base.equipamento * amostras;
  const horasBancada = horasBancadaTotal(args.etapas, amostras, loteSeguro);
  const pessoal = horasBancada * args.valorHoraPessoal;
  const overhead = horasBancada * args.custoHoraOverhead;
  const custoAnalitico = reagentes + equipamento + pessoal;
  const custoTotal = custoAnalitico + overhead;
  const preco = custoTotal * (1 + base.fatores);
  const divisor = amostras > 0 ? amostras : 1;

  return {
    ...base,
    nAmostras: amostras,
    numeroExecucoes,
    lote: loteSeguro,
    reagentes: reagentes / divisor,
    equipamento: equipamento / divisor,
    pessoal: pessoal / divisor,
    overhead: overhead / divisor,
    custoAnalitico: custoAnalitico / divisor,
    custoTotal: custoTotal / divisor,
    preco: preco / divisor,
    escolhasGrupo: args.cenario?.escolhasGrupo ?? {},
    totais: {
      reagentes,
      equipamento,
      pessoal,
      overhead,
      custoAnalitico,
      custoTotal,
      preco,
    },
  };
}
