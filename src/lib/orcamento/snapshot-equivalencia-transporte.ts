import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { totalLaboratorioCusto, totalLaboratorioPreco } from "./bases-custo";

// Somente integridade do material CONGELADO. Sem catálogo, data atual ou recálculo de preço.
const versao = z.literal("equivalencia-economica-v1");
const texto = z.string().min(1).refine((v) => v.trim().length > 0);
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const valor = z.number().nonnegative();
const objeto = z.record(z.string(), z.json());
const composicao = z.object({ reagentes: valor, equipamento: valor, pessoal: valor, overhead: valor,
  custoAnalitico: valor, custoTotal: valor, preco: valor }).catchall(z.json());
const dimensao = z.object({
  necessidade_id: id, etapa_id: id.nullable(), insumo_id: id, unidade_estoque: texto, unidade_consumo: texto,
  fator_conversao: z.number().positive(), fonte_custo: texto, referencia_custo: texto,
  custo_unitario_estoque: valor, custo_unitario_consumo: valor, quantidade_consumo: z.number().positive(),
  quantidade_estoque: z.number().positive(), quantidade_total_consumo: z.number().positive(),
  quantidade_total_estoque: z.number().positive(), custo_total_insumo: valor,
  modo_cobranca: z.enum(["por_amostra", "por_execucao"]), lote: z.number().positive(),
  decisao: z.object({ codigo_analise: texto, metodo_revisao_ref: texto, necessidade_id: id, etapa_id: id.nullable(),
    insumo_id: id, apresentacao_ref: texto, decisao_ref: texto, evidencia_ref: texto,
    unidade_estoque: texto, unidade_consumo: texto, fator_conversao: z.number().positive(),
    vigente_desde: z.number(), vigente_ate: z.number().nullable(), estado: z.literal("validada"),
  }).catchall(z.json()),
}).catchall(z.json());
const rastro = z.object({ necessidade_id: id, etapa_id: id.nullable(), insumo_id: id, apresentacao_ref: texto,
  decisao_ref: texto, evidencia_ref: texto, quantidade_consumo: z.number().positive(), quantidade_estoque: z.number().positive(),
  custo_total_insumo: valor }).catchall(z.json());
const item = z.object({ codigo_analise: texto, n_amostras: id, custo_unitario: valor, preco_unitario: valor,
  valor_snapshot: z.object({ versao, metodo_revisao_ref: texto, fonte_custo_insumos: z.literal("custo_medio_ponderado"),
    lote_padrao: z.number().positive(), numero_execucoes: id, composicao, composicao_totais: composicao,
    proveniencia_dimensional: z.array(dimensao).min(1), selecao: z.array(rastro).min(1),
    fontes: z.object({ instante: z.number(), necessidades: z.array(objeto).min(1), etapas: z.array(objeto).min(1),
      parametros: objeto.refine((v) => Object.keys(v).length > 0), equipamentos: z.array(objeto),
      equipamento_dia: valor, valor_hora_pessoal: valor, custo_hora_overhead: valor }).catchall(z.json()),
  }).catchall(z.json()),
}).catchall(z.json());
const rubricas = { reagentes: valor, materiais: valor, equipamentos: valor, mao_obra: valor,
  overhead: valor, terceiros: z.literal(0), custo: valor, preco: valor };
const modulo = z.object({ id, fonte_custo_insumos: z.literal("custo_medio_ponderado"),
  orcamento_itens: z.array(item.extend({ id })).min(1).max(100),
  custo_snapshot: z.object({ versao, operacao_id: z.uuid(), gerado_em: z.iso.datetime({ offset: true }),
    fonte_custo_insumos: z.literal("custo_medio_ponderado"), itens: z.array(item).min(1).max(100),
    linhas: z.array(z.object({ codigo_analise: texto, quantidade: id, ...rubricas, lote: z.number().positive(),
      numero_execucoes: id, composicao_unitaria: composicao, proveniencia_dimensional: z.array(dimensao).min(1) }).catchall(z.json())).min(1).max(100),
    totais: z.object({ ...rubricas, amostras: id }).catchall(z.json()),
  }).catchall(z.json()),
}).catchall(z.json());
const registro = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const lista = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const marcado = (v: unknown) => typeof registro(v).versao === "string" && String(registro(v).versao).startsWith("equivalencia-economica-");
const sinal = (v: unknown) => {
  const b = registro(v); const s = registro(b.custo_snapshot);
  return marcado(s) || [...lista(b.orcamento_itens), ...lista(s.itens)].some((i) => marcado(registro(i).valor_snapshot));
};
const igual = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const invalido = () => ({ estado: "invalido" as const, message: "Snapshot de equivalência incompleto ou incoerente. Não emitir nem reconstruir com dados atuais." });
type Valido = { estado: "equivalencia"; modulo: z.infer<typeof modulo> };
export type TransporteCaptura = Valido | { estado: "legado" } | ReturnType<typeof invalido>;

/** Detecta inclusive marcador só no item: nunca reclassifica captura parcial como legado. */
export function validarTransporteCapturaEquivalencia(value: unknown): TransporteCaptura {
  if (!sinal(value)) return { estado: "legado" };
  const p = modulo.safeParse(value);
  if (!p.success) return invalido();
  const b = p.data; const s = b.custo_snapshot;
  if (b.orcamento_itens.length !== s.itens.length || s.linhas.length !== s.itens.length
    || new Set(b.orcamento_itens.map((i) => i.codigo_analise)).size !== s.itens.length
    || new Set(s.itens.map((i) => i.codigo_analise)).size !== s.itens.length
    || new Set(s.linhas.map((l) => l.codigo_analise)).size !== s.itens.length) return invalido();
  for (const i of s.itens) {
    const persistido = b.orcamento_itens.find((j) => j.codigo_analise === i.codigo_analise);
    const l = s.linhas.find((j) => j.codigo_analise === i.codigo_analise);
    const v = i.valor_snapshot; const t = v.composicao_totais; const c = v.composicao;
    if (!persistido || !l || persistido.n_amostras !== i.n_amostras || l.quantidade !== i.n_amostras
      || persistido.custo_unitario !== i.custo_unitario || persistido.preco_unitario !== i.preco_unitario
      || !isDeepStrictEqual(persistido.valor_snapshot, v) || !isDeepStrictEqual(l.composicao_unitaria, c)
      || !isDeepStrictEqual(l.proveniencia_dimensional, v.proveniencia_dimensional)
      || l.lote !== v.lote_padrao || l.numero_execucoes !== v.numero_execucoes
      || !igual(i.custo_unitario, c.custoTotal) || !igual(i.preco_unitario, c.preco)
      || Object.keys(c).some((k) => typeof c[k] === "number" && typeof t[k] === "number" && !igual(c[k] * i.n_amostras, t[k]))
      || !igual(l.custo, t.custoTotal) || !igual(l.preco, t.preco) || !igual(l.reagentes, t.reagentes)
      || !igual(l.materiais, t.reagentes) || !igual(l.equipamentos, t.equipamento)
      || !igual(l.mao_obra, t.pessoal) || !igual(l.overhead, t.overhead)
      || v.selecao.length !== v.proveniencia_dimensional.length
      || new Set(v.proveniencia_dimensional.map((d) => d.necessidade_id)).size !== v.proveniencia_dimensional.length) return invalido();
    for (const d of v.proveniencia_dimensional) {
      const r = v.selecao.find((r) => r.necessidade_id === d.necessidade_id);
      const a = d.decisao;
      if (!r || a.codigo_analise !== i.codigo_analise || a.metodo_revisao_ref !== v.metodo_revisao_ref
        || a.necessidade_id !== d.necessidade_id || a.etapa_id !== d.etapa_id || a.insumo_id !== d.insumo_id
        || a.unidade_estoque !== d.unidade_estoque || a.unidade_consumo !== d.unidade_consumo || a.fator_conversao !== d.fator_conversao
        || r.insumo_id !== d.insumo_id || r.etapa_id !== d.etapa_id || r.decisao_ref !== a.decisao_ref
        || r.evidencia_ref !== a.evidencia_ref || r.apresentacao_ref !== a.apresentacao_ref
        || !igual(d.custo_unitario_consumo, d.custo_unitario_estoque / d.fator_conversao)
        || !igual(d.quantidade_estoque, d.quantidade_consumo / d.fator_conversao)
        || !igual(d.quantidade_total_estoque, d.quantidade_total_consumo / d.fator_conversao)
        || !igual(d.custo_total_insumo, d.quantidade_total_consumo * d.custo_unitario_consumo)
        || !igual(r.quantidade_consumo, d.quantidade_total_consumo) || !igual(r.quantidade_estoque, d.quantidade_total_estoque)
        || !igual(r.custo_total_insumo, d.custo_total_insumo)) return invalido();
    }
    if (!igual(t.reagentes, v.proveniencia_dimensional.reduce((n, d) => n + d.custo_total_insumo, 0))) return invalido();
  }
  for (const k of ["reagentes", "materiais", "equipamentos", "mao_obra", "overhead", "terceiros", "custo", "preco"] as const) {
    if (!igual(s.totais[k], s.linhas.reduce((n, l) => n + l[k], 0))) return invalido();
  }
  if (s.totais.amostras !== s.itens.reduce((n, i) => n + i.n_amostras, 0)) return invalido();
  return { estado: "equivalencia", modulo: b };
}

/** Handoff para leitura da versão. Não chamar entradaDoSnapshot/fallback quando inválido.
 * Legado conserva o caminho existente. Nenhum valor atual é aceito para reparar o novo modo. */
export function validarHistoricoFinalEquivalencia(value: unknown, totalFinal: unknown) {
  const raw = registro(value); const labs = lista(raw.orcamentos_analises);
  if (!Object.hasOwn(raw, "captura_economica_versao") && !labs.some(sinal)) return { estado: "legado" as const };
  const p = z.object({
    captura_economica_versao: versao.optional(),
    demanda: z.object({ id, titulo: texto, cliente_nome: texto, modalidade: texto }).catchall(z.json()),
    empresa_emissora: z.object({ codigo: z.enum(["ATGC", "GIA"]), nome_legal: texto,
      cnpj: texto.nullable(), endereco: texto.nullable(), telefone: texto.nullable(), email: texto.nullable(), site: texto.nullable() }).catchall(z.json()),
    textos_proposta: z.object({ descricao: z.json(), secoes: z.array(z.object({ chave: texto, titulo: texto, texto: z.json() }).catchall(z.json())) }).catchall(z.json()),
    nomes_analises: z.record(z.string(), texto), orcamentos_analises: z.array(modulo).min(1),
    consolidado: z.object({ totalFinal: valor, totalLaboratorioCusto: valor, totalLaboratorioPreco: valor,
      economia: z.object({ politica: z.literal("A_GROSS_UP_TOTAL"), totalFinal: valor,
        parametros: z.array(z.object({ chave: z.enum(["impostos_legacy", "incubacao", "reserva", "investimentos", "lucro"]),
          label: texto, percentual: valor, valorNominal: valor }).catchall(z.json())).length(5)
          .refine((v) => new Set(v.map((p) => p.chave)).size === 5),
      }).catchall(z.json()),
    }).catchall(z.json()),
  }).catchall(z.json()).safeParse(value);
  if (!p.success || !valor.safeParse(totalFinal).success || typeof totalFinal !== "number") return invalido();
  const s = p.data;
  if (!igual(s.consolidado.totalFinal, totalFinal) || !igual(s.consolidado.economia.totalFinal, totalFinal)
    || s.orcamentos_analises.some((b) => validarTransporteCapturaEquivalencia(b).estado !== "equivalencia"
      || b.orcamento_itens.some((i) => !s.nomes_analises[i.codigo_analise]))) return invalido();
  // Mesma base/ordem da consolidação: Σ(unitário × amostras), depois roundMoney.
  // Somar totais capturados não é equivalente em double; o snapshot fica intacto.
  const itens = s.orcamentos_analises.flatMap((b) => b.orcamento_itens);
  if (!igual(s.consolidado.totalLaboratorioCusto, totalLaboratorioCusto(itens))
    || !igual(s.consolidado.totalLaboratorioPreco, totalLaboratorioPreco(itens))) return invalido();
  return { estado: "equivalencia" as const, snapshot: s, total: totalFinal };
}
