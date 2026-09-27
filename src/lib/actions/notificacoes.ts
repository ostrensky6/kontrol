"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mensagemDoBanco } from "@/lib/erros";

/**
 * Leitura e arquivamento são por usuário (migration 0128,
 * notificacoes_leituras): marcar ou arquivar um aviso não some com ele para
 * os colegas.
 */
function refreshNotifications() {
  revalidatePath("/");
  revalidatePath("/notificacoes");
}

async function gravarLeitura(id: number, campos: { lida_em?: string; arquivada_em?: string }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Entre novamente.");
  const { error } = await supabase
    .from("notificacoes_leituras")
    .upsert({ notificacao_id: id, user_id: user.id, ...campos }, { onConflict: "notificacao_id,user_id" });
  if (error) throw new Error(mensagemDoBanco(error));
  refreshNotifications();
}

export async function marcarNotificacaoLida(formData: FormData) {
  const id = Number(formData.get("notificacao_id"));
  if (!id) return;
  await gravarLeitura(id, { lida_em: new Date().toISOString() });
}

export async function arquivarNotificacao(formData: FormData) {
  const id = Number(formData.get("notificacao_id"));
  if (!id) return;
  const agora = new Date().toISOString();
  await gravarLeitura(id, { lida_em: agora, arquivada_em: agora });
}

/** Marca como lidas só as notificações do usuário atual. */
export async function marcarTodasNotificacoesLidas() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("marcar_todas_notificacoes_lidas");
  if (error) throw new Error(mensagemDoBanco(error));
  refreshNotifications();
}
