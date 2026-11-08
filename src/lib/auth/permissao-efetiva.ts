import "server-only";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { PERMISSOES, type PermissaoUsuario } from "@/lib/auth/permissions";
import { createClientUntyped } from "@/lib/supabase/server";

/**
 * Permissão granular EFETIVA do usuário corrente, avaliada pelo próprio banco
 * (public.tem_permissao → kontrol_private.tem_permissao_efetiva, migration
 * 0112). O app usa apenas a decisão da RPC, sem matriz ou override em TS.
 * A mudança de fonte para função é responsabilidade da 0151.
 *
 * Falha fechada: erro de RPC ou resposta não booleana ⇒ false.
 * Memoizada por requisição (React cache).
 */
export const temPermissao = cache(async (chave: PermissaoUsuario): Promise<boolean> => {
  try {
    const supabase = await createClientUntyped();
    const { data, error } = await supabase.rpc("tem_permissao", { p_chave: chave });
    return !error && data === true;
  } catch (error) {
    unstable_rethrow(error);
    return false;
  }
});

/** Atalho para a permissão que protege salários e valores de pessoal (PE). */
export function podeVerSalario() {
  return temPermissao("tecnicos.salario.ver");
}

/** Pode criar, duplicar, excluir e editar análises (0124: só a permissão). */
export function podeEditarAnalises() {
  return temPermissao("analises.editar");
}

/** Atalho: a caixinha manda (migration 0124). */
export const pode = temPermissao;

/** Lança erro legível quando falta a permissão (para ações chamadas por <form>). */
export async function exigirPermissao(chave: PermissaoUsuario) {
  if (await temPermissao(chave)) return;
  const rotulo = PERMISSOES.find((item) => item.key === chave)?.label ?? chave;
  throw new Error(`Sem permissão: peça ao administrador para conferir “${rotulo}” em Governança → Privilégios.`);
}

/** Mensagem padrão das ações que devolvem { ok, message }. */
export function semPermissao(chave: PermissaoUsuario) {
  const rotulo = PERMISSOES.find((item) => item.key === chave)?.label ?? chave;
  return { ok: false as const, message: `Sem permissão: peça ao administrador para conferir “${rotulo}” em Governança → Privilégios.` };
}

export type PermissoesEfetivas = { admin: boolean; permissoes: Record<string, boolean> };

/**
 * Todas as permissões efetivas do usuário corrente numa só consulta
 * (public.minhas_permissoes, 0124). Usada para montar o menu. Falha fechada.
 */
export const minhasPermissoes = cache(async (): Promise<PermissoesEfetivas> => {
  try {
    const supabase = await createClientUntyped();
    const { data, error } = await supabase.rpc("minhas_permissoes");
    if (!error && data && typeof data === "object" && !Array.isArray(data)) {
      const bruto = data as { admin?: unknown; permissoes?: unknown };
      if (typeof bruto.admin === "boolean" && bruto.permissoes &&
        typeof bruto.permissoes === "object" && !Array.isArray(bruto.permissoes)) {
        return {
          admin: bruto.admin,
          permissoes: Object.fromEntries(Object.entries(bruto.permissoes).filter(([, valor]) => typeof valor === "boolean")),
        };
      }
    }
  } catch (error) {
    unstable_rethrow(error);
  }
  return { admin: false, permissoes: {} };
});

export function temNaLista(efetivas: PermissoesEfetivas, chave: PermissaoUsuario | undefined) {
  if (!chave) return true;
  return efetivas.admin || efetivas.permissoes[chave] === true;
}
