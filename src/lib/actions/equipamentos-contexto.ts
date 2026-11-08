"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { isPapelUsuario, type PapelUsuario } from "@/lib/auth/permissions";
import { createClientUntyped } from "@/lib/supabase/server";

const id = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const uuid = z.guid().transform((value) => value.toLowerCase());
const versao = z.number().int().min(0).max(2_147_483_647);
const tipo = z.enum(["preventiva", "corretiva", "calibracao", "qualificacao", "verificacao", "limpeza_tecnica"]);
const papel = z.custom<PapelUsuario>(isPapelUsuario);
const operacao = z.enum(["configurar", "avaliar", "reconhecer", "encaminhar"]);
const entradaContexto = z.strictObject({
  p_unidade_id: id,
  p_tipo: tipo,
  p_origem_apos: id.nullable(),
  p_responsavel_apos: uuid.nullable(),
  p_limite: z.number().int().min(1).max(100),
});
const entradaDireito = z.strictObject({ p_papel: papel, p_operacao: operacao });
const contexto = z.strictObject({
  estado: z.literal("confirmado"),
  equipamento_unidade_id: id,
  tipo,
  permissoes: z.strictObject({
    configurar: z.literal(true), avaliar: z.boolean(), reconhecer: z.boolean(),
    encaminhar: z.boolean(), governar: z.boolean(),
  }),
  regra: z.discriminatedUnion("estado", [
    z.strictObject({ estado: z.literal("indisponivel") }),
    z.strictObject({
      estado: z.literal("confirmada"),
      dado: z.strictObject({ id: uuid, versao: versao.min(1) }).nullable(),
    }),
  ]),
  versao_esperada: versao.nullable(),
  origens: z.strictObject({
    itens: z.array(z.strictObject({
      id, tipo, status: z.enum(["agendada", "em_execucao", "concluida", "vencida"]),
      proxima_data: z.iso.date().refine((value) => !value.startsWith("0000")),
    })).max(100),
    proximo_apos: id.nullable(),
  }),
  responsaveis: z.strictObject({
    itens: z.array(z.strictObject({ id: uuid, nome: z.string().nullable() })).max(100),
    proximo_apos: uuid.nullable(),
  }),
}).refine((value) => value.regra.estado === "indisponivel"
  ? value.versao_esperada === null
  : value.regra.dado === null
    ? value.versao_esperada === 0
    : value.versao_esperada === value.regra.dado.versao);
const direito = z.strictObject({
  estado: z.literal("confirmado"), papel, operacao,
  pode_governar: z.literal(true), concessao_esperada: z.boolean(),
});

export type ConsultaContextoAvisoEquipamento = z.input<typeof entradaContexto>;
export type ConsultaDireitoAvisoEquipamento = z.input<typeof entradaDireito>;
export type ContextoConfiguracaoAvisoEquipamento = z.output<typeof contexto>;
export type DireitoAvisoEquipamento = z.output<typeof direito>;

const mensagens = {
  ENTRADA_INVALIDA: "Confira o escopo e a paginação da consulta.",
  SESSAO_INVALIDA: "Entre novamente para consultar avisos.",
  SEM_ACESSO: "Consulta não autorizada para esta sessão e escopo.",
  INDISPONIVEL: "Não foi possível consultar os avisos agora.",
  RESPOSTA_INVALIDA: "A consulta não confirmou um contexto válido. Recarregue antes de operar.",
} as const;
type Falha = { ok: false; codigo: keyof typeof mensagens; message: string };
export type ResultadoLeituraEquipamento<T> = Falha | { ok: true; dados: T };
function falha(codigo: Falha["codigo"]): Falha {
  return { ok: false, codigo, message: mensagens[codigo] };
}

// Valida o contrato de paginação, não a elegibilidade: esta pertence à RPC/RLS.
function paginaCoerente<T extends string | number>(
  pagina: { itens: { id: T }[]; proximo_apos: T | null }, apos: T | null, limite: number,
) {
  const ids = pagina.itens.map((item) => item.id);
  return ids.length <= limite && ids.every((item, index) =>
    (apos === null || item > apos) && (index === 0 || item > ids[index - 1])) &&
    (pagina.proximo_apos === null || (ids.length === limite && pagina.proximo_apos === ids.at(-1)));
}

async function consultar<S extends z.ZodObject, R extends z.ZodType>(
  rpc: "contexto_configuracao_aviso_equipamento" | "consultar_direito_aviso_equipamento",
  valor: unknown, entrada: S, saida: R,
  coerente: (dados: z.output<R>, args: z.output<S>) => boolean,
): Promise<ResultadoLeituraEquipamento<z.output<R>>> {
  const args = entrada.safeParse(valor);
  if (!args.success) return falha("ENTRADA_INVALIDA");
  try {
    const cliente = await createClientUntyped();
    const sessao = await cliente.auth.getUser();
    if (sessao.error?.name === "AuthRetryableFetchError" || (sessao.error?.status ?? 0) >= 500 || sessao.error?.status === 429) {
      return falha("INDISPONIVEL");
    }
    if (sessao.error || !uuid.safeParse(sessao.data?.user?.id).success || sessao.data?.user?.is_anonymous === true) {
      return falha("SESSAO_INVALIDA");
    }
    // A mesma sessão consulta somente a RPC nominada. Nenhum fallback ou cache
    // de concessão. Sessão apta/direitos correntes/recorte são revalidados no SQL.
    const { data, error } = await cliente.rpc(rpc, args.data);
    if (error) return falha(error.code === "42501" ? "SEM_ACESSO"
      : error.code === "22023" ? "ENTRADA_INVALIDA" : "INDISPONIVEL");
    const resultado = saida.safeParse(data);
    if (!resultado.success || !coerente(resultado.data, args.data)) return falha("RESPOSTA_INVALIDA");
    return { ok: true, dados: resultado.data };
  } catch (erro) {
    unstable_rethrow(erro);
    return falha("INDISPONIVEL");
  }
}

/** CAS vem exclusivamente de versao_esperada; null bloqueia configurar.
 * Página vazia não diz se existe regra. Não preencher nomes/IDs ausentes.
 * Para a ação 0153: origem.id -> p_ocorrencia_id; origem.proxima_data ->
 * p_data_referencia; responsável.id -> p_responsavel_id. Dias/motivo/operação
 * permanecem entradas explícitas, e a flag de escrita existente não é alterada.
 */
export async function consultarContextoConfiguracaoAvisoEquipamento(entrada: ConsultaContextoAvisoEquipamento) {
  return consultar("contexto_configuracao_aviso_equipamento", entrada, entradaContexto, contexto, (r, a) =>
    r.equipamento_unidade_id === a.p_unidade_id && r.tipo === a.p_tipo &&
    r.origens.itens.every((origem) => origem.tipo === a.p_tipo) &&
    paginaCoerente(r.origens, a.p_origem_apos, a.p_limite) &&
    paginaCoerente(r.responsaveis, a.p_responsavel_apos, a.p_limite));
}

/** Só ok:true confirma concessao_esperada, inclusive false. A 0153 recebe
 * p_concessao_esperada como string "true"/"false" no FormData, sem coerção de erro.
 */
export async function consultarDireitoAvisoEquipamento(entrada: ConsultaDireitoAvisoEquipamento) {
  return consultar("consultar_direito_aviso_equipamento", entrada, entradaDireito, direito, (r, a) =>
    r.papel === a.p_papel && r.operacao === a.p_operacao);
}
