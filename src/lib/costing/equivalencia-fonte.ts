import "server-only";
import { z } from "zod";
import { createClientUntyped } from "@/lib/supabase/server";
import type { EntradaEquivalencia } from "./equivalencia-orcamento";

const texto = z.string().trim().min(1);
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const decisao = z.strictObject({
  codigo_analise: texto,
  necessidade_id: id,
  etapa_id: id.nullable(),
  metodo_revisao_ref: texto,
  equipamento_ref: texto.nullable(),
  insumo_id: id,
  apresentacao_ref: texto,
  decisao_ref: texto,
  evidencia_ref: texto,
  validador_id: texto.regex(/^ator-decisao:[0-9a-f]{32}$/),
  papel_validador: z.enum(["laboratorio", "coordenador", "supervisor"]),
  estado: z.enum(["validada", "revogada"]),
  unidade_estoque: texto,
  unidade_consumo: texto,
  fator_conversao: z.number().positive(),
  vigente_desde: z.number(),
  vigente_ate: z.number().nullable(),
});

const envelope = z.strictObject({
  versao: z.literal("equivalencia-contextual-v1"),
  estado: z.enum(["disponivel", "contexto_divergente"]),
  instante: z.number(),
  decisoes: z.array(decisao),
});

type FonteEquivalencia =
  | ({ estado: "disponivel" } & Pick<EntradaEquivalencia, "versao" | "instante" | "decisoes">)
  | { estado: "indisponivel"; motivo: "falha_de_leitura" | "contrato_invalido" | "contexto_divergente" };

/** Somente decisões persistidas. O consumidor resolve a revisão técnica no
 * servidor e fornece necessidades, preços e lotes por fontes autorizadas. */
export async function lerFonteEquivalencia(
  codigo: string,
  metodoRevisaoRef: string,
): Promise<FonteEquivalencia> {
  const p_codigo = codigo.trim();
  const p_metodo_revisao_ref = metodoRevisaoRef.trim();
  if (!p_codigo || p_codigo.length > 100 || !p_metodo_revisao_ref || p_metodo_revisao_ref.length > 160) {
    return { estado: "indisponivel", motivo: "contrato_invalido" };
  }
  try {
    const supabase = await createClientUntyped();
    const { data, error } = await supabase.rpc("ler_equivalencia_contextual_v1", { p_codigo, p_metodo_revisao_ref });
    if (error) return { estado: "indisponivel", motivo: "falha_de_leitura" };
    const lido = envelope.safeParse(data);
    if (!lido.success || lido.data.decisoes.some((d) =>
      d.codigo_analise !== p_codigo || d.metodo_revisao_ref !== p_metodo_revisao_ref
      || (d.vigente_ate !== null && d.vigente_ate <= d.vigente_desde))) {
      return { estado: "indisponivel", motivo: "contrato_invalido" };
    }
    if (lido.data.estado === "contexto_divergente") {
      return { estado: "indisponivel", motivo: "contexto_divergente" };
    }
    const { versao, instante, decisoes } = lido.data;
    return { estado: "disponivel", versao, instante, decisoes };
  } catch {
    return { estado: "indisponivel", motivo: "falha_de_leitura" };
  }
}
