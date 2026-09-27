"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, mensagemErroAdminSupabase } from "@/lib/supabase/admin";
import { temPapel, usuarioAtual } from "@/lib/auth/roles";
import {
  PRAZO_SENHA_PROVISORIA_DIAS,
  appMetadataSenhaProvisoria,
  gerarSenhaProvisoria,
  validadeSenhaProvisoria,
} from "@/lib/auth/senha-provisoria";
import {
  PAPEIS,
  normalizePermissions,
  selectedPermissionsFromForm,
  type PapelUsuario,
} from "@/lib/auth/permissions";
import type { FormState } from "./cadastros";

/** Resultado que carrega a senha provisória gerada, mostrada uma única vez ao administrador. */
export type UsuarioFormState = FormState & { senhaProvisoria?: string };

const PAPEIS_VALIDOS = PAPEIS.map((papel) => papel.value);
const BUCKET_ASSINATURAS = "user-signatures";
const SENHA_MINIMA = 8;

function isPapelValido(papel: string): papel is PapelUsuario {
  return PAPEIS_VALIDOS.includes(papel as PapelUsuario);
}

function mensagemErroAcao(error: unknown) {
  if (error instanceof Error) return mensagemErroAdminSupabase(error);
  return "Não foi possível concluir a operação administrativa.";
}

function mensagemErroExclusaoUsuario(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";

  if (/storage|owns?\s+(storage\s+)?objects?|bucket/i.test(message)) {
    return "Não foi possível excluir o usuário porque ele ainda possui arquivos no Storage. Reatribua ou remova esses arquivos e tente novamente.";
  }
  if (error?.code === "23503" || /database error deleting user|foreign key|constraint/i.test(message)) {
    return "Não foi possível excluir o usuário porque ainda existem vínculos históricos não contemplados. Reatribua esses vínculos e tente novamente.";
  }
  return "Não foi possível excluir o usuário. A exclusão não foi confirmada; verifique vínculos e arquivos associados antes de tentar novamente.";
}

/** Marcação efetiva da categoria (papel), como o banco a aplica (0124). */
async function categoriaEfetiva(papel: string) {
  const { data } = await createAdminClient()
    .from("permissoes_categorias")
    .select("permissoes")
    .eq("papel", papel)
    .maybeSingle();
  return normalizePermissions(papel, papel === "admin" ? {} : data?.permissoes);
}

/**
 * O usuário guarda só as EXCEÇÕES à categoria. Assim, mudar a categoria em
 * Privilégios alcança todos que não têm exceção, e trocar o papel não deixa
 * para trás uma cópia das permissões do papel antigo.
 */
function soExcecoes(selecionadas: Record<string, boolean>, categoria: Record<string, boolean>) {
  return Object.fromEntries(
    Object.entries(selecionadas).filter(([chave, valor]) => categoria[chave] !== valor),
  );
}

async function permissoesDoUsuario(papel: string, formData?: FormData) {
  if (papel === "admin") return {};
  const categoria = await categoriaEfetiva(papel);
  if (
    formData &&
    (formData.get("permissoes_presentes") === "1" || formData.getAll("permissoes").length > 0)
  ) {
    return soExcecoes(selectedPermissionsFromForm(formData, papel), categoria);
  }
  return {};
}

// ban "permanente" para suspensão; o GoTrue aceita uma duração em horas.
const BAN_SUSPENSO = "876000h"; // ~100 anos

const AVISO_SENHA_PROVISORIA = `Copie a senha provisória e passe para a pessoa: ela não será mostrada de novo e vale por ${PRAZO_SENHA_PROVISORIA_DIAS} dias.`;

/**
 * Cadastra um usuário diretamente. Cria a conta no Auth com uma senha
 * provisória gerada só para ele e marca senha_provisoria=true; o trigger cria
 * o perfil e o próprio usuário define a senha definitiva no primeiro acesso.
 */
export async function criarUsuario(_prev: UsuarioFormState, formData: FormData): Promise<UsuarioFormState> {
  try {
    if (!(await temPapel("admin"))) {
      return { ok: false, message: "Sem permissão para cadastrar usuários." };
    }

    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const nome = String(formData.get("nome") ?? "").trim();
    const papel = String(formData.get("papel") ?? "tecnico");
    if (!email) return { ok: false, message: "Informe o e-mail do usuário." };
    if (!isPapelValido(papel)) return { ok: false, message: "Papel inválido." };
    const permissoes = await permissoesDoUsuario(papel, formData);

    const senhaProvisoria = gerarSenhaProvisoria();
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: senhaProvisoria,
      email_confirm: true,
      user_metadata: { nome, senha_provisoria: true },
      app_metadata: appMetadataSenhaProvisoria(),
    });

    if (error || !data.user) {
      const jaExiste = error?.message?.toLowerCase().includes("already");
      return {
        ok: false,
        message: jaExiste ? "Já existe um usuário com este e-mail." : mensagemErroAdminSupabase(error),
      };
    }

    // o trigger criou o perfil; ajusta nome/papel (e garante a flag)
    const supabase = await createClient();
    await supabase
      .from("perfis")
      .update({
        nome: nome || null,
        papel,
        permissoes,
        senha_provisoria: true,
        suspenso: false,
      })
      .eq("id", data.user.id);

    revalidatePath("/usuarios");
    return {
      ok: true,
      message: `Usuário ${email} criado. ${AVISO_SENHA_PROVISORIA}`,
      senhaProvisoria,
    };
  } catch (error) {
    return { ok: false, message: mensagemErroAcao(error) };
  }
}

/** Edita nome e papel de um usuário existente. */
export async function editarUsuario(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    if (!(await temPapel("admin"))) {
      return { ok: false, message: "Sem permissão para editar usuários." };
    }
    const id = String(formData.get("id") ?? "");
    const nome = String(formData.get("nome") ?? "").trim();
    const papel = String(formData.get("papel") ?? "");
    if (!id) return { ok: false, message: "Usuário inválido." };
    if (!isPapelValido(papel)) return { ok: false, message: "Papel inválido." };

    const admin = createAdminClient();
    const supabase = await createClient();
    const { error } = await supabase
      .from("perfis")
      .update({ nome: nome || null, papel, permissoes: await permissoesDoUsuario(papel, formData) })
      .eq("id", id);

    // mantém o nome também no Auth (user_metadata)
    const { error: authError } = await admin.auth.admin.updateUserById(id, { user_metadata: { nome } });

    if (error) return { ok: false, message: error.message };
    if (authError) return { ok: false, message: mensagemErroAdminSupabase(authError) };
    revalidatePath("/usuarios");
    return { ok: true, message: "Usuário atualizado." };
  } catch (error) {
    return { ok: false, message: mensagemErroAcao(error) };
  }
}

export async function alterarSenhaUsuario(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    if (!(await temPapel("admin"))) {
      return { ok: false, message: "Sem permissão para alterar senhas." };
    }

    const id = String(formData.get("id") ?? "");
    const exigirTroca = String(formData.get("exigir_troca") ?? "") === "on";
    const senha = String(formData.get("senha") ?? "");
    const confirmar = String(formData.get("confirmar") ?? "");

    if (!id) return { ok: false, message: "Usuário inválido." };
    if (!senha) return { ok: false, message: "Informe a nova senha." };
    if (senha.length < SENHA_MINIMA) {
      return { ok: false, message: `A senha deve ter ao menos ${SENHA_MINIMA} caracteres.` };
    }
    if (senha !== confirmar) return { ok: false, message: "As senhas não conferem." };

    const supabase = await createClient();
    const {
      data: { user: usuarioLogado },
    } = await supabase.auth.getUser();
    const { data: perfil, error: perfilError } = await supabase
      .from("perfis")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (perfilError) return { ok: false, message: perfilError.message };
    if (!perfil) return { ok: false, message: "Usuário não encontrado." };

    const admin = createAdminClient();
    const { error } =
      usuarioLogado?.id === id
        ? await supabase.auth.updateUser({
            password: senha,
            data: { senha_provisoria: exigirTroca },
          })
        : await admin.auth.admin.updateUserById(id, {
            password: senha,
            user_metadata: { senha_provisoria: exigirTroca },
            app_metadata: {
              cadastrado_pelo_admin: true,
              senha_provisoria: exigirTroca,
              senha_provisoria_expira_em: exigirTroca ? validadeSenhaProvisoria() : null,
            },
          });
    if (error) return { ok: false, message: mensagemErroAdminSupabase(error) };

    if (usuarioLogado?.id === id) {
      const { error: metadataError } = await admin.auth.admin.updateUserById(id, {
        app_metadata: {
          cadastrado_pelo_admin: true,
          senha_provisoria: exigirTroca,
          senha_provisoria_expira_em: exigirTroca ? validadeSenhaProvisoria() : null,
        },
      });
      if (metadataError) return { ok: false, message: mensagemErroAdminSupabase(metadataError) };
    }

    const { error: updateError } = await admin
      .from("perfis")
      .update({ senha_provisoria: exigirTroca })
      .eq("id", id);
    if (updateError) return { ok: false, message: updateError.message };

    revalidatePath("/usuarios");
    return {
      ok: true,
      message: exigirTroca
        ? "Senha atualizada. O usuário deverá definir uma nova senha no próximo acesso."
        : "Senha atualizada.",
    };
  } catch (error) {
    return { ok: false, message: mensagemErroAcao(error) };
  }
}

/**
 * Gera uma nova senha provisória para outra pessoa (esqueceu a senha, a
 * provisória venceu ou ainda estava com a senha fixa antiga). A senha volta
 * uma única vez para o administrador, e a pessoa troca no primeiro acesso.
 */
export async function gerarNovaSenhaProvisoria(
  _prev: UsuarioFormState,
  formData: FormData,
): Promise<UsuarioFormState> {
  try {
    if (!(await temPapel("admin"))) {
      return { ok: false, message: "Sem permissão para alterar senhas." };
    }
    const id = String(formData.get("id") ?? "");
    if (!id) return { ok: false, message: "Usuário inválido." };

    const eu = await usuarioAtual();
    if (eu?.id === id) {
      return { ok: false, message: "Para a sua própria conta, use Alterar senha." };
    }

    const senhaProvisoria = gerarSenhaProvisoria();
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(id, {
      password: senhaProvisoria,
      user_metadata: { senha_provisoria: true },
      app_metadata: appMetadataSenhaProvisoria(),
    });
    if (error) return { ok: false, message: mensagemErroAdminSupabase(error) };

    const { error: updateError } = await admin
      .from("perfis")
      .update({ senha_provisoria: true })
      .eq("id", id);
    if (updateError) return { ok: false, message: updateError.message };

    revalidatePath("/usuarios");
    return { ok: true, message: `Nova senha provisória gerada. ${AVISO_SENHA_PROVISORIA}`, senhaProvisoria };
  } catch (error) {
    return { ok: false, message: mensagemErroAcao(error) };
  }
}

export async function salvarPermissoesCategoria(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    if (!(await temPapel("admin"))) {
      return { ok: false, message: "Sem permissão para editar permissões." };
    }

    const papel = String(formData.get("papel") ?? "");
    if (!isPapelValido(papel)) return { ok: false, message: "Categoria inválida." };

    const permissoes = selectedPermissionsFromForm(formData, papel);
    const { error } = await createAdminClient()
      .from("permissoes_categorias")
      .upsert({ papel, permissoes, atualizado_em: new Date().toISOString() });

    if (error) return { ok: false, message: error.message };
    revalidatePath("/usuarios");
    revalidatePath("/governanca/privilegios");
    return { ok: true, message: "Permissões da categoria atualizadas." };
  } catch (error) {
    return { ok: false, message: mensagemErroAcao(error) };
  }
}

export async function criarUsuarioPreAprovado(
  _prev: UsuarioFormState,
  formData: FormData,
): Promise<UsuarioFormState> {
  try {
    if (!(await temPapel("admin"))) {
      return { ok: false, message: "Sem permissão para cadastrar usuários." };
    }

    const id = Number(formData.get("pre_aprovado_id") ?? 0);
    if (!id) return { ok: false, message: "Pré-aprovação inválida." };

    const supabase = await createClient();
    const { data: pre, error: preError } = await supabase
      .from("usuarios_pre_aprovados")
      .select("id, nome, email, papel, permissoes")
      .eq("id", id)
      .single();

    if (preError || !pre?.email) return { ok: false, message: "Pré-aprovação não encontrada." };

    const email = String(pre.email).trim().toLowerCase();
    const nome = String(pre.nome ?? "").trim();
    const papel = isPapelValido(String(pre.papel)) ? String(pre.papel) : "tecnico";
    const admin = createAdminClient();
    const senhaProvisoria = gerarSenhaProvisoria();

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: senhaProvisoria,
      email_confirm: true,
      user_metadata: { nome, senha_provisoria: true },
      app_metadata: appMetadataSenhaProvisoria(),
    });

    if (error || !data.user) {
      const jaExiste = error?.message?.toLowerCase().includes("already");
      return {
        ok: false,
        message: jaExiste ? "Já existe um usuário com este e-mail." : mensagemErroAdminSupabase(error),
      };
    }

    await supabase
      .from("perfis")
      .update({
        nome: nome || null,
        papel,
        permissoes:
          papel === "admin"
            ? {}
            : soExcecoes(normalizePermissions(papel, pre.permissoes ?? {}), await categoriaEfetiva(papel)),
        senha_provisoria: true,
        suspenso: false,
      })
      .eq("id", data.user.id);

    revalidatePath("/usuarios");
    return {
      ok: true,
      message: `Acesso de ${email} criado. ${AVISO_SENHA_PROVISORIA}`,
      senhaProvisoria,
    };
  } catch (error) {
    return { ok: false, message: mensagemErroAcao(error) };
  }
}

/** Suspende (bloqueia login) ou reativa um usuário. */
export async function alternarSuspensao(formData: FormData) {
  try {
    if (!(await temPapel("admin"))) return;
    const id = String(formData.get("id") ?? "");
    const suspender = String(formData.get("suspender") ?? "") === "1";
    if (!id) return;

    // um admin não pode suspender a si mesmo (evita travar o próprio acesso)
    const eu = await usuarioAtual();
    if (suspender && eu?.id === id) return;

    const { error: authError } = await createAdminClient().auth.admin.updateUserById(id, {
      ban_duration: suspender ? BAN_SUSPENSO : "none",
    });
    if (authError) return;

    const supabase = await createClient();
    await supabase.from("perfis").update({ suspenso: suspender }).eq("id", id);
    revalidatePath("/usuarios");
  } catch {
    return;
  }
}

export async function salvarAssinaturaUsuario(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await temPapel("admin"))) {
    return { ok: false, message: "Sem permissão para alterar assinatura." };
  }

  const id = String(formData.get("id") ?? "");
  const dataUrl = String(formData.get("assinatura_data_url") ?? "");
  const arquivo = formData.get("assinatura") as File | null;
  if (!id) return { ok: false, message: "Usuário inválido." };
  if (!arquivo || arquivo.size <= 0 || !dataUrl.startsWith("data:image/png;base64,")) {
    return { ok: false, message: "Envie uma assinatura em PNG." };
  }
  if (arquivo.size > 600_000 || dataUrl.length > 850_000) {
    return { ok: false, message: "A assinatura está muito grande. Use um PNG menor." };
  }

  const path = `${id}/assinatura.png`;
  const supabase = await createClient();
  const { error: uploadError } = await supabase.storage
    .from(BUCKET_ASSINATURAS)
    .upload(path, arquivo, { contentType: "image/png", upsert: true });
  if (uploadError) return { ok: false, message: uploadError.message };

  const { error } = await supabase
    .from("perfis")
    .update({ assinatura_path: path, assinatura_url: dataUrl })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/usuarios");
  return { ok: true, message: "Assinatura salva sem fundo." };
}

export async function removerAssinaturaUsuario(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await temPapel("admin"))) {
    return { ok: false, message: "Sem permissão para remover assinatura." };
  }
  const id = String(formData.get("id") ?? "");
  const path = String(formData.get("assinatura_path") ?? "");
  if (!id) return { ok: false, message: "Usuário inválido." };

  const supabase = await createClient();
  if (path) {
    await supabase.storage.from(BUCKET_ASSINATURAS).remove([path]);
  }
  const { error } = await supabase
    .from("perfis")
    .update({ assinatura_path: null, assinatura_url: null })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/usuarios");
  return { ok: true, message: "Assinatura removida." };
}

/**
 * Exclui um usuário definitivamente (Auth + perfil por cascade). Ação
 * irreversível — a auditoria das ações que ele registrou permanece.
 */
export async function excluirUsuario(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    if (!(await temPapel("admin"))) {
      return { ok: false, message: "Sem permissão para excluir usuários." };
    }
    const id = String(formData.get("id") ?? "");
    const email = String(formData.get("email") ?? "");
    if (!id) return { ok: false, message: "Usuário inválido." };

    // um admin não pode excluir a si mesmo
    const eu = await usuarioAtual();
    if (eu?.id === id) return { ok: false, message: "Você não pode excluir o seu próprio usuário." };

    const { error } = await createAdminClient().auth.admin.deleteUser(id);
    if (error) return { ok: false, message: mensagemErroExclusaoUsuario(error) };

    revalidatePath("/usuarios");
    return { ok: true, message: `Usuário ${email || ""} excluído.` };
  } catch (error) {
    return { ok: false, message: mensagemErroAcao(error) };
  }
}
