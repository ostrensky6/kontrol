import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";
import { lerTudo } from "@/lib/supabase/ler-tudo";
import {
  calcularAnalise,
  calcularAnaliseOrcamento,
  equipCustoDia,
  type Breakdown,
  type BreakdownOrcamento,
  type Cenario,
  type EquipAlloc,
  type Etapa,
  type InsumoLinha,
  type Parametros,
} from "./engine";

export type SimuladorAnalise = {
  codigo: string;
  etapas: Etapa[];
  equip: EquipAlloc[];
  insumos: InsumoLinha[];
  lotePadrao: number;
  grupos: Array<{ nome: string; opcoes: string[] }>;
};

export type FonteCustoInsumos = "custo_padrao" | "custo_medio_ponderado";

type EquipamentoAnaliseRow = {
  codigo_analise: string;
  equipamento_id: number;
  peso_alocacao: number | null;
};

type CustoEstoqueRow = {
  insumo_id: number;
  custo_padrao: number | null;
  custo_medio_ponderado: number | null;
  unidade_estoque: string | null;
  unidade_consumo: string | null;
  fator_conversao: number | null;
  custo_origem: number | null;
  custo_normalizado: number | null;
  fonte_custo: string | null;
  referencia_custo: string | null;
};

type InsumoAnaliseRow = {
  codigo_analise: string;
  nome_etapa: string;
  nome_atividade: string;
  especificacao_insumo: string | null;
  grupo_escolha: string | null;
  alternativa_situacao?: string | null;
  quantidade_por_amostra: number | null;
  modo_cobranca: string | null;
  insumo_id: number | null;
  insumos: { custo_unitario: number | null } | null;
};

const numeroOuNull = (valor: unknown) => {
  if (valor == null) return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
};

function montarInsumoComCusto(
  linha: InsumoAnaliseRow,
  custo: CustoEstoqueRow | undefined,
  fonteSolicitada: FonteCustoInsumos,
): InsumoLinha {
  const custoPadrao =
    numeroOuNull(custo?.custo_padrao) ?? numeroOuNull(linha.insumos?.custo_unitario);
  const custoMedio = numeroOuNull(custo?.custo_medio_ponderado);
  const custoUnitarioEstoque =
    fonteSolicitada === "custo_medio_ponderado" && custoMedio != null
      ? custoMedio
      : custoPadrao;
  const fatorConversao = numeroOuNull(custo?.fator_conversao);
  const custoUnitarioConsumo =
    custoUnitarioEstoque == null || fatorConversao == null || fatorConversao <= 0
      ? null
      : custoUnitarioEstoque / fatorConversao;
  const fonteCusto =
    fonteSolicitada === "custo_medio_ponderado" && custoMedio != null
      ? "custo_medio_ponderado"
      : fonteSolicitada === "custo_medio_ponderado"
        ? "custo_padrao_fallback"
        : "custo_padrao";

  return {
    nome_etapa: linha.nome_etapa,
    nome_atividade: linha.nome_atividade,
    especificacao_insumo: linha.especificacao_insumo,
    grupo_escolha: linha.grupo_escolha,
    alternativa_situacao: linha.alternativa_situacao ?? null,
    quantidade_por_amostra: linha.quantidade_por_amostra,
    modo_cobranca: linha.modo_cobranca,
    insumo_id: linha.insumo_id,
    custo_unitario: custoUnitarioConsumo ?? custoUnitarioEstoque,
    unidade_estoque: custo?.unidade_estoque ?? null,
    unidade_consumo: custo?.unidade_consumo ?? null,
    fator_conversao: fatorConversao,
    fonte_custo: fonteCusto,
    referencia_custo: custo?.referencia_custo ?? null,
    custo_unitario_estoque: custoUnitarioEstoque,
    custo_unitario_consumo: custoUnitarioConsumo,
  };
}

export type ParceiroEquip = { custo: number; nome: string; estimado: boolean };

/** 0161: equipamento de parceiro com custo por amostra informado. */
export function parceirosDosEquipamentos(equipamentos: readonly Record<string, unknown>[]) {
  const mapa = new Map<number, ParceiroEquip>();
  for (const e of equipamentos) {
    const custo = Number(e.custo_parceiro_por_amostra);
    if (e.custo_parceiro_por_amostra == null || !Number.isFinite(custo) || custo <= 0) continue;
    mapa.set(Number(e.id), { custo, nome: String(e.nome ?? "Equipamento de parceiro"), estimado: e.custo_parceiro_estimado === true });
  }
  return mapa;
}

export function montarEquipamentosAlocados(
  linhas: EquipamentoAnaliseRow[],
  codigo: string,
  custoDiaPorEquip: Map<number, number>,
  parceiroPorEquip: Map<number, ParceiroEquip> = new Map(),
): EquipAlloc[] {
  return linhas
    .filter((ea) => ea.codigo_analise === codigo)
    .map((ea) => {
      const parceiro = parceiroPorEquip.get(ea.equipamento_id);
      return {
        peso: Number(ea.peso_alocacao),
        custoDia: custoDiaPorEquip.get(ea.equipamento_id) ?? 0,
        ...(parceiro ? { custoPorAmostra: parceiro.custo, nome: parceiro.nome, estimado: parceiro.estimado } : {}),
      };
    })
    .filter((ea) => Number.isFinite(ea.peso) && ea.peso > 0);
}

type Leitura<T> = { data: T | null; error: { message: string } | null };

/**
 * Fonte essencial do custeio: se a consulta falhar, o cálculo para com
 * mensagem clara. Antes um erro virava lista vazia e o custo saía sem a
 * etapa, o equipamento ou o insumo, com cara de resultado normal.
 */
export function exigirFonte<T>(nome: string, leitura: Leitura<T[]>): T[] {
  if (leitura.error) {
    throw new Error(`Não foi possível ler ${nome} para o custeio: ${leitura.error.message}`);
  }
  return leitura.data ?? [];
}

const SELECT_INSUMO_ANALISE =
  "id, codigo_analise, nome_etapa, nome_atividade, especificacao_insumo, grupo_escolha, alternativa_situacao, quantidade_por_amostra, modo_cobranca, insumo_id, insumos(custo_unitario)";
const SELECT_CUSTO_ESTOQUE =
  "insumo_id, custo_padrao, custo_medio_ponderado, unidade_estoque, unidade_consumo, fator_conversao, custo_origem, custo_normalizado, fonte_custo, referencia_custo";

/** Tabelas que podem passar de mil linhas são lidas por páginas (ler-tudo). */
async function lerFontesCusteio(supabase: Awaited<ReturnType<typeof createClient>>, somenteOfertaveis: boolean) {
  const consultaAnalises = somenteOfertaveis
    ? supabase.from("analises").select("codigo").eq("ativo", true).eq("ofertavel", true)
    : supabase.from("analises").select("codigo");
  const [analises, etapas, equipamentos, equipAnalise, insumoAnalise, custosEstoque] = await Promise.all([
    lerTudo<{ codigo: string }>((de, ate) => consultaAnalises.order("codigo").range(de, ate)),
    lerTudo<Tables<"etapas">>((de, ate) => supabase.from("etapas").select("*").order("id").range(de, ate)),
    lerTudo<Tables<"equipamentos">>((de, ate) => supabase.from("equipamentos").select("*").order("id").range(de, ate)),
    lerTudo<EquipamentoAnaliseRow>((de, ate) =>
      supabase.from("equipamento_analise").select("*").order("id").range(de, ate),
    ),
    lerTudo<InsumoAnaliseRow>((de, ate) =>
      supabase.from("insumo_analise").select(SELECT_INSUMO_ANALISE).order("id").range(de, ate),
    ),
    lerTudo<CustoEstoqueRow>((de, ate) =>
      supabase.from("v_custo_estoque_vigente").select(SELECT_CUSTO_ESTOQUE).order("insumo_id").range(de, ate),
    ),
  ]);
  return {
    analises: exigirFonte("as análises", analises),
    etapas: exigirFonte("as etapas das análises", etapas),
    equipamentos: exigirFonte("os equipamentos", equipamentos),
    equipAnalise: exigirFonte("os equipamentos das análises", equipAnalise),
    insumoAnalise: exigirFonte("os insumos das análises", insumoAnalise),
    custosEstoque: exigirFonte("o custo vigente dos insumos", custosEstoque),
  };
}

/** Carrega tudo do banco e calcula o breakdown de todas as análises. */
export async function calcularTodas(
  cenarioPorAnalise: Record<string, Cenario> = {},
  fonteCustoInsumos: FonteCustoInsumos = "custo_padrao",
): Promise<{ breakdowns: Breakdown[]; params: Parametros; valorHoraPessoal: number; custoHoraOverhead: number }> {
  const supabase = await createClient();

  const [
    { analises, etapas, equipamentos, equipAnalise, insumoAnalise, custosEstoque },
    { data: valorHoraPessoalTotal, error: valorHoraPessoalError },
    overheadLeitura,
    parametrosLeitura,
  ] = await Promise.all([
    lerFontesCusteio(supabase, false),
    // Salários individuais não são lidos aqui (migration 0112): só o agregado.
    supabase.rpc("valor_hora_pessoal_total"),
    supabase.from("overhead").select("*"),
    supabase.from("parametros").select("chave, valor"),
  ]);
  const overhead = exigirFonte("o overhead", overheadLeitura);
  // sem os parâmetros, margem, impostos e fundos virariam zero
  const parametros = exigirFonte("os parâmetros de custeio", parametrosLeitura);

  const custoPorInsumo = new Map(
    ((custosEstoque ?? []) as CustoEstoqueRow[]).map(
      (custo) => [custo.insumo_id, custo] as const,
    ),
  );

  const par = Object.fromEntries(
    (parametros ?? []).map((p) => [p.chave, Number(p.valor)]),
  );
  const params: Parametros = {
    dias_uteis_ano: par.dias_uteis_ano ?? 222,
    margem_lucro: par.margem_lucro ?? 0,
    impostos: par.impostos ?? 0,
    taxas: par.taxas ?? 0,
    fundo_reserva: par.fundo_reserva ?? 0,
    fundo_investimento: par.fundo_investimento ?? 0,
  };

  // valor-hora de pessoal = Σ valor_hh (valor_mes/horas_mes_base × %dedicado/100),
  // calculado no banco (SECURITY DEFINER) para não expor salários individuais.
  // Falha explícita: um zero silencioso subprecificaria todas as análises.
  if (valorHoraPessoalError) {
    throw new Error(`Não foi possível obter o valor-hora de pessoal: ${valorHoraPessoalError.message}`);
  }
  const valorHoraPessoal = Number(valorHoraPessoalTotal ?? 0);
  if (!Number.isFinite(valorHoraPessoal)) {
    throw new Error("Valor-hora de pessoal inválido retornado pelo banco.");
  }

  // custo-hora de overhead = Σ (custo_mensal/horas_bancada_mes × %compensada/100)
  const custoHoraOverhead = (overhead ?? []).reduce((acc, o) => {
    const base =
      Number(o.horas_bancada_mes) > 0
        ? Number(o.custo_mensal) / Number(o.horas_bancada_mes)
        : 0;
    return acc + (base * Number(o.percentual_compensada)) / 100;
  }, 0);

  // custo/dia por equipamento (depreciação linear)
  const custoDiaPorEquip = new Map<number, number>();
  for (const e of equipamentos ?? []) {
    custoDiaPorEquip.set(e.id, equipCustoDia(e, params.dias_uteis_ano));
  }
  const parceiros = parceirosDosEquipamentos((equipamentos ?? []) as unknown as Record<string, unknown>[]);

  const breakdowns: Breakdown[] = (analises ?? []).map((a) => {
    const codigo = a.codigo;
    const etapasA = (etapas ?? []).filter((e) => e.codigo_analise === codigo);
    const equipA = montarEquipamentosAlocados(
      (equipAnalise ?? []) as EquipamentoAnaliseRow[],
      codigo,
      custoDiaPorEquip,
      parceiros,
    );
    const insumosA = ((insumoAnalise ?? []) as InsumoAnaliseRow[])
      .filter((i) => i.codigo_analise === codigo)
      .map((i) =>
        montarInsumoComCusto(
          i,
          i.insumo_id == null ? undefined : custoPorInsumo.get(i.insumo_id),
          fonteCustoInsumos,
        ),
      );

    return calcularAnalise({
      codigo,
      etapas: etapasA,
      equip: equipA,
      insumos: insumosA,
      valorHoraPessoal,
      custoHoraOverhead,
      params,
      cenario: cenarioPorAnalise[codigo],
    });
  });

  return { breakdowns, params, valorHoraPessoal, custoHoraOverhead };
}

export async function carregarSimuladorCusteio(
  fonteCustoInsumos: FonteCustoInsumos = "custo_padrao",
): Promise<{
  analises: SimuladorAnalise[];
  params: Parametros;
  valorHoraPessoal: number;
  custoHoraOverhead: number;
}> {
  const supabase = await createClient();
  const { analises, etapas, equipamentos, equipAnalise, insumoAnalise, custosEstoque } = await lerFontesCusteio(
    supabase,
    true,
  );
  const codigosAtivos = new Set((analises ?? []).map((analise) => analise.codigo));
  const { breakdowns, params, valorHoraPessoal, custoHoraOverhead } = await calcularTodas({}, fonteCustoInsumos);
  const custoPorInsumo = new Map(
    ((custosEstoque ?? []) as CustoEstoqueRow[]).map(
      (custo) => [custo.insumo_id, custo] as const,
    ),
  );

  const custoDiaPorEquip = new Map<number, number>();
  for (const e of equipamentos ?? []) {
    custoDiaPorEquip.set(e.id, equipCustoDia(e, params.dias_uteis_ano));
  }
  const parceiros = parceirosDosEquipamentos((equipamentos ?? []) as unknown as Record<string, unknown>[]);

  return {
    params,
    valorHoraPessoal,
    custoHoraOverhead,
    analises: breakdowns
      .filter((b) => codigosAtivos.has(b.codigo))
      .map((b) => {
        const linhas = ((insumoAnalise ?? []) as InsumoAnaliseRow[])
          .filter((i) => i.codigo_analise === b.codigo)
          .map((i) =>
            montarInsumoComCusto(
              i,
              i.insumo_id == null ? undefined : custoPorInsumo.get(i.insumo_id),
              fonteCustoInsumos,
            ),
          );
        const grupos = [...new Set(linhas.map((l) => l.grupo_escolha).filter(Boolean) as string[])].map((grupo) => ({
          nome: grupo,
          opcoes: linhas
            .filter((l) => l.grupo_escolha === grupo)
            .map((l) => l.especificacao_insumo)
            .filter(Boolean) as string[],
        }));
        return {
          codigo: b.codigo,
          lotePadrao: b.lote,
          etapas: ((etapas ?? []) as Etapa[]).filter(
            (e) => (e as unknown as { codigo_analise: string }).codigo_analise === b.codigo,
          ),
          equip: montarEquipamentosAlocados(
            (equipAnalise ?? []) as EquipamentoAnaliseRow[],
            b.codigo,
            custoDiaPorEquip,
            parceiros,
          ),
          insumos: linhas,
          grupos,
        };
      }),
  };
}

export async function calcularItemAnaliseOrcamento(
  codigo: string,
  numeroAmostras: number,
  cenario?: Cenario,
  fonteCustoInsumos: FonteCustoInsumos = "custo_padrao",
): Promise<BreakdownOrcamento | null> {
  const dados = await carregarSimuladorCusteio(fonteCustoInsumos);
  const analise = dados.analises.find((item) => item.codigo === codigo);
  if (!analise) return null;

  return calcularAnaliseOrcamento({
    codigo,
    etapas: analise.etapas,
    equip: analise.equip,
    insumos: analise.insumos,
    valorHoraPessoal: dados.valorHoraPessoal,
    custoHoraOverhead: dados.custoHoraOverhead,
    params: dados.params,
    numeroAmostras,
    cenario,
  });
}
