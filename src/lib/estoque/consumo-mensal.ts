import "server-only";
import { unstable_rethrow } from "next/navigation";
import { createClientUntyped } from "@/lib/supabase/server";
import { consumoMensalDoBanco, type LeituraConsumoMensal, type PrevisaoInsumo } from "./consumo-mensal-dados";

export type { LeituraConsumoMensal } from "./consumo-mensal-dados";

/** Lê o consumo mensal calculado (0157) de um insumo visível na sessão. */
export async function lerConsumoMensal(insumoId: number): Promise<LeituraConsumoMensal> {
  if (!Number.isSafeInteger(insumoId) || insumoId < 1) return { ok: false, message: "Insumo inválido." };
  try {
    const cliente = await createClientUntyped();
    const { data, error } = await cliente.rpc("consumo_mensal_insumo", { p_insumo_id: insumoId });
    if (error) return { ok: false, message: "Não foi possível calcular o consumo mensal agora." };
    const dados = consumoMensalDoBanco(data, insumoId);
    return dados ? { ok: true, dados } : { ok: false, message: "O cálculo do consumo mensal veio incompleto." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: "Não foi possível calcular o consumo mensal agora." };
  }
}

/** Prazo, disponível, pedido aberto e unidade do insumo (v_previsao_suprimentos + saldo). */
export async function lerPrevisaoInsumo(insumoId: number): Promise<PrevisaoInsumo | null> {
  if (!Number.isSafeInteger(insumoId) || insumoId < 1) return null;
  try {
    const cliente = await createClientUntyped();
    const [{ data: prev }, { data: saldo }] = await Promise.all([
      cliente.from("v_previsao_suprimentos")
        .select("disponivel, qtd_pedida_aberta, estoque_seguranca, lead_time_dias, qtd_sugerida_compra, unidade_saldo")
        .eq("insumo_id", insumoId).maybeSingle(),
      cliente.from("v_estoque_saldo").select("modelo_quantidade").eq("insumo_id", insumoId).maybeSingle(),
    ]);
    if (!prev) return null;
    const p = prev as Omit<PrevisaoInsumo, "modelo_quantidade">;
    return { ...p, modelo_quantidade: (saldo as { modelo_quantidade?: string | null } | null)?.modelo_quantidade ?? null };
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}
