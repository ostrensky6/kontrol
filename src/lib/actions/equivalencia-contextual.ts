"use server";

import "server-only";
import { z } from "zod";
import type { lerFonteEquivalencia } from "@/lib/costing/equivalencia-fonte";
import { falha, type EstadoAcao } from "@/lib/erros";
import { createClientUntyped } from "@/lib/supabase/server";

const VERSAO = "equivalencia-contextual-v1" satisfies
  Extract<Awaited<ReturnType<typeof lerFonteEquivalencia>>, { estado: "disponivel" }>["versao"];
const texto = (max: number) => z.string().trim().min(1).max(max);
const id = z.string().regex(/^[1-9]\d{0,15}$/).transform(Number).pipe(
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
);
const nulo = z.literal("").transform(() => null);
const decisaoRef = z.string().regex(/^equivalencia:[1-9]\d{0,15}$/)
  .refine((ref) => Number.isSafeInteger(Number(ref.slice("equivalencia:".length))));
const recibo = z.strictObject({
  decisao_ref: decisaoRef,
  estado: z.enum(["validada", "revogada"]),
});

const contexto = z.object({
  necessidade_id: id,
  etapa_id: id.or(nulo),
  insumo_id: id,
  equipamento_id: id.or(nulo),
  apresentacao_ref: texto(160),
  unidade_estoque: texto(160),
  unidade_consumo: texto(160),
  fator_conversao: z.string().trim().max(40).regex(/^\d+(?:[.,]\d+)?$/)
    .transform((valor) => Number(valor.replace(",", "."))).pipe(z.number().positive()),
  evidencia_ref: texto(240),
  vigente_ate: z.iso.datetime({ offset: true })
    .refine((valor) => Date.parse(valor) > Date.now())
    .transform((valor) => new Date(valor).toISOString()).or(nulo),
  confirmada: z.literal("sim").transform(() => true),
});
const registro = z.object({
  versao: z.literal(VERSAO),
  codigo_analise: texto(100),
  metodo_revisao_ref: texto(160),
  p_contexto: contexto,
});
const revogacao = z.object({
  versao: z.literal(VERSAO),
  decisao_ref: decisaoRef,
  motivo: texto(500),
});

export type EstadoEquivalencia = EstadoAcao & {
  recibo?: z.infer<typeof recibo>;
  motivo?: "desabilitada" | "entrada_invalida" | "negada" | "conflito" | "resultado_indeterminado";
};

const habilitada = () => process.env.KONTROL_EQUIVALENCIA_ESCRITA === "1";
const desabilitada = (): EstadoEquivalencia =>
  ({ ...falha("A escrita de validações técnicas ainda não está habilitada."), motivo: "desabilitada" });
const indeterminada = (): EstadoEquivalencia =>
  ({ ...falha("Não foi possível confirmar a operação. Atualize a ficha antes de tentar novamente."), motivo: "resultado_indeterminado" });

function campos(form: FormData, nomes: string[]) {
  return Object.fromEntries(nomes.map((nome) => {
    const valores = form.getAll(nome);
    return [nome, valores.length === 1 ? valores[0] : undefined];
  }));
}

function invalida(erro?: z.ZodError): EstadoEquivalencia {
  const erros = erro && Object.fromEntries(erro.issues.map((i) => [String(i.path.at(-1)), "Confira este campo."]));
  return { ...falha("Confira os dados da validação técnica.", erros), motivo: "entrada_invalida" };
}

async function executar(
  rpc: "registrar_equivalencia_contextual_v1" | "revogar_equivalencia_contextual_v1",
  args: Record<string, unknown>,
  estado: z.infer<typeof recibo>["estado"],
  refEsperada?: string,
): Promise<EstadoEquivalencia> {
  try {
    // Cliente de sessão; somente a RPC resolve ator, papel e escopo.
    const supabase = await createClientUntyped();
    const { data, error } = await supabase.rpc(rpc, args);
    if (error) {
      switch (error.code) {
        case "42501":
          return { ...falha("Sua sessão ou seu acesso não permite esta operação."), motivo: "negada" };
        case "23505":
          return { ...falha("Já existe uma validação efetiva para este contexto e insumo. Atualize a ficha."), motivo: "conflito" };
        case "55000":
        case "P0002":
          return { ...falha("A decisão já foi revogada ou não está disponível. Atualize a ficha."), motivo: "conflito" };
        case "55P03":
        case "40001":
        case "40P01":
          return { ...falha("Outra operação está alterando este contexto. Atualize a ficha antes de tentar novamente."), motivo: "conflito" };
        case "22023":
          return { ...falha("O banco não confirmou os dados do contexto. Revise a ficha e tente novamente."), motivo: "entrada_invalida" };
        default:
          return indeterminada();
      }
    }
    const confirmacao = recibo.safeParse(data);
    if (!confirmacao.success || confirmacao.data.estado !== estado
      || (refEsperada !== undefined && confirmacao.data.decisao_ref !== refEsperada)) return indeterminada();
    return {
      ok: true,
      message: estado === "validada" ? "Validação técnica registrada." : "Validação técnica revogada.",
      recibo: confirmacao.data,
    };
  } catch {
    return indeterminada();
  }
}

export async function registrarEquivalenciaContextual(
  _estado: EstadoEquivalencia,
  form: FormData,
): Promise<EstadoEquivalencia> {
  if (!habilitada()) return desabilitada();
  if (!(form instanceof FormData)) return invalida();
  const dados = registro.safeParse({
    ...campos(form, ["versao", "codigo_analise", "metodo_revisao_ref"]),
    p_contexto: campos(form, Object.keys(contexto.shape)),
  });
  if (!dados.success) return invalida(dados.error);
  const { codigo_analise, metodo_revisao_ref, p_contexto } = dados.data;
  return executar("registrar_equivalencia_contextual_v1", {
    p_codigo: codigo_analise, p_metodo_revisao_ref: metodo_revisao_ref, p_contexto,
  }, "validada");
}

export async function revogarEquivalenciaContextual(
  _estado: EstadoEquivalencia,
  form: FormData,
): Promise<EstadoEquivalencia> {
  if (!habilitada()) return desabilitada();
  if (!(form instanceof FormData)) return invalida();
  const dados = revogacao.safeParse(campos(form, Object.keys(revogacao.shape)));
  if (!dados.success) return invalida(dados.error);
  const { decisao_ref, motivo } = dados.data;
  return executar("revogar_equivalencia_contextual_v1", {
    p_decisao_id: Number(decisao_ref.slice("equivalencia:".length)), p_motivo: motivo,
  }, "revogada", decisao_ref);
}
