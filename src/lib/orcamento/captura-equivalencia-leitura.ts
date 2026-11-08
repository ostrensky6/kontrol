import "server-only";
import { z } from "zod";
import { createClientUntyped } from "@/lib/supabase/server";
import { temPermissao } from "@/lib/auth/permissao-efetiva";

const versao = "captura-economica-leitura-v1";
const texto = z.string().trim().min(1);
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const revisao = z.number().int().nonnegative().max(2147483647);
const valor = z.number().nonnegative();
const hash = z.string().regex(/^[a-f0-9]{32}$/);
const operacao = z.uuid().transform((v) => v.toLowerCase());
const contextoRef = z.string().regex(/^captura-contexto:[a-f0-9]{32}$/);
const recibo = z.strictObject({
  versao: z.literal("equivalencia-economica-v1"), operacao_id: operacao, orcamento_id: id,
  revisao_anterior: revisao, revisao_aplicada: revisao, quantidade_itens: id.max(100),
  custo_total: valor, preco_total: valor, snapshot_hash: hash, replay: z.literal(false),
});
const metodo = z.strictObject({
  metodo_revisao_ref: texto.max(160), estado_validacoes: z.enum(["disponivel", "contexto_divergente"]),
  contexto_ref: hash, tem_validacao_vigente: z.boolean(),
  referencias: z.array(z.strictObject({
    decisao_ref: texto.regex(/^equivalencia:[1-9][0-9]*$/), evidencia_ref: texto,
    necessidade_id: id, estado: z.enum(["validada", "revogada"]), vigente_desde: z.number(), vigente_ate: z.number().nullable(),
  })),
});
const contexto = z.strictObject({
  versao: z.literal(versao), estado: z.literal("contexto"), orcamento_id: id,
  demanda: z.strictObject({ id, titulo: z.string().nullable(), modalidade: z.string().nullable() }),
  modulo: z.literal("laboratorio"), revisao: revisao.nullable(), status: z.string().nullable(), status_operacional: z.string().nullable(),
  modo: z.enum(["sem_captura", "equivalencia", "inconsistente"]), edicao_legada_bloqueada: z.boolean(),
  itens: z.array(z.strictObject({
    id, codigo_analise: texto.max(100), n_amostras: z.number().nullable(),
    custo_unitario: valor.nullable(), preco_unitario: valor.nullable(), valor_snapshot: z.json(),
    metodos_documentados: z.array(metodo).max(100),
  })).max(100),
  capacidades: z.strictObject({ consultar: z.literal(true), preparar_intencao: z.boolean() }),
  referencias_documentais: z.literal("atestacao_explicita_sem_catalogo_de_revisoes"),
  fontes_economicas: z.literal("nao_verificadas"), cas_escrita: z.literal("custo_revisao"), contexto_ref: contextoRef,
  historico: z.array(z.strictObject({ operacao_id: operacao, criado_em: texto, recibo })).max(20),
  historico_total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), historico_truncado: z.boolean(),
});
const composicao = z.strictObject({ reagentes: valor, equipamento: valor, pessoal: valor, overhead: valor,
  custoAnalitico: valor, custoTotal: valor, preco: valor });
const proveniencia = z.object({
  insumo_id: id, necessidade_id: id, etapa_id: id.nullable(), unidade_estoque: texto, unidade_consumo: texto,
  fator_conversao: z.number().positive(), fonte_custo: texto, referencia_custo: texto,
  custo_unitario_estoque: valor, custo_unitario_consumo: valor, quantidade_consumo: z.number().positive(),
  quantidade_estoque: z.number().positive(), quantidade_total_consumo: z.number().positive(),
  quantidade_total_estoque: z.number().positive(), custo_total_insumo: valor,
  decisao: z.object({ decisao_ref: texto, evidencia_ref: texto, metodo_revisao_ref: texto }).catchall(z.json()),
}).catchall(z.json());
const snapshot = z.object({
  versao: z.literal("equivalencia-economica-v1"), operacao_id: operacao, gerado_em: texto,
  fonte_custo_insumos: z.literal("custo_medio_ponderado"),
  itens: z.array(z.object({ codigo_analise: texto, n_amostras: id, custo_unitario: valor, preco_unitario: valor,
    valor_snapshot: z.object({
      versao: z.literal("equivalencia-economica-v1"), metodo_revisao_ref: texto,
      fonte_custo_insumos: z.literal("custo_medio_ponderado"), lote_padrao: z.number().positive(), numero_execucoes: id,
      composicao, composicao_totais: composicao, proveniencia_dimensional: z.array(proveniencia).min(1),
      selecao: z.array(z.json()).min(1), fontes: z.record(z.string(), z.json()),
    }).catchall(z.json()),
  }).catchall(z.json())).min(1).max(100),
  linhas: z.array(z.object({ codigo_analise: texto, quantidade: id, custo: valor, preco: valor,
    proveniencia_dimensional: z.array(proveniencia).min(1) }).catchall(z.json())).min(1).max(100),
  totais: z.object({ custo: valor, preco: valor, amostras: id }).catchall(z.json()),
}).catchall(z.json());
const historico = z.strictObject({
  versao: z.literal(versao), estado: z.literal("historico"), orcamento_id: id, demanda_id: id,
  operacao_id: operacao, criado_em: texto, snapshot, recibo, hash_confere: z.literal(true),
});
const naoLocalizada = z.strictObject({ versao: z.literal(versao), estado: z.literal("nao_localizada"),
  orcamento_id: id, operacao_id: operacao });
type Falha = { versao: typeof versao; estado: "negado" | "indisponivel";
  motivo: "entrada_invalida" | "sem_permissao" | "nao_localizado" | "falha_de_leitura" | "contrato_invalido" | "limite_contexto" };
const falha = (motivo: Falha["motivo"], estado: Falha["estado"] = "indisponivel"): Falha => ({ versao, estado, motivo });
export type ContextoCaptura = z.infer<typeof contexto> & { captura_habilitada: boolean };
export type HistoricoCaptura = z.infer<typeof historico>;
export type LeituraContextoCaptura = ContextoCaptura | Falha;
export type LeituraHistoricoCaptura = HistoricoCaptura | z.infer<typeof naoLocalizada> | Falha;

async function consultar(orcamentoId: number, operacaoId: string | null): Promise<unknown> {
  for (const permissao of ["orcamentos.visualizar", "custeio.ver", "tecnicos.salario.ver"] as const) {
    if (!await temPermissao(permissao)) return falha("sem_permissao", "negado");
  }
  const db = await createClientUntyped(); // Cookie/session client; RPC revalida sessão, permissões e escopo.
  const { data, error } = await db.rpc("ler_captura_orcamento_equivalencia_v1", {
    p_orcamento_id: orcamentoId, p_operacao_id: operacaoId,
  });
  if (error) return error.code === "42501" ? falha("sem_permissao", "negado")
    : falha(error.code === "P0002" ? "nao_localizado" : "falha_de_leitura");
  return data;
}
const erroLeitura = z.strictObject({ versao: z.literal(versao), estado: z.enum(["negado", "indisponivel"]),
  motivo: z.enum(["entrada_invalida", "sem_permissao", "nao_localizado", "falha_de_leitura", "contrato_invalido", "limite_contexto"]) });
const reciboCoerente = (r: z.infer<typeof recibo>, orcamentoId: number) => r.orcamento_id === orcamentoId
  && r.revisao_aplicada === r.revisao_anterior + r.quantidade_itens;

/** Leitura atual; nunca converte ausência/erro em orçamento elegível ou custo zero.
 * preparar_intencao não é autorização, prova de custos nem CAS de todas as fontes. */
export async function lerContextoCapturaEquivalencia(orcamentoId: number): Promise<LeituraContextoCaptura> {
  if (!id.safeParse(orcamentoId).success) return falha("entrada_invalida");
  try {
    const data = await consultar(orcamentoId, null);
    const erro = erroLeitura.safeParse(data);
    if (erro.success) return erro.data;
    const parsed = contexto.safeParse(data);
    if (!parsed.success) return falha("contrato_invalido");
    const c = parsed.data;
    if (c.orcamento_id !== orcamentoId || c.edicao_legada_bloqueada !== (c.modo !== "sem_captura")
      || new Set(c.itens.map((i) => i.id)).size !== c.itens.length
      || c.itens.some((i) => new Set(i.metodos_documentados.map((m) => m.metodo_revisao_ref)).size !== i.metodos_documentados.length
        || i.metodos_documentados.some((m) => m.tem_validacao_vigente && (m.estado_validacoes !== "disponivel"
          || !m.referencias.some((r) => r.estado === "validada"))))
      || c.historico.length !== Math.min(c.historico_total, 20) || c.historico_truncado !== (c.historico_total > 20)
      || new Set(c.historico.map((h) => h.operacao_id)).size !== c.historico.length
      || c.historico.some((h) => !reciboCoerente(h.recibo, orcamentoId) || h.operacao_id !== h.recibo.operacao_id)
      || (c.capacidades.preparar_intencao && (c.revisao === null || c.itens.length === 0 || c.modo === "inconsistente"
        || new Set(c.itens.map((i) => i.codigo_analise)).size !== c.itens.length
        || c.itens.some((i) => !id.safeParse(i.n_amostras).success
          || !i.metodos_documentados.some((m) => m.estado_validacoes === "disponivel" && m.tem_validacao_vigente))))) {
      return falha("contrato_invalido");
    }
    return { ...c, captura_habilitada: process.env.KONTROL_EQUIVALENCIA_CAPTURA === "1" };
  } catch {
    return falha("falha_de_leitura");
  }
}

/** UUID + orçamento delimitam o ledger. Não consulta catálogo, loader de custos ou prévia.
 * O recibo histórico não é resultado de retry; replay continua responsabilidade da action 0163. */
export async function lerHistoricoCapturaEquivalencia(orcamentoId: number, operacaoId: string): Promise<LeituraHistoricoCaptura> {
  const input = z.object({ orcamentoId: id, operacaoId: operacao }).safeParse({ orcamentoId, operacaoId });
  if (!input.success) return falha("entrada_invalida");
  try {
    const data = await consultar(input.data.orcamentoId, input.data.operacaoId);
    const erro = erroLeitura.safeParse(data);
    if (erro.success) return erro.data;
    const parsed = z.union([historico, naoLocalizada]).safeParse(data);
    if (!parsed.success || parsed.data.orcamento_id !== orcamentoId || parsed.data.operacao_id !== input.data.operacaoId) {
      return falha("contrato_invalido");
    }
    const h = parsed.data;
    if (h.estado === "historico") {
      const s = h.snapshot;
      if (!reciboCoerente(h.recibo, orcamentoId) || h.recibo.operacao_id !== h.operacao_id || s.operacao_id !== h.operacao_id
        || s.itens.length !== h.recibo.quantidade_itens || s.linhas.length !== s.itens.length
        || new Set(s.itens.map((i) => i.codigo_analise)).size !== s.itens.length
        || s.totais.custo !== h.recibo.custo_total || s.totais.preco !== h.recibo.preco_total
        || s.itens.some((i) => !s.linhas.some((l) => l.codigo_analise === i.codigo_analise && l.quantidade === i.n_amostras))) {
        return falha("contrato_invalido");
      }
    }
    return h;
  } catch {
    return falha("falha_de_leitura");
  }
}

const intencao = z.strictObject({ versao: z.literal("equivalencia-economica-v1"), orcamento_id: id,
  revisao_esperada: revisao, operacao_id: operacao, metodos: z.record(texto.max(100), texto.max(160)) });
export type IntencaoCaptura = z.infer<typeof intencao>;
export type PreparacaoCaptura = { estado: "preparada"; contexto_ref: string; intencao: IntencaoCaptura }
  | { estado: "recusada"; motivo: "entrada_invalida" | "contexto_indisponivel" | "contexto_alterado" | "desabilitada" | "preparacao_negada" };

/** Releitura antes de preparar/submeter uma NOVA intenção. Sem escrita/UUID novo.
 * Após envio indeterminado, NÃO reprepare: repita a intenção original na action
 * capturarNovoOrcamentoEquivalencia, cujo ledger/CAS decide o replay sob lock. */
export async function prepararIntencaoCapturaEquivalencia(input: unknown): Promise<PreparacaoCaptura> {
  const p = z.strictObject({ contexto_ref: contextoRef, intencao }).safeParse(input);
  if (!p.success) return { estado: "recusada", motivo: "entrada_invalida" };
  const c = await lerContextoCapturaEquivalencia(p.data.intencao.orcamento_id);
  if (c.estado !== "contexto") return { estado: "recusada", motivo: "contexto_indisponivel" };
  if (c.contexto_ref !== p.data.contexto_ref || c.revisao !== p.data.intencao.revisao_esperada) {
    return { estado: "recusada", motivo: "contexto_alterado" };
  }
  if (!c.captura_habilitada) return { estado: "recusada", motivo: "desabilitada" };
  if (!c.capacidades.preparar_intencao || c.itens.length !== Object.keys(p.data.intencao.metodos).length
    || c.itens.some((i) => !i.metodos_documentados.some((m) => m.metodo_revisao_ref === p.data.intencao.metodos[i.codigo_analise]
      && m.estado_validacoes === "disponivel" && m.tem_validacao_vigente))) {
    return { estado: "recusada", motivo: "preparacao_negada" };
  }
  return { estado: "preparada", contexto_ref: c.contexto_ref, intencao: p.data.intencao };
}
