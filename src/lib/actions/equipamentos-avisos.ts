"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { isPapelUsuario, type PapelUsuario } from "@/lib/auth/permissions";
import { createClientUntyped } from "@/lib/supabase/server";

const MAX_INTEGER_PG = 2_147_483_647;
const idNumerico = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const inteiroForm = (schema: z.ZodNumber) => z.string().regex(/^[0-9]+$/).transform(Number).pipe(schema);
const versao = z.number().int().min(0).max(MAX_INTEGER_PG);
const dias = z.number().int().min(0).max(MAX_INTEGER_PG);
const uuid = z.guid().transform((id) => id.toLowerCase());
const dataCivil = z.iso.date().refine((data) => data.slice(0, 4) !== "0000");
const texto = z.string().trim().min(1).refine((valor) => !valor.includes("\0"));
const booleanoForm = z.enum(["true", "false"]).transform((valor) => valor === "true");
const operacao = z.enum(["configurar", "avaliar", "reconhecer", "encaminhar"]);
const papel = z.custom<PapelUsuario>(isPapelUsuario);
const estadoAviso = z.enum(["pendente", "reconhecido", "encaminhado"]);

const escopo = z.object({
  p_unidade_id: inteiroForm(idNumerico),
  // Vocabulário do CHECK da 0153; não é uma matriz de autorização.
  p_tipo: z.enum(["preventiva", "corretiva", "calibracao", "qualificacao", "verificacao", "limpeza_tecnica"]),
  p_operacao_id: uuid,
});
const configurar = escopo.extend({
  p_versao_esperada: inteiroForm(versao.max(MAX_INTEGER_PG - 1)),
  p_ocorrencia_id: inteiroForm(idNumerico),
  p_data_referencia: dataCivil,
  p_antecedencia_dias: inteiroForm(dias),
  p_responsavel_id: uuid,
  p_motivo: texto,
});
const avaliar = escopo.extend({ p_versao_esperada: inteiroForm(versao) });
const reconhecer = escopo.extend({
  p_aviso_id: uuid,
  p_estado_esperado: z.literal("pendente"),
  p_motivo: texto,
});
const encaminhar = reconhecer.extend({
  p_estado_esperado: z.enum(["pendente", "reconhecido"]),
  p_destino: texto,
});
const governar = z.object({
  p_papel: papel,
  p_operacao: operacao,
  p_concessao_esperada: booleanoForm,
  p_concedido: booleanoForm,
  p_motivo: texto,
  p_operacao_id: uuid,
});

const configurada = z.object({
  estado: z.literal("configurada"),
  regra_id: uuid,
  versao: versao.min(1),
  ocorrencia_id: idNumerico,
  data_referencia: dataCivil,
  antecedencia_dias: dias,
});
const idsAviso = { aviso_id: uuid, regra_id: uuid };
const avaliada = z.discriminatedUnion("estado", [
  z.object({ estado: z.literal("nao_configurado") }),
  z.object({
    estado: z.literal("referencia_alterada"),
    motivo: z.enum(["origem_ausente", "origem_cancelada", "proxima_data_nao_informada", "proxima_data_alterada"]),
  }),
  z.object({ estado: z.literal("indisponivel"), motivo: z.literal("proxima_data_invalida") }),
  z.object({ estado: z.literal("fora_janela"), data_referencia: dataCivil }),
  z.object({
    estado: z.literal("aberto"), estado_anterior: z.null(), estado_novo: z.literal("pendente"), ...idsAviso,
  }),
  z.object({ estado: z.literal("ja_existente"), estado_atual: estadoAviso, ...idsAviso }),
]);
const transicao = z.object({
  estado: z.enum(["reconhecido", "encaminhado"]),
  estado_anterior: z.enum(["pendente", "reconhecido"]),
  estado_novo: z.enum(["reconhecido", "encaminhado"]),
  ...idsAviso,
});
const direitoRegistrado = z.object({
  estado: z.literal("direito_registrado"),
  papel,
  operacao,
  concessao_anterior: z.boolean(),
  concedido: z.boolean(),
});

const mensagens = {
  ESCRITA_DESABILITADA: "As operações de avisos ainda não estão habilitadas.",
  ENTRADA_INVALIDA: "Confira os dados da operação de aviso.",
  SESSAO_INVALIDA: "Entre novamente para operar avisos.",
  SEM_ACESSO: "A operação de aviso não foi autorizada para esta sessão e escopo.",
  AVISO_AUSENTE: "O aviso não foi encontrado neste escopo.",
  CONFLITO: "A operação não foi confirmada por conflito. Recarregue antes de decidir o próximo passo.",
  INDISPONIVEL: "A operação não pôde ser confirmada. Consulte o estado atual antes de reenviar.",
  RESPOSTA_INVALIDA: "O recibo não confirmou a operação. Consulte o estado atual antes de reenviar.",
} as const;

type Falha = { ok: false; codigo: keyof typeof mensagens; message: string };
type Recibo = z.output<typeof configurada | typeof avaliada | typeof transicao | typeof direitoRegistrado>;
export type ResultadoAcaoAvisoEquipamento = Falha | { ok: true; recibo: Recibo };

function falha(codigo: Falha["codigo"]): Falha {
  return { ok: false, codigo, message: mensagens[codigo] };
}

function falhaRpc(codigo: string) {
  switch (codigo) {
    case "42501": return falha("SEM_ACESSO");
    case "P0002": return falha("AVISO_AUSENTE");
    case "40001": return falha("CONFLITO");
    case "22023": return falha("ENTRADA_INVALIDA");
    default: return falha("INDISPONIVEL");
  }
}

type RpcAviso =
  | "configurar_aviso_equipamento"
  | "avaliar_aviso_equipamento"
  | "reconhecer_aviso_equipamento"
  | "encaminhar_aviso_equipamento"
  | "governar_direito_aviso_equipamento";

async function executar<S extends z.ZodObject, R extends z.ZodType<Recibo>>(
  nome: RpcAviso, form: FormData, entrada: S, saida: R,
  coerente: (recibo: z.output<R>, args: z.output<S>) => boolean,
): Promise<Falha | { ok: true; recibo: z.output<R> }> {
  if (process.env.KONTROL_EQUIPAMENTOS_AVISOS_ESCRITA_HABILITADA !== "1") return falha("ESCRITA_DESABILITADA");
  if (!(form instanceof FormData)) return falha("ENTRADA_INVALIDA");
  const campos = Object.fromEntries(Object.keys(entrada.shape).map((chave) => {
    const valores = form.getAll(chave);
    return [chave, valores.length === 1 ? valores[0] : undefined];
  }));
  const args = entrada.safeParse(campos);
  if (!args.success) return falha("ENTRADA_INVALIDA");

  try {
    const cliente = await createClientUntyped();
    const sessao = await cliente.auth.getUser();
    if (sessao.error?.name === "AuthRetryableFetchError" || (sessao.error?.status ?? 0) >= 500 || sessao.error?.status === 429) {
      return falha("INDISPONIVEL");
    }
    const usuario = sessao.data?.user;
    if (sessao.error || !uuid.safeParse(usuario?.id).success || usuario?.is_anonymous === true) {
      return falha("SESSAO_INVALIDA");
    }

    // POST único com a mesma sessão. Escopo, direito, origem e CAS são da RPC.
    const { data, error } = await cliente.rpc(nome, args.data);
    if (error) return falhaRpc(error.code);
    const recibo = saida.safeParse(data);
    if (!recibo.success || !coerente(recibo.data, args.data)) return falha("RESPOSTA_INVALIDA");
    return { ok: true, recibo: recibo.data };
  } catch (erro) {
    unstable_rethrow(erro);
    return falha("INDISPONIVEL");
  }
}

type Anterior = ResultadoAcaoAvisoEquipamento | null;

export async function configurarAvisoEquipamento(_anterior: Anterior, form: FormData) {
  return executar("configurar_aviso_equipamento", form, configurar, configurada, (r, a) =>
    r.versao === a.p_versao_esperada + 1 && r.ocorrencia_id === a.p_ocorrencia_id &&
    r.data_referencia === a.p_data_referencia && r.antecedencia_dias === a.p_antecedencia_dias);
}

export async function avaliarAvisoEquipamento(_anterior: Anterior, form: FormData) {
  return executar("avaliar_aviso_equipamento", form, avaliar, avaliada, (r, a) =>
    (r.estado === "nao_configurado") === (a.p_versao_esperada === 0));
}

export async function reconhecerAvisoEquipamento(_anterior: Anterior, form: FormData) {
  return executar("reconhecer_aviso_equipamento", form, reconhecer, transicao, (r, a) =>
    r.estado === "reconhecido" && r.estado_novo === r.estado &&
    r.estado_anterior === a.p_estado_esperado && r.aviso_id === a.p_aviso_id);
}

export async function encaminharAvisoEquipamento(_anterior: Anterior, form: FormData) {
  return executar("encaminhar_aviso_equipamento", form, encaminhar, transicao, (r, a) =>
    r.estado === "encaminhado" && r.estado_novo === r.estado &&
    r.estado_anterior === a.p_estado_esperado && r.aviso_id === a.p_aviso_id);
}

export async function governarDireitoAvisoEquipamento(_anterior: Anterior, form: FormData) {
  return executar("governar_direito_aviso_equipamento", form, governar, direitoRegistrado, (r, a) =>
    r.papel === a.p_papel && r.operacao === a.p_operacao &&
    r.concessao_anterior === a.p_concessao_esperada && r.concedido === a.p_concedido);
}
