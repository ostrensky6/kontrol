"use server";

import { revalidatePath } from "next/cache";

import type { FormState } from "@/lib/actions/cadastros";
import { temPapel } from "@/lib/auth/roles";
import { PAPEIS, PERMISSOES } from "@/lib/auth/permissions";
import { buildPermissoesPorCategoria } from "@/lib/auth/permission-categories";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function obterMatrizPrivilegios() {
  if (!(await temPapel("admin"))) return null;

  const supabase = await createClient();
  const { data } = await supabase.from("permissoes_categorias").select("papel, permissoes");
  return buildPermissoesPorCategoria(data ?? []);
}

/**
 * Salva a matriz inteira de uma vez (uma caixinha por função e privilégio).
 * Cada função chega como `permissoes:<papel>`; o admin não é gravado (sempre
 * tem tudo). Só grava as funções que mudaram.
 */
export async function salvarMatrizPrivilegios(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    if (!(await temPapel("admin"))) {
      return { ok: false, message: "Sem permissão para editar privilégios." };
    }
    if (formData.get("permissoes_presentes") !== "1") {
      return { ok: false, message: "Formulário incompleto. Recarregue a página e tente de novo." };
    }

    const chavesValidas = new Set<string>(PERMISSOES.map((permissao) => permissao.key));
    const supabase = await createClient();
    const { data: atuais } = await supabase.from("permissoes_categorias").select("papel, permissoes");
    const matrizAtual = buildPermissoesPorCategoria(atuais ?? []);
    const agora = new Date().toISOString();
    const linhas = PAPEIS.filter((papel) => papel.value !== "admin").flatMap((papel) => {
      const marcadas = new Set(
        formData.getAll(`permissoes:${papel.value}`).map(String).filter((chave) => chavesValidas.has(chave)),
      );
      const permissoes = Object.fromEntries(PERMISSOES.map((permissao) => [permissao.key, marcadas.has(permissao.key)]));
      const mudou = PERMISSOES.some((permissao) => matrizAtual[papel.value][permissao.key] !== permissoes[permissao.key]);
      return mudou ? [{ papel: papel.value, permissoes, atualizado_em: agora }] : [];
    });

    if (linhas.length === 0) return { ok: true, message: "Nada mudou." };

    const { error } = await createAdminClient().from("permissoes_categorias").upsert(linhas);
    if (error) return { ok: false, message: error.message };

    revalidatePath("/governanca/privilegios");
    revalidatePath("/usuarios");
    const nomes = linhas.map((linha) => PAPEIS.find((papel) => papel.value === linha.papel)?.label).join(", ");
    return { ok: true, message: `Privilégios salvos: ${nomes}.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível salvar os privilégios.";
    return { ok: false, message };
  }
}
