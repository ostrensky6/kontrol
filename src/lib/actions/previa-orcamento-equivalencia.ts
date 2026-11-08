"use server";

import "server-only";
import { z } from "zod";
import { createClientUntyped } from "@/lib/supabase/server";
import { temPermissao } from "@/lib/auth/permissao-efetiva";
import { lerFonteEquivalencia } from "@/lib/costing/equivalencia-fonte";
import { calcularOrcamentoEquivalencia, type EntradaEquivalencia } from "@/lib/costing/equivalencia-orcamento";
import { equipCustoDia, type Parametros } from "@/lib/costing/engine";

const versao = "equivalencia-contextual-v1";
const texto = z.string().trim().min(1);
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const valor = z.number().nonnegative();
const entrada = z.strictObject({
  codigo_analise: texto.max(100), numero_amostras: id, metodo_revisao_ref: texto.max(160),
});
const etapaSchema = z.object({
  id, codigo_analise: texto, nome_etapa: texto, nome_atividade: texto,
  escopo_operacional: texto.nullable(), execucoes_por_dia: id, amostras_por_execucao: id,
  tempo_maquina_h: valor, tempo_bancada_h: valor,
});
const necessidadeSchema = z.object({
  id, codigo_analise: texto, etapa_id: id.nullable(), unidade: texto,
  quantidade_por_amostra: z.number().positive(), modo_cobranca: z.enum(["por_amostra", "por_execucao"]),
  base_calculo: texto.nullable(), grupo_escolha: z.string().nullable(),
});
const insumoSchema = z.object({
  id, ativo: z.literal(true), unidade: texto, unidade_consumo: texto, fator_conversao: z.number().positive(),
});
const custoSchema = z.object({
  insumo_id: id, custo_padrao: valor.nullable(), custo_medio_ponderado: valor.nullable(),
  unidade_estoque: texto, unidade_consumo: texto, fator_conversao: z.number().positive(),
  custo_origem: valor.nullable(), fonte_custo: texto, referencia_custo: texto.nullable(),
});
const equipamentoSchema = z.object({
  id, quantidade: z.number().positive(), custo_unitario: valor, vida_util_anos: z.number().positive(),
  percentual_manutencao_anual: valor.nullable(), manutencao_anual_fixa: valor.nullable(),
}).refine((e) => e.percentual_manutencao_anual !== null || e.manutencao_anual_fixa !== null);

const pendente = (motivo: string, fonte?: string) => ({
  versao, estado: "pendente" as const, pendencias: [{ motivo, ...(fonte ? { fonte } : {}) }],
});

// A contagem impede tratar página truncada como conjunto completo/ausência.
async function linhas<T extends z.ZodType>(
  query: PromiseLike<{ data: unknown; error: unknown; count: number | null }>, schema: T,
): Promise<z.output<T>[]> {
  const result = await query;
  if (result.error || !Array.isArray(result.data) || result.count !== result.data.length) {
    throw new Error("Leitura incompleta");
  }
  return z.array(schema).parse(result.data);
}

/** Prévia de NOVO orçamento, nunca replay ou recibo de gravação. Nenhum valor
 * econômico, decisão técnica, ator ou vínculo fornecido pelo cliente é aceito.
 * A revisão documental é seletor explícito, provado pela fonte 0154 (não pelo nome).
 */
export async function previaNovoOrcamentoEquivalencia(input: unknown) {
  if (process.env.KONTROL_EQUIVALENCIA_PREVIA !== "1") return pendente("desabilitada");
  const parsed = entrada.safeParse(input);
  if (!parsed.success) return pendente("entrada_invalida");
  const { codigo_analise: codigo, numero_amostras, metodo_revisao_ref } = parsed.data;
  let fonteAtual = "permissoes";
  try {
    // A prévia devolve PE agregado: não contorna sua proteção na interface.
    for (const permissao of ["orcamentos.criar_editar", "custeio.ver", "tecnicos.salario.ver"] as const) {
      if (!await temPermissao(permissao)) return pendente("sem_permissao");
    }
    fonteAtual = "equivalencia_0154";
    const fonte = await lerFonteEquivalencia(codigo, metodo_revisao_ref);
    if (fonte.estado !== "disponivel") return pendente(fonte.motivo, fonteAtual);
    const db = await createClientUntyped();
    fonteAtual = "analises";
    const analises = await linhas(db.from("analises").select("codigo, ativo, ofertavel", { count: "exact" })
      .eq("codigo", codigo), z.object({ codigo: texto, ativo: z.literal(true), ofertavel: z.literal(true) }));
    if (analises.length !== 1 || analises[0].codigo !== codigo) return pendente("analise_indisponivel");
    fonteAtual = "insumo_analise";
    const receita = await linhas(db.from("insumo_analise").select(
      "id, codigo_analise, etapa_id, unidade, quantidade_por_amostra, modo_cobranca, base_calculo, grupo_escolha",
      { count: "exact" },
    ).eq("codigo_analise", codigo), necessidadeSchema);
    if (!receita.length) return pendente("receita_nao_comprovada");
    // Grupo legado não prova identidade de necessidade; não somar alternativas como necessidades.
    if (receita.some((n) => n.codigo_analise !== codigo || n.grupo_escolha?.trim()
      || (n.base_calculo !== null && n.base_calculo !== n.modo_cobranca))) {
      return pendente("base_ou_agrupamento_nao_comprovado");
    }
    fonteAtual = "etapas";
    const etapas = await linhas(db.from("etapas").select(
      "id, codigo_analise, nome_etapa, nome_atividade, escopo_operacional, execucoes_por_dia, amostras_por_execucao, tempo_maquina_h, tempo_bancada_h",
      { count: "exact" },
    ).eq("codigo_analise", codigo), etapaSchema);
    if (!etapas.length || etapas.some((e) => e.codigo_analise !== codigo)
      || new Set(etapas.map((e) => e.id)).size !== etapas.length) return pendente("lote_nao_comprovado");

    fonteAtual = "parametros";
    const chaves = ["dias_uteis_ano", "margem_lucro", "impostos", "taxas", "fundo_reserva", "fundo_investimento"] as const;
    const parametros = await linhas(db.from("parametros").select("chave, valor", { count: "exact" })
      .in("chave", [...chaves]), z.object({ chave: z.enum(chaves), valor }));
    if (parametros.length !== chaves.length || new Set(parametros.map((p) => p.chave)).size !== chaves.length) {
      return pendente("parametros_incompletos");
    }
    const params = Object.fromEntries(parametros.map((p) => [p.chave, p.valor])) as Parametros;
    if (params.dias_uteis_ano <= 0) return pendente("parametros_incompletos");
    fonteAtual = "valor_hora_pessoal_total";
    const pessoal = await db.rpc("valor_hora_pessoal_total");
    if (pessoal.error) return pendente("falha_de_leitura", fonteAtual);
    const valorHoraPessoal = valor.parse(pessoal.data);
    fonteAtual = "overhead";
    const overhead = await linhas(db.from("overhead").select(
      "custo_mensal, horas_bancada_mes, percentual_compensada", { count: "exact" },
    ), z.object({ custo_mensal: valor, horas_bancada_mes: z.number().positive(), percentual_compensada: valor.max(100) }));
    const custoHoraOverhead = overhead.reduce((s, o) => s + o.custo_mensal / o.horas_bancada_mes * o.percentual_compensada / 100, 0);
    fonteAtual = "equipamento_analise";
    const alocacoes = await linhas(db.from("equipamento_analise").select(
      "codigo_analise, equipamento_id, peso_alocacao", { count: "exact" },
    ).eq("codigo_analise", codigo), z.object({ codigo_analise: texto, equipamento_id: id, peso_alocacao: z.number().positive() }));
    if (alocacoes.some((a) => a.codigo_analise !== codigo)
      || new Set(alocacoes.map((a) => a.equipamento_id)).size !== alocacoes.length) return pendente("equipamento_nao_comprovado");
    fonteAtual = "equipamentos";
    const equipamentos = alocacoes.length ? await linhas(db.from("equipamentos").select(
      "id, quantidade, custo_unitario, vida_util_anos, percentual_manutencao_anual, manutencao_anual_fixa", { count: "exact" },
    ).in("id", alocacoes.map((a) => a.equipamento_id)), equipamentoSchema) : [];
    const equip: EntradaEquivalencia["equip"] = [];
    for (const a of alocacoes) {
      const encontrados = equipamentos.filter((e) => e.id === a.equipamento_id);
      if (encontrados.length !== 1) return pendente("equipamento_nao_comprovado");
      equip.push({ peso: a.peso_alocacao, custoDia: equipCustoDia(encontrados[0], params.dias_uteis_ano) });
    }

    const ativas = fonte.decisoes.filter((d) => d.estado === "validada" && d.vigente_desde <= fonte.instante
      && (d.vigente_ate === null || d.vigente_ate > fonte.instante));
    if (ativas.some((d) => !receita.some((n) => n.id === d.necessidade_id && n.etapa_id === d.etapa_id))) {
      return pendente("necessidade_nao_comprovada");
    }
    const ids = [...new Set(ativas.map((d) => d.insumo_id))];
    fonteAtual = "insumos";
    const insumos = ids.length ? await linhas(db.from("insumos").select(
      "id, ativo, unidade, unidade_consumo, fator_conversao", { count: "exact" },
    ).in("id", ids), insumoSchema) : [];
    fonteAtual = "v_custo_estoque_vigente";
    const custos = ids.length ? await linhas(db.from("v_custo_estoque_vigente").select(
      "insumo_id, custo_padrao, custo_medio_ponderado, unidade_estoque, unidade_consumo, fator_conversao, custo_origem, fonte_custo, referencia_custo",
      { count: "exact" },
    ).in("insumo_id", ids), custoSchema) : [];
    const necessidades: EntradaEquivalencia["necessidades"] = [];
    for (const n of receita) {
      const decisoes = ativas.filter((d) => d.necessidade_id === n.id && d.etapa_id === n.etapa_id);
      const contextos = [...new Set(decisoes.map((d) => d.equipamento_ref))];
      if (!contextos.length) return pendente("sem_validacao_ativa");
      if (contextos.length !== 1) return pendente("contexto_equipamento_ambiguo");
      const equipamento_ref = contextos[0];
      if (equipamento_ref !== null && !alocacoes.some((a) => equipamento_ref === `equipamento:${a.equipamento_id}`)) {
        return pendente("equipamento_nao_comprovado");
      }
      const alternativas: EntradaEquivalencia["necessidades"][number]["alternativas"] = [];
      for (const d of decisoes) {
        const encontrados = insumos.filter((i) => i.id === d.insumo_id);
        const precos = custos.filter((c) => c.insumo_id === d.insumo_id);
        if (encontrados.length !== 1 || precos.length !== 1) return pendente("sku_ou_preco_nao_comprovado");
        const [i] = encontrados;
        const [c] = precos;
        if (i.unidade !== c.unidade_estoque || i.unidade_consumo !== c.unidade_consumo
          || i.fator_conversao !== c.fator_conversao) return pendente("dimensao_nao_comprovada");
        // Política da view 0101: média vigente; fallback padrão identificado.
        // Zero só quando explicitamente cadastrado, nunca null convertido em zero.
        const bruto = c.custo_medio_ponderado ?? c.custo_padrao;
        const fonteCusto = c.custo_medio_ponderado !== null ? "custo_medio_ponderado" : "custo_padrao_fallback";
        const referencia = c.custo_medio_ponderado !== null ? "lotes_estoque_liberados" : `insumos:${i.id}`;
        const zeroPadrao = c.custo_medio_ponderado === null && c.custo_padrao === 0;
        if (bruto === null || (!zeroPadrao && (c.custo_origem !== bruto || c.fonte_custo !== fonteCusto
          || c.referencia_custo !== referencia))) return pendente("preco_nao_comprovado");
        alternativas.push({ insumo_id: i.id, apresentacao_ref: d.apresentacao_ref,
          unidade_estoque: i.unidade, unidade_consumo: i.unidade_consumo, fator_conversao: i.fator_conversao,
          custo_unitario_estoque: bruto, fonte_custo: fonteCusto, referencia_custo: referencia });
      }
      necessidades.push({ id: n.id, etapa_id: n.etapa_id, equipamento_ref,
        quantidade_por_base: n.quantidade_por_amostra, modo_cobranca: n.modo_cobranca,
        unidade_consumo: n.unidade, alternativas });
    }
    fonteAtual = "revalidacao_0154";
    const atual = await lerFonteEquivalencia(codigo, metodo_revisao_ref);
    if (atual.estado !== "disponivel" || JSON.stringify(atual.decisoes) !== JSON.stringify(fonte.decisoes)) {
      return pendente("contexto_alterado_durante_previa");
    }
    const resultado = calcularOrcamentoEquivalencia({
      versao, codigo, numeroAmostras: numero_amostras, metodo_revisao_ref, instante: atual.instante,
      decisoes: atual.decisoes, necessidades, etapas, equip, params, valorHoraPessoal, custoHoraOverhead,
    });
    return { ...resultado, finalidade: "previa_novo_orcamento" as const,
      metodo_revisao_ref, instante: atual.instante, persistivel: false as const };
  } catch {
    return pendente("fonte_incompleta", fonteAtual);
  }
}
