import "server-only";
import { unstable_rethrow } from "next/navigation";
import { createClientUntyped } from "@/lib/supabase/server";
import { consumoMensalDoBanco, type LeituraConsumoMensal } from "./consumo-mensal-dados";

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
