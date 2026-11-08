"use server";

import "server-only";
import { z } from "zod";
import { createClientUntyped } from "@/lib/supabase/server";

const versao = "equivalencia-escrita-v1";
const texto = (max: number) => z.string().trim().min(1).max(max);
const id = z.string().regex(/^[1-9]\d{0,15}$/).transform(Number).pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
const nulo = z.literal("").transform(() => null);
const ref = z.string().regex(/^equivalencia:[1-9]\d{0,15}$/)
  .refine((s) => Number.isSafeInteger(Number(s.slice(13))));
const revisao = z.string().regex(/^equivalencia-cas-v1:[a-f0-9]{32}$/);
const contexto = z.object({
  necessidade_id: id, etapa_id: id.or(nulo), insumo_id: id, equipamento_id: id.or(nulo),
  apresentacao_ref: texto(160), unidade_estoque: texto(160), unidade_consumo: texto(160),
  fator_conversao: z.string().trim().max(40).regex(/^\d+(?:[.,]\d+)?$/)
    .transform((n) => Number(n.replace(",", "."))).pipe(z.number().positive()),
  evidencia_ref: texto(240), confirmada: z.literal("sim").transform(() => true),
  // Sem Date.now(): um retry após a vigência deve chegar ao recibo já gravado.
  // O executor0154 verifica futuro somente na primeira aplicação real.
  vigente_ate: z.iso.datetime({ offset: true }).transform((v) => new Date(v).toISOString()).or(nulo),
});
const base = z.object({ versao: z.literal(versao), codigo_analise: texto(100), metodo_revisao_ref: texto(160) });
const revogacao = z.object({ decisao_ref: ref, motivo: texto(500) });
const operacao = z.object({ operacao_id: z.uuid().transform((s) => s.toLowerCase()), revisao_esperada: revisao });
const identidade = z.object({
  versao: z.literal(versao), acao: z.enum(["registrar", "revogar"]), codigo_analise: texto(100),
  metodo_revisao_ref: texto(160), necessidade_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const preparacao = identidade.extend({ decisao_ref: ref.nullable(), revisao_esperada: revisao, cas_escrita: z.literal(true) }).strict();
const recibo = identidade.extend({
  operacao_id: z.uuid(), ator_ref: z.string().regex(/^ator-operacao:[a-f0-9]{32}$/),
  decisao_ref: ref, estado: z.enum(["validada", "revogada"]), revisao_aplicada: revisao, replay: z.boolean(),
}).strict();
export type EstadoEquivalenciaRevisionada = {
  ok: boolean; message?: string;
  motivo?: "desabilitada" | "entrada_invalida" | "negada" | "contexto_obsoleto" | "concorrencia"
    | "identidade_reutilizada" | "resultado_indeterminado";
  preparacao?: z.infer<typeof preparacao>; recibo?: z.infer<typeof recibo>;
};
const falha = (motivo: NonNullable<EstadoEquivalenciaRevisionada["motivo"]>, message: string): EstadoEquivalenciaRevisionada => ({ ok: false, motivo, message });
const invalida = () => falha("entrada_invalida", "Confira identidade, revisão e dados da validação técnica.");
const indeterminada = () => falha("resultado_indeterminado", "Resultado não confirmado. Preserve a operação e os dados para consultar ou repetir a mesma submissão.");
function campos(form: FormData, nomes: string[]) {
  return Object.fromEntries(nomes.map((nome) => {
    const valores = form.getAll(nome);
    return [nome, valores.length === 1 ? valores[0] : undefined];
  }));
}

async function executar(form: FormData, acao: "registrar" | "revogar", preparar: boolean): Promise<EstadoEquivalenciaRevisionada> {
  if (process.env.KONTROL_EQUIVALENCIA_ESCRITA_REVISIONADA !== "1") {
    return falha("desabilitada", "A escrita revisionada de equivalências está desabilitada.");
  }
  if (!(form instanceof FormData)) return invalida();
  const b = base.safeParse(campos(form, Object.keys(base.shape)));
  const registro = acao === "registrar" ? contexto.safeParse(campos(form, Object.keys(contexto.shape))) : null;
  const revogar = acao === "revogar" ? revogacao.safeParse(campos(form, Object.keys(revogacao.shape))) : null;
  const op = preparar ? null : operacao.safeParse(campos(form, Object.keys(operacao.shape)));
  if (!b.success || (registro && !registro.success) || (revogar && !revogar.success) || (op && !op.success)) return invalida();
  const dados = registro?.success ? registro.data : revogar?.success
    ? { id: Number(revogar.data.decisao_ref.slice(13)), motivo: revogar.data.motivo } : null;
  if (!dados) return invalida();
  const comum = { p_codigo: b.data.codigo_analise, p_metodo_revisao_ref: b.data.metodo_revisao_ref };
  const rpc = preparar ? "preparar_equivalencia_revisionada_v1" : acao === "registrar"
    ? "registrar_equivalencia_revisionada_v1" : "revogar_equivalencia_revisionada_v1";
  const args = preparar ? { ...comum, p_acao: acao, p_dados: dados } : {
    ...comum, p_operacao_id: op?.success ? op.data.operacao_id : undefined,
    p_revisao_esperada: op?.success ? op.data.revisao_esperada : undefined,
    ...(registro?.success ? { p_contexto: registro.data } : revogar?.success
      ? { p_decisao_id: Number(revogar.data.decisao_ref.slice(13)), p_motivo: revogar.data.motivo } : {}),
  };
  try {
    const db = await createClientUntyped();
    const { data, error } = await db.rpc(rpc, args);
    if (error) {
      if (error.code === "42501") return falha("negada", "A sessão ou o acesso atual não permite esta operação.");
      if (error.code === "40001" && error.message === "EQUIVALENCIA_CONTEXT_STALE") {
        return falha("contexto_obsoleto", "O contexto mudou. Consulte e prepare novamente antes de uma nova submissão.");
      }
      if (error.code === "22023" && error.message === "IDEMPOTENCY_CONFLICT") {
        return falha("identidade_reutilizada", "A identidade da operação já está vinculada a outra submissão.");
      }
      if (["55P03", "40001", "40P01"].includes(error.code)) return falha("concorrencia", "Há uma operação concorrente. Preserve a identidade e confira o resultado antes de tentar novamente.");
      if (["22023", "22P02", "25000", "23505", "P0002", "55000"].includes(error.code)) return invalida();
      return indeterminada();
    }
    const resposta = preparar ? preparacao.safeParse(data) : recibo.safeParse(data);
    if (!resposta.success) return indeterminada();
    const r = resposta.data;
    if (r.acao !== acao || r.codigo_analise !== b.data.codigo_analise || r.metodo_revisao_ref !== b.data.metodo_revisao_ref
      || (registro?.success && r.necessidade_id !== registro.data.necessidade_id)
      || (revogar?.success && r.decisao_ref !== revogar.data.decisao_ref)) return indeterminada();
    if (preparar) {
      const p = preparacao.parse(r);
      if (acao === "registrar" && p.decisao_ref !== null) return indeterminada();
      return { ok: true, message: "Contexto preparado. Nenhuma decisão foi gravada.", preparacao: p };
    }
    const c = recibo.parse(r);
    if (!op?.success || c.operacao_id !== op.data.operacao_id || c.revisao_aplicada !== op.data.revisao_esperada
      || c.estado !== (acao === "registrar" ? "validada" : "revogada")) return indeterminada();
    return { ok: true, message: c.replay ? "Operação anterior confirmada, sem novo efeito. Atualize a consulta do estado atual."
      : acao === "registrar" ? "Validação técnica registrada." : "Validação técnica revogada.", recibo: c };
  } catch {
    return indeterminada();
  }
}

/** Preparar usa a intenção completa; qualquer edição posterior exige nova preparação.
 * UUID nasce no consumidor antes do submit e permanece estável em retries. */
export async function prepararEquivalenciaRevisionada(_estado: EstadoEquivalenciaRevisionada, form: FormData) {
  if (!(form instanceof FormData)) return invalida();
  const acao = z.enum(["registrar", "revogar"]).safeParse(campos(form, ["acao"]).acao);
  return acao.success ? executar(form, acao.data, true) : invalida();
}
export async function registrarEquivalenciaRevisionada(_estado: EstadoEquivalenciaRevisionada, form: FormData) {
  return executar(form, "registrar", false);
}
export async function revogarEquivalenciaRevisionada(_estado: EstadoEquivalenciaRevisionada, form: FormData) {
  return executar(form, "revogar", false);
}
