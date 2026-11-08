"use server";

import { z } from "zod";
import { unstable_rethrow } from "next/navigation";
import { createClientUntyped } from "@/lib/supabase/server";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const numero = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positivo = numero.refine((v) => v > 0);
const uuid = z.string().regex(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
const texto = z.string().refine((v) => v.trim().length > 0 && !v.includes("\0"));
const mes = z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])-01$/);
const timestamp = z.string().refine((v) => /(?:Z|[+-]\d{2}:\d{2})$/i.test(v) && Number.isFinite(Date.parse(v)));
const parametros = z.object({
  inicio: mes, fuso: z.literal("America/Sao_Paulo"), janela: z.number().int().min(1).max(120),
  minimo_n: z.number().int().min(1).max(120),
  comparabilidade: z.literal("mes_civil_integral_sem_ruptura_mesma_apresentacao"),
  conteudo: positivo, unidade: texto, unidade_consumo: texto, fator: positivo,
}).strict().refine((v) => v.minimo_n <= v.janela);
const configuracao = parametros.safeExtend({ id, insumo_id: id, registrado_em: timestamp });
const avaliacao = z.object({
  configuracao: configuracao.nullable(),
  estado: z.enum(["sem_leitura_comparavel", "media_insuficiente", "alta_pendente_execucao", "calculado", "reavaliacao"]),
  qualidade: z.enum(["sem_leitura_comparavel", "media_insuficiente", "alta"]),
  n: z.number().int().min(0).max(120), media_embalagens_mes: numero.nullable(),
  meses: z.array(z.object({ mes, revisao: id.nullable(), comparavel: z.boolean(), quantidade: numero.nullable(), motivo: texto }).strict()).max(120),
  // A prova histórica completa não é necessária ao Saldo: não a reenviar como leitura atual.
  transicao: z.object({ insumo_id: id, registrado_em: timestamp }).nullable(),
});
const manual = z.object({
  insumo_id: id, revisao: id, quantidade_embalagens_mes: numero, conteudo_embalagem: positivo,
  unidade_conteudo: texto, fonte: texto, motivo: texto, data_referencia: z.string(),
  ator_id: uuid, registrado_em: timestamp,
});
const capacidades = z.object({ configurar: z.boolean(), certificar: z.boolean(), executar: z.boolean(), governanca: z.boolean() }).strict();
const leitura = avaliacao.extend({ manual_vigente: manual.nullable(), capacidades });
const correlacao = { operacao_id: uuid, ator_id: uuid, repetida: z.boolean(), estado_historico: z.boolean() };
const recibo = avaliacao.extend({ ...correlacao, insumo_id: id, acao: z.enum(["configurar", "certificar", "executar"]) });
const governanca = z.object({ ...correlacao, insumo_id: z.null(), acao: z.literal("governanca"), estado: z.literal("politica_registrada") }).strict();
const identidade = { operacao_id: uuid, insumo_id: id };
const operacao = z.discriminatedUnion("acao", [
  z.object({ ...identidade, acao: z.literal("configurar"), dados: parametros }).strict(),
  z.object({ ...identidade, acao: z.literal("certificar"), dados: z.object({
    mes, cobertura_integral: z.boolean(), sem_ruptura: z.boolean(),
    prova_sha256: z.string().regex(/^[a-f0-9]{64}$/), prova_referencia: texto.refine((v) => [...v.trim()].length <= 500),
  }).strict() }).strict(),
  z.object({ ...identidade, acao: z.literal("executar"), dados: z.object({}).strict() }).strict(),
  z.object({ operacao_id: uuid, insumo_id: z.null(), insumo_leitura_id: id, acao: z.literal("governanca"), dados: z.object({
    papel: z.enum(["laboratorio", "compra", "cadastro", "coordenador", "gestor", "supervisor", "admin"]),
    acao: z.enum(["configurar", "certificar", "executar"]), permitido: z.boolean(),
    motivo: texto.refine((v) => [...v.trim()].length <= 500),
  }).strict() }).strict(),
]);

type Falha = { ok: false; codigo: "ENTRADA_INVALIDA" | "ESCRITA_DESABILITADA" | "SESSAO_INVALIDA" | "SEM_ACESSO" | "RESPOSTA_INVALIDA" | "NAO_CONFIRMADO"; message: string };
function falha(codigo: Falha["codigo"]): Falha {
  return { ok: false, codigo, message: "Operação não confirmada. Consulte o estado atual; não presuma sucesso ou rollback." };
}
type Cliente = Awaited<ReturnType<typeof createClientUntyped>>;
async function sessao(client: Cliente) {
  const { data, error } = await client.auth.getUser();
  const ator = uuid.safeParse(data?.user?.id);
  return !error && ator.success ? ator.data.toLowerCase() : null;
}
function coerente(v: z.infer<typeof avaliacao>, insumo: number) {
  const c = v.configuracao;
  if ((c && c.insumo_id !== insumo) || (v.transicao && v.transicao.insumo_id !== insumo)) return false;
  const comparaveis = v.meses.filter((m) => m.comparavel);
  if (new Set(v.meses.map((m) => m.mes)).size !== v.meses.length || comparaveis.length !== v.n
    || v.meses.some((m) => m.comparavel ? m.revisao === null || m.quantidade === null : m.quantidade !== null)) return false;
  if (!c && (v.n !== 0 || v.meses.length !== 0)) return false;
  if ((v.n === 0) !== (v.media_embalagens_mes === null)) return false;
  const qualidade = v.n === 0 ? "sem_leitura_comparavel" : c && v.n < c.minimo_n ? "media_insuficiente" : "alta";
  const estado = v.transicao ? qualidade === "alta" ? "calculado" : "reavaliacao"
    : qualidade === "alta" ? "alta_pendente_execucao" : qualidade;
  return qualidade === v.qualidade && estado === v.estado;
}
export type LeituraConsumoMensal = Falha | {
  ok: true; atual: z.infer<typeof leitura>; configuracao_estado: "AUSENTE" | "CONFIGURADA";
  escrita_habilitada: boolean;
  natureza_prova: "DECLARACAO_HUMANA_NAO_VERIFICADA_AUTOMATICAMENTE";
};
async function ler(client: Cliente, insumo: number): Promise<LeituraConsumoMensal> {
  const { data, error } = await client.rpc("ler_consumo_mensal_insumo", { p_insumo_id: insumo });
  if (error) return falha(error.code === "42501" ? "SEM_ACESSO" : "NAO_CONFIRMADO");
  const v = leitura.safeParse(data);
  if (!v.success || !coerente(v.data, insumo) || (v.data.manual_vigente && v.data.manual_vigente.insumo_id !== insumo)) return falha("RESPOSTA_INVALIDA");
  return { ok: true, atual: v.data, configuracao_estado: v.data.configuracao === null ? "AUSENTE" : "CONFIGURADA",
    escrita_habilitada: process.env.KONTROL_CONSUMO_MENSAL_ESCRITA_HABILITADA === "1",
    natureza_prova: "DECLARACAO_HUMANA_NAO_VERIFICADA_AUTOMATICAMENTE" };
}
export async function lerConsumoMensal(insumoId: unknown): Promise<LeituraConsumoMensal> {
  if (!id.safeParse(insumoId).success) return falha("ENTRADA_INVALIDA");
  try {
    const client = await createClientUntyped();
    if (!await sessao(client)) return falha("SESSAO_INVALIDA");
    return await ler(client, insumoId as number);
  } catch (error) { unstable_rethrow(error); return falha("NAO_CONFIRMADO"); }
}

export type EntradaConsumoMensal = z.infer<typeof operacao>;
export type ReciboConsumoMensal = z.infer<typeof recibo> | z.infer<typeof governanca>;
export type OperacaoConsumoMensal = Falha | (Falha & { atual: LeituraConsumoMensal }) | {
  ok: true; estado: "RECIBO_CONFIRMADO"; recibo: ReciboConsumoMensal; atual: LeituraConsumoMensal;
};
/** UUID é fornecido e preservado para replay explícito. Nenhum retry automático.
 * Capacidades são fotografia, não token: a RPC revalida autorização sob locks.
 * Governança usa insumo_leitura_id só para reler o Saldo; p_insumo_id continua null.
 * SHA/ref são declaração humana; qualidade alta não é telemetria nem validação documental.
 */
export async function operarConsumoMensal(input: unknown): Promise<OperacaoConsumoMensal> {
  if (process.env.KONTROL_CONSUMO_MENSAL_ESCRITA_HABILITADA !== "1") return falha("ESCRITA_DESABILITADA");
  const p = operacao.safeParse(input);
  if (!p.success) return falha("ENTRADA_INVALIDA");
  try {
    const client = await createClientUntyped();
    const ator = await sessao(client);
    if (!ator) return falha("SESSAO_INVALIDA");
    const { data, error } = await client.rpc("operar_consumo_mensal_insumo", {
      p_insumo_id: p.data.insumo_id, p_operacao_id: p.data.operacao_id,
      p_acao: p.data.acao, p_dados: p.data.dados,
    });
    if (error) return falha(error.code === "42501" ? "SEM_ACESSO" : "NAO_CONFIRMADO");
    const historico = p.data.acao === "governanca" ? governanca.safeParse(data) : recibo.safeParse(data);
    const valido = historico.success && historico.data.operacao_id.toLowerCase() === p.data.operacao_id.toLowerCase()
      && historico.data.ator_id.toLowerCase() === ator && historico.data.acao === p.data.acao
      && historico.data.insumo_id === p.data.insumo_id && historico.data.repetida === historico.data.estado_historico
      && (p.data.insumo_id === null ||
      ("configuracao" in historico.data && coerente(historico.data, p.data.insumo_id)));
    // Leitura atual independente também quando o recibo é repetido ou inválido.
    let atual: LeituraConsumoMensal;
    const insumoLeitura = p.data.acao === "governanca" ? p.data.insumo_leitura_id : p.data.insumo_id;
    try { atual = await ler(client, insumoLeitura); }
    catch (error) { unstable_rethrow(error); atual = falha("NAO_CONFIRMADO"); }
    if (!valido || !historico.success) return { ...falha("RESPOSTA_INVALIDA"), atual };
    return { ok: true, estado: "RECIBO_CONFIRMADO", recibo: historico.data, atual };
  } catch (error) { unstable_rethrow(error); return falha("NAO_CONFIRMADO"); }
}
