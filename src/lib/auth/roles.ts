import "server-only";
import { createClient } from "@/lib/supabase/server";
import { PAPEL_PADRAO, isPapelUsuario, papelAlcanca, type PapelUsuario } from "@/lib/auth/permissions";

export type Papel = PapelUsuario;

export type UsuarioAtual = {
  id: string;
  email: string | null;
  nome: string | null;
  papel: Papel;
  /** Suspenso (ou sem perfil legível) não age: nenhum papel vale. */
  suspenso: boolean;
};

export async function usuarioAtual(): Promise<UsuarioAtual | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("perfis")
    .select("nome, email, papel, suspenso")
    .eq("id", user.id)
    .single();
  const perfil = data as { nome?: string | null; email?: string | null; papel?: string | null; suspenso?: boolean | null } | null;
  return {
    id: user.id,
    email: perfil?.email ?? user.email ?? null,
    nome: perfil?.nome ?? null,
    papel: isPapelUsuario(perfil?.papel) ? perfil.papel : PAPEL_PADRAO,
    suspenso: perfil ? perfil.suspenso === true : true,
  };
}

export async function papelAtual(): Promise<Papel> {
  const u = await usuarioAtual();
  return u?.papel ?? PAPEL_PADRAO;
}

/**
 * true se o papel do usuário é >= mínimo exigido. Suspenso nunca tem papel
 * (mesma regra de current_papel/papel_minimo no banco, migration 0128).
 */
export async function temPapel(min: Papel): Promise<boolean> {
  const u = await usuarioAtual();
  if (!u || u.suspenso) return false;
  return papelAlcanca(u.papel, min);
}
