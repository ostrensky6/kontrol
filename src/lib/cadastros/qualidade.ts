import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * O que falta nos cadastros e pode distorcer custo, planejamento, compra ou
 * proposta. A tela Qualidade dos cadastros lista; a entrada de Cadastros mostra
 * só o total (revisão de 11/11, L8). As duas usam esta mesma leitura.
 */
export type ReceitaInsumo = {
  id: number;
  codigo_analise: string;
  especificacao_insumo: string | null;
  quantidade_por_amostra: number | null;
  insumo_id: number | null;
};

export type InsumoQualidade = {
  id: number;
  especificacao: string;
  unidade: string | null;
  unidade_consumo: string | null;
  fator_conversao: number | null;
  custo_unitario: number | null;
  fornecedor_id: number | null;
};

export type LoteQualidade = {
  id: number;
  codigo_lote: string | null;
  status: string;
  validade: string | null;
  validade_apos_abertura: string | null;
  insumos: { especificacao: string | null } | { especificacao: string | null }[] | null;
};

export type AnaliseQualidade = { codigo: string; ativo: boolean; ofertavel: boolean };
type ItemOrcamento = { codigo_analise: string | null };

export async function lerQualidadeDosCadastros(supabase: SupabaseClient) {
  const leituras = await Promise.all([
    supabase
      .from("insumo_analise")
      .select("id, codigo_analise, especificacao_insumo, quantidade_por_amostra, insumo_id")
      .gt("quantidade_por_amostra", 0),
    supabase
      .from("insumos")
      .select("id, especificacao, unidade, unidade_consumo, fator_conversao, custo_unitario, fornecedor_id")
      .order("especificacao"),
    supabase
      .from("lotes_estoque")
      .select("id, codigo_lote, status, validade, validade_apos_abertura, insumos(especificacao)")
      .not("status", "in", "(consumido,descartado)"),
    supabase.from("analises").select("codigo, ativo, ofertavel").order("codigo"),
    supabase.from("orcamento_itens").select("codigo_analise"),
  ]);
  const [
    { data: receitasRaw },
    { data: insumosRaw },
    { data: lotesRaw },
    { data: analisesRaw },
    { data: itensOrcamentoRaw },
  ] = leituras;
  // leitura que falhou não vira "0 pendências": quem chama mostra "sem dado"
  const incompleto = leituras.some((leitura) => Boolean(leitura.error));

  const receitas = (receitasRaw ?? []) as ReceitaInsumo[];
  const insumos = (insumosRaw ?? []) as InsumoQualidade[];
  const lotes = (lotesRaw ?? []) as unknown as LoteQualidade[];
  const analises = (analisesRaw ?? []) as AnaliseQualidade[];
  const itensOrcamento = (itensOrcamentoRaw ?? []) as ItemOrcamento[];

  const receitasSemInsumo = receitas.filter((linha) => !linha.insumo_id);
  const insumosSemCusto = insumos.filter((insumo) => !(Number(insumo.custo_unitario) > 0));
  const insumosSemUnidade = insumos.filter((insumo) =>
    !insumo.unidade || !insumo.unidade_consumo || !(Number(insumo.fator_conversao) > 0),
  );
  const insumosSemFornecedor = insumos.filter((insumo) => !insumo.fornecedor_id);
  const lotesSemValidade = lotes.filter((lote) => !lote.validade && !lote.validade_apos_abertura);
  const codigosEmOrcamento = new Set(itensOrcamento.map((item) => item.codigo_analise).filter(Boolean));
  const analisesIndisponiveisEmOrcamento = analises.filter((analise) =>
    codigosEmOrcamento.has(analise.codigo) && (!analise.ativo || !analise.ofertavel),
  );
  const pendencias = [
    receitasSemInsumo.length,
    insumosSemCusto.length,
    insumosSemUnidade.length,
    insumosSemFornecedor.length,
    lotesSemValidade.length,
    analisesIndisponiveisEmOrcamento.length,
  ].reduce((total, quantidade) => total + quantidade, 0);

  return {
    receitasSemInsumo,
    insumosSemCusto,
    insumosSemUnidade,
    insumosSemFornecedor,
    lotesSemValidade,
    analisesIndisponiveisEmOrcamento,
    pendencias,
    incompleto,
  };
}

/** Só o total, sem derrubar a tela que chama: falha de leitura devolve null ("sem dado"). */
export async function contarPendenciasDeQualidade(supabase: SupabaseClient): Promise<number | null> {
  try {
    const qualidade = await lerQualidadeDosCadastros(supabase);
    return qualidade.incompleto ? null : qualidade.pendencias;
  } catch {
    return null;
  }
}
