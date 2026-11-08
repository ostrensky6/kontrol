import "server-only";
import { z } from "zod";
import { createClientUntyped } from "@/lib/supabase/server";

const versao = "equivalencia-contexto-autorizado-v1";
const texto = z.string().trim().min(1);
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const candidato = z.strictObject({
  insumo_id: id, especificacao: z.string(), fabricante: z.string().nullable(),
  codigo_fabricante: z.string().nullable(), codigo_interno: z.string().nullable(),
  quantidade_embalagem: z.number().nullable(), unidade_estoque: texto,
  unidade_consumo: texto, fator_conversao: z.number().positive(),
});
const necessidade = z.strictObject({
  necessidade_id: id, etapa_id: id.nullable(), nome_etapa: z.string().nullable(), nome_atividade: z.string().nullable(),
  unidade_consumo: z.string().nullable(), quantidade_por_base: z.number().nullable(),
  modo_cobranca: z.string().nullable(), base_calculo: z.string().nullable(), insumo_receita_id: id.nullable(),
  etapa_contexto: z.strictObject({ amostras_por_execucao: z.number().nullable(),
    execucoes_por_dia: z.number().nullable(), escopo_operacional: z.string().nullable() }).nullable(),
  candidatos: z.array(candidato).max(200),
});
const decisao = z.strictObject({
  decisao_ref: texto.regex(/^equivalencia:[1-9][0-9]*$/), necessidade_id: id,
  etapa_id: id.nullable(), insumo_id: id, equipamento_id: id.nullable(),
  apresentacao_ref: texto, evidencia_ref: texto, unidade_estoque: texto, unidade_consumo: texto,
  fator_conversao: z.number().positive(), vigente_desde: z.number(), vigente_ate: z.number().nullable(),
  estado: z.enum(["validada", "revogada"]), pode_revogar: z.boolean(),
});
const contexto = z.strictObject({
  versao: z.literal(versao), estado: z.literal("disponivel"), codigo_analise: texto, metodo_revisao_ref: texto,
  estado_validacoes: z.enum(["disponivel", "contexto_divergente"]), instante: z.number(),
  revisao_contexto: texto.regex(/^contexto:[a-f0-9]{32}$/),
  capacidades: z.strictObject({ consultar: z.literal(true), registrar: z.boolean(), revogar: z.boolean() }),
  necessidades: z.array(necessidade).max(100),
  equipamentos: z.array(z.strictObject({ equipamento_id: id, nome: z.string() })).max(100),
  decisoes: z.array(decisao).max(200),
  referencias_documentais: z.literal("atestacao_explicita_sem_catalogo_de_revisoes"),
  candidatos_sao_equivalencias: z.literal(false), cas_escrita: z.literal(false),
});
const indisponivel = z.strictObject({ versao: z.literal(versao), estado: z.literal("indisponivel"), motivo: z.literal("limite_contexto") });
type Falha = { versao: typeof versao; estado: "negado" | "indisponivel";
  motivo: "entrada_invalida" | "sem_permissao" | "falha_de_leitura" | "contrato_invalido" | "limite_contexto" };
export type ContextoEquivalencia = z.infer<typeof contexto> | Falha;

/** Leitura cookie-bound da 0160. Capacidade não é token de autorização nem CAS.
 * Não ativa a escrita 116; referências documentais continuam sendo atestações
 * explícitas, e candidatos dimensionais não são decisões de equivalência.
 */
export async function lerContextoEquivalencia(codigo: string, metodo: string): Promise<ContextoEquivalencia> {
  const input = z.object({ codigo: texto.max(100), metodo: texto.max(160) }).safeParse({ codigo, metodo });
  const falha = (motivo: Falha["motivo"], estado: Falha["estado"] = "indisponivel"): Falha => ({ versao, estado, motivo });
  if (!input.success) return falha("entrada_invalida");
  try {
    const db = await createClientUntyped();
    const { data, error } = await db.rpc("ler_equivalencia_contexto_autorizado_v1", {
      p_codigo: input.data.codigo, p_metodo_revisao_ref: input.data.metodo,
    });
    if (error) return error.code === "42501" ? falha("sem_permissao", "negado") : falha("falha_de_leitura");
    const limite = indisponivel.safeParse(data);
    if (limite.success) return limite.data;
    const parsed = contexto.safeParse(data);
    if (!parsed.success) return falha("contrato_invalido");
    const c = parsed.data;
    if (c.codigo_analise !== input.data.codigo || c.metodo_revisao_ref !== input.data.metodo
      || new Set(c.necessidades.map((n) => n.necessidade_id)).size !== c.necessidades.length
      || new Set(c.equipamentos.map((e) => e.equipamento_id)).size !== c.equipamentos.length
      || new Set(c.decisoes.map((d) => d.decisao_ref)).size !== c.decisoes.length
      || c.decisoes.some((d) => d.pode_revogar !== (c.capacidades.revogar && d.estado === "validada")
        || (d.vigente_ate !== null && d.vigente_ate <= d.vigente_desde))
      || c.necessidades.some((n) => new Set(n.candidatos.map((a) => a.insumo_id)).size !== n.candidatos.length
        || n.candidatos.some((a) => a.unidade_consumo !== n.unidade_consumo))) {
      return falha("contrato_invalido");
    }
    return c;
  } catch {
    return falha("falha_de_leitura");
  }
}
