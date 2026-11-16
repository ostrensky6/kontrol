"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { garantirEscrita } from "@/lib/supabase/escrita";

/** Atualiza as etiquetas de uma linha de insumo_analise (grupo + modo de cobrança). */
export async function atualizarInsumoLinha(formData: FormData) {
  const id = Number(formData.get("id"));
  const grupoRaw = (formData.get("grupo_escolha") as string | null)?.trim();
  const modoRaw = (formData.get("modo_cobranca") as string | null)?.trim();

  const grupo_escolha = grupoRaw ? grupoRaw : null;
  const modo_cobranca = modoRaw ? modoRaw : null;

  const supabase = await createClient();
  const { data: gravado, error } = await supabase
    .from("insumo_analise")
    .update({ grupo_escolha, modo_cobranca })
    .eq("id", id)
    .select("id");

  garantirEscrita(error, gravado, "O insumo da análise não foi salvo.");

  revalidatePath("/insumos");
  revalidatePath("/custeio");
}
