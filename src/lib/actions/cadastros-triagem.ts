"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { usuarioAtual } from "@/lib/auth/roles";
import { createClientUntyped } from "@/lib/supabase/server";
import { mensagemDoBanco } from "@/lib/erros";
import { normalizarCodigo } from "@/lib/scanner/identificadores";
import {
  entidadeTipoParaResolucao,
  isTipoResolucaoTriagem,
  type TipoResolucaoTriagem,
} from "@/lib/scanner/triagem-resolucao";
import { prepararTriagemCadastro } from "@/lib/scanner/triagem";
import type { FormState } from "./cadastros";

function texto(formData: FormData, chave: string) {
  return String(formData.get(chave) ?? "").trim();
}

const triagemSchema = z.object({
  codigo: z.string().trim().min(1, "Código obrigatório."),
});

const resolverExistenteSchema = z.object({
  triagem_id: z.coerce.number().int().positive("Triagem inválida."),
  entidade_tipo: z.string().refine(isTipoResolucaoTriagem, "Tipo de resolução inválido."),
  entidade_id: z.coerce.number().int().positive("Escolha o item."),
});

const novoInsumoSchema = z.object({
  triagem_id: z.coerce.number().int().positive("Triagem inválida."),
  especificacao: z.string().trim().min(1, "Especificação obrigatória."),
  unidade: z.string().trim().min(1, "Unidade da embalagem obrigatória."),
  unidade_consumo: z.string().trim().min(1, "Unidade de consumo obrigatória."),
  fator_conversao: z.coerce.number().positive("O fator de conversão deve ser maior que 0."),
  quantidade_embalagem: z.coerce.number().positive("Quantidade da embalagem deve ser > 0."),
  custo_total_embalagem: z.preprocess(
    (value) => (value === "" || value == null ? null : Number(value)),
    z.number().min(0).nullable(),
  ),
});

const arquivarSchema = z.object({
  triagem_id: z.coerce.number().int().positive("Triagem inválida."),
});

type TriagemPendente = {
  id: number;
  codigo: string;
  codigo_normalizado: string;
  formato: string | null;
};

const TABELAS_RESOLUCAO: Record<TipoResolucaoTriagem, string> = {
  insumo: "insumos",
  lote: "lotes_estoque",
  local: "locais",
};

function formErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = String(issue.path[0] ?? "");
    if (path && !errors[path]) errors[path] = issue.message;
  }
  return errors;
}

function revalidarTriagem() {
  revalidatePath("/scanner/triagem");
  revalidatePath("/scanner/desconhecido");
}

async function carregarTriagemPendente(
  supabase: Awaited<ReturnType<typeof createClientUntyped>>,
  triagemId: number,
): Promise<TriagemPendente | null> {
  const { data } = await supabase
    .from("cadastros_triagem")
    .select("id, codigo, codigo_normalizado, formato")
    .eq("id", triagemId)
    .in("status", ["pendente", "em_analise"])
    .maybeSingle();

  return data as TriagemPendente | null;
}

async function entidadeExiste(
  supabase: Awaited<ReturnType<typeof createClientUntyped>>,
  tipo: TipoResolucaoTriagem,
  id: number,
) {
  const { data } = await supabase
    .from(TABELAS_RESOLUCAO[tipo])
    .select("id")
    .eq("id", id)
    .maybeSingle();

  return Boolean(data);
}

async function vincularCodigoTriagem(args: {
  supabase: Awaited<ReturnType<typeof createClientUntyped>>;
  triagem: TriagemPendente;
  tipo: TipoResolucaoTriagem;
  entidadeId: number;
  criadoPor: string | null;
}): Promise<FormState | null> {
  const entidadeTipo = entidadeTipoParaResolucao(args.tipo);
  const codigoNormalizado = normalizarCodigo(args.triagem.codigo);
  let identificadorCriadoId: number | null = null;
  const { data: existente } = await args.supabase
    .from("identificadores")
    .select("id, entidade_tipo, entidade_id")
    .eq("codigo_normalizado", codigoNormalizado)
    .eq("ativo", true)
    .maybeSingle();

  if (existente) {
    const mesmoDestino =
      String(existente.entidade_tipo) === entidadeTipo &&
      Number(existente.entidade_id) === args.entidadeId;
    if (!mesmoDestino) {
      return {
        ok: false,
        message: "Este código já está vinculado a outro item ativo.",
      };
    }
  } else {
    const { data: criado, error } = await args.supabase
      .from("identificadores")
      .insert({
        codigo: args.triagem.codigo,
        codigo_normalizado: codigoNormalizado,
        formato: args.triagem.formato ?? "manual",
        entidade_tipo: entidadeTipo,
        entidade_id: args.entidadeId,
        origem: "manual",
        metadata: { triagem_id: args.triagem.id },
        ativo: true,
        criado_por: args.criadoPor,
      })
      .select("id")
      .single();

    if (error) {
      return { ok: false, message: mensagemDoBanco(error) };
    }
    identificadorCriadoId = Number(criado.id);
  }

  const { error: updateError } = await args.supabase
    .from("cadastros_triagem")
    .update({
      status: "resolvido",
      entidade_tipo: entidadeTipo,
      entidade_id: args.entidadeId,
      resolvido_em: new Date().toISOString(),
    })
    .eq("id", args.triagem.id);

  if (updateError) {
    if (identificadorCriadoId != null) {
      await args.supabase
        .from("identificadores")
        .update({ ativo: false })
        .eq("id", identificadorCriadoId);
    }
    return { ok: false, message: mensagemDoBanco(updateError) };
  }

  revalidarTriagem();
  return null;
}

export async function criarTriagemCodigoDesconhecido(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = triagemSchema.safeParse({
    codigo: texto(formData, "codigo"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Código inválido.",
    };
  }

  const triagem = prepararTriagemCadastro(parsed.data.codigo);
  let destino = "registrada";

  try {
    const usuario = await usuarioAtual();
    const supabase = await createClientUntyped();
    const { data: existente } = await supabase
      .from("cadastros_triagem")
      .select("id")
      .eq("codigo_normalizado", triagem.codigoNormalizado)
      .in("status", ["pendente", "em_analise"])
      .maybeSingle();

    if (existente?.id) {
      destino = "existente";
    } else {
      const { error } = await supabase.from("cadastros_triagem").insert({
        codigo: triagem.codigo,
        codigo_normalizado: triagem.codigoNormalizado,
        formato: triagem.formato,
        tipo_sugerido: triagem.tipoSugerido,
        dados_extraidos: triagem.dadosExtraidos,
        status: "pendente",
        criado_por: usuario?.email ?? usuario?.id ?? null,
      });

      if (error) {
        if ("code" in error && error.code === "23505") {
          destino = "existente";
        } else {
          return {
            ok: false,
            message: "Não foi possível registrar a triagem agora.",
          };
        }
      }
    }
  } catch {
    return {
      ok: false,
      message: "Não foi possível registrar a triagem agora.",
    };
  }

  redirect(
    `/scanner/desconhecido?codigo=${encodeURIComponent(triagem.codigo)}&triagem=${destino}`,
  );
}

export async function resolverTriagemComEntidadeExistente(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = resolverExistenteSchema.safeParse({
    triagem_id: formData.get("triagem_id"),
    entidade_tipo: formData.get("entidade_tipo"),
    entidade_id: formData.get("entidade_id"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", errors: formErrors(parsed.error) };
  }

  const supabase = await createClientUntyped();
  const tipo = parsed.data.entidade_tipo;
  const triagem = await carregarTriagemPendente(supabase, parsed.data.triagem_id);
  if (!triagem) return { ok: false, message: "Triagem pendente não encontrada." };
  if (!(await entidadeExiste(supabase, tipo, parsed.data.entidade_id))) {
    return { ok: false, message: "O item selecionado não existe." };
  }

  const usuario = await usuarioAtual();
  const erro = await vincularCodigoTriagem({
    supabase,
    triagem,
    tipo,
    entidadeId: parsed.data.entidade_id,
    criadoPor: usuario?.email ?? usuario?.id ?? null,
  });
  if (erro) return erro;

  redirect("/scanner/triagem?status=resolvido");
}

export async function criarInsumoMinimoDaTriagem(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = novoInsumoSchema.safeParse({
    triagem_id: formData.get("triagem_id"),
    especificacao: formData.get("especificacao"),
    unidade: formData.get("unidade"),
    unidade_consumo: formData.get("unidade_consumo"),
    fator_conversao: formData.get("fator_conversao"),
    quantidade_embalagem: formData.get("quantidade_embalagem"),
    custo_total_embalagem: formData.get("custo_total_embalagem"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", errors: formErrors(parsed.error) };
  }

  const usuario = await usuarioAtual();
  const supabase = await createClientUntyped();
  const { error } = await supabase.rpc("resolver_triagem_criando_insumo" as never, {
    p_triagem_id: parsed.data.triagem_id,
    p_especificacao: parsed.data.especificacao,
    p_unidade: parsed.data.unidade,
    p_unidade_consumo: parsed.data.unidade_consumo,
    p_fator_conversao: parsed.data.fator_conversao,
    p_quantidade_embalagem: parsed.data.quantidade_embalagem,
    p_custo_total_embalagem: parsed.data.custo_total_embalagem,
    p_criado_por: usuario?.email ?? usuario?.id ?? null,
  } as never);

  if (error) {
    return {
      ok: false,
      message: mensagemDoBanco(error, "Não foi possível criar o insumo pela triagem."),
    };
  }

  revalidarTriagem();
  revalidatePath("/cadastros/insumos");
  revalidatePath("/insumos");
  redirect("/scanner/triagem?status=insumo_criado");
}

export async function arquivarTriagemCodigoDesconhecido(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = arquivarSchema.safeParse({
    triagem_id: formData.get("triagem_id"),
  });
  if (!parsed.success) return { ok: false, message: "Triagem inválida." };

  const supabase = await createClientUntyped();
  const { error } = await supabase
    .from("cadastros_triagem")
    .update({
      status: "descartado",
      resolvido_em: new Date().toISOString(),
    })
    .eq("id", parsed.data.triagem_id)
    .in("status", ["pendente", "em_analise"]);

  if (error) return { ok: false, message: mensagemDoBanco(error) };

  revalidarTriagem();
  redirect("/scanner/triagem?status=arquivado");
}
