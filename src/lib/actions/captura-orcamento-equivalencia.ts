"use server";

import "server-only";
import { z } from "zod";
import { createClientUntyped } from "@/lib/supabase/server";
import { temPermissao } from "@/lib/auth/permissao-efetiva";

const versao = "equivalencia-economica-v1";
const inteiro = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const texto = (max: number) => z.string().trim().min(1).max(max);
const entrada = z.strictObject({
  versao: z.literal(versao), orcamento_id: inteiro.positive(), revisao_esperada: inteiro.max(2147483647),
  operacao_id: z.uuid().transform((v) => v.toLowerCase()),
  metodos: z.record(texto(100), texto(160)).refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 100),
});
const recibo = z.strictObject({
  versao: z.literal(versao), operacao_id: z.uuid(), orcamento_id: inteiro.positive(),
  revisao_anterior: inteiro, revisao_aplicada: inteiro, quantidade_itens: inteiro.positive().max(100),
  custo_total: z.number().nonnegative(), preco_total: z.number().nonnegative(),
  snapshot_hash: z.string().regex(/^[a-f0-9]{32}$/), replay: z.boolean(),
});
export type EstadoCapturaEquivalencia = {
  ok: boolean; message: string;
  motivo?: "desabilitada" | "entrada_invalida" | "negada" | "fonte_pendente" | "revisao_obsoleta"
    | "concorrencia" | "identidade_reutilizada" | "resultado_indeterminado";
  recibo?: z.infer<typeof recibo>;
};
const falha = (motivo: NonNullable<EstadoCapturaEquivalencia["motivo"]>, message: string): EstadoCapturaEquivalencia => ({ ok: false, motivo, message });
const indeterminada = () => falha("resultado_indeterminado", "Captura não confirmada. Preserve a identidade e a submissão para consultar ou repetir a mesma operação.");

/** Opt-in servidor. O consumidor fornece intenção/UUID antes de submeter;
 * preços, quantidades e snapshots vêm exclusivamente do executor transacional.
 * Não chama a prévia, não emite, não cria orçamento/projeto/plano. */
export async function capturarNovoOrcamentoEquivalencia(input: unknown): Promise<EstadoCapturaEquivalencia> {
  if (process.env.KONTROL_EQUIVALENCIA_CAPTURA !== "1") return falha("desabilitada", "A captura econômica está desabilitada.");
  const parsed = entrada.safeParse(input);
  if (!parsed.success) return falha("entrada_invalida", "Informe orçamento, revisão, métodos e identidade da operação; não envie valores calculados.");
  const p = parsed.data;
  try {
    for (const permissao of ["orcamentos.criar_editar", "custeio.ver", "tecnicos.salario.ver", "analises.ver", "insumos.ver"] as const) {
      if (!await temPermissao(permissao)) return falha("negada", "O acesso atual não permite esta captura econômica.");
    }
    const db = await createClientUntyped();
    const { data, error } = await db.rpc("capturar_orcamento_equivalencia_v1", {
      p_orcamento_id: p.orcamento_id, p_revisao_esperada: p.revisao_esperada,
      p_metodos: p.metodos, p_operacao_id: p.operacao_id,
    });
    if (error) {
      if (error.code === "42501") return falha("negada", "A sessão ou as permissões atuais não autorizam a captura.");
      if (error.code === "40001" && error.message === "CAPTURA_REVISAO_OBSOLETA") {
        return falha("revisao_obsoleta", "O orçamento mudou. Confira a revisão antes de uma nova operação.");
      }
      if (error.code === "22023" && error.message === "IDEMPOTENCY_CONFLICT") {
        return falha("identidade_reutilizada", "A identidade já pertence a outra submissão. Não altere o conteúdo de um retry.");
      }
      if (["55P03", "40001", "40P01"].includes(error.code)) return falha("concorrencia", "Uma fonte ou o orçamento está em alteração. Preserve a operação e confira o resultado antes do retry.");
      if (["22023", "22P02", "P0002", "22003", "25000"].includes(error.code)) {
        return falha("fonte_pendente", "A captura exige orçamento ainda não emitido, conjunto completo e fontes econômicas válidas. Nada foi confirmado.");
      }
      return indeterminada();
    }
    const r = recibo.safeParse(data);
    if (!r.success || r.data.operacao_id !== p.operacao_id || r.data.orcamento_id !== p.orcamento_id
      || r.data.revisao_anterior !== p.revisao_esperada
      || r.data.quantidade_itens !== Object.keys(p.metodos).length
      || r.data.revisao_aplicada !== p.revisao_esperada + r.data.quantidade_itens) return indeterminada();
    return { ok: true, message: r.data.replay ? "Captura anterior confirmada, sem novo efeito." : "Captura econômica confirmada.", recibo: r.data };
  } catch {
    return indeterminada();
  }
}
