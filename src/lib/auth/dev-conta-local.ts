import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Conta do login automático local (só em `next dev` com Supabase local; ver
 * dev-auto-login.ts). Depois de zerar o banco local, o link mágico recria a
 * conta sem a marca de cadastro do administrador, e pela 0132 ela nasce
 * suspensa e técnica: o app abre só com Suprimentos. Essa conta, e só ela, é
 * promovida a administrador ativo. Conta cadastrada pelo administrador fica
 * como está, para o login automático continuar servindo ao teste de outros papéis.
 */
export function contaCriadaPeloLinkLocal(
  user: { app_metadata?: Record<string, unknown> } | null | undefined,
): boolean {
  if (!user) return false;
  return user.app_metadata?.cadastrado_pelo_admin !== true;
}

/** Promove a conta local a administrador ativo. Devolve o motivo da falha, ou null. */
export async function prepararContaLocal(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<string | null> {
  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { cadastrado_pelo_admin: true, senha_provisoria: false },
    ban_duration: "none",
  });
  if (authError) return `não foi possível liberar a conta local: ${authError.message}`;

  const { data, error } = await admin
    .from("perfis")
    .update({ papel: "admin", suspenso: false, senha_provisoria: false })
    .eq("id", userId)
    .select("id");
  if (error || (data?.length ?? 0) === 0) {
    return `não foi possível ajustar o perfil local: ${error?.message ?? "perfil não encontrado"}`;
  }
  return null;
}
