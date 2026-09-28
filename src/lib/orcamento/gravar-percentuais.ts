import "server-only";

import type { createClient } from "@/lib/supabase/server";
import type { RatesProposta } from "./engine-economica";

type Cliente = Awaited<ReturnType<typeof createClient>>;

export type PercentuaisProposta = Required<{ [K in keyof RatesProposta]: number }>;

/** Lê os cinco percentuais do formulário; null se algum for inválido ou a soma chegar a 100%. */
export function lerPercentuais(formData: FormData): PercentuaisProposta | null {
  const ler = (campo: string) => {
    const bruto = String(formData.get(campo) ?? "").replace(",", ".").trim();
    const n = bruto === "" ? 0 : Number(bruto);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  const valores = {
    impostos_legacy: ler("impostos_legacy"),
    incubacao: ler("incubacao"),
    reserva: ler("reserva"),
    investimentos: ler("investimentos"),
    lucro: ler("lucro"),
  };
  const lista = Object.values(valores);
  if (lista.some((v) => Number.isNaN(v)) || lista.reduce((a, v) => a + v, 0) >= 100) return null;
  return valores;
}

/**
 * Grava os percentuais onde a elaboração os lê: no orçamento de projeto, quando
 * houver; senão, na própria proposta (0118). Devolve a mensagem de erro, ou null.
 */
export async function gravarPercentuaisDaDemanda(
  supabase: Cliente,
  demandaId: number,
  valores: PercentuaisProposta,
): Promise<string | null> {
  const { data: projeto } = await supabase
    .from("orcamento_projetos")
    .select("id")
    .eq("demanda_id", demandaId)
    .neq("status", "cancelado")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = projeto?.id
    ? await supabase.from("orcamento_projetos").update(valores).eq("id", projeto.id).select("id")
    : await supabase
        .from("demandas_propostas")
        .update({
          param_impostos: valores.impostos_legacy,
          param_incubacao: valores.incubacao,
          param_reserva: valores.reserva,
          param_investimentos: valores.investimentos,
          param_lucro: valores.lucro,
        } as never)
        .eq("id", demandaId)
        .select("id");
  if (error) return error.message;
  if (!data?.length) return "Nada foi salvo: seu perfil não tem permissão para alterar esta proposta.";
  return null;
}
