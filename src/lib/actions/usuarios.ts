"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { createClient, createClientUntyped } from "@/lib/supabase/server";
import { createAdminClient, mensagemErroAdminSupabase } from "@/lib/supabase/admin";
import { temPapel, usuarioAtual } from "@/lib/auth/roles";
import {
  PRAZO_SENHA_PROVISORIA_DIAS,
  appMetadataSenhaProvisoria,
  gerarSenhaProvisoria,
  validadeSenhaProvisoria,
} from "@/lib/auth/senha-provisoria";
import { isPapelUsuario } from "@/lib/auth/permissions";
import { avaliarTrocaDeFuncao } from "@/lib/auth/contrato-funcao";
import type { Database } from "@/lib/supabase/database.types";
import type { FormState } from "./cadastros";

/** Resultado que carrega a senha provisória gerada, mostrada uma única vez ao administrador. */
export type UsuarioFormState = FormState & {
  senhaProvisoria?: string;
  codigo?: "PERMISSAO_INDIVIDUAL_DESATIVADA" | "PAPEL_ALTERADO";
};

const BUCKET_ASSINATURAS = "user-signatures";
const SENHA_MINIMA = 8;

function negarPermissaoIndividual(formData: FormData): UsuarioFormState | null {
  if (!formData.has("permissoes") && !formData.has("permissoes_presentes")) return null;
  return {
    ok: false,
    codigo: "PERMISSAO_INDIVIDUAL_DESATIVADA",
    message: "Permissões são geridas por função em Governança → Privilégios.",
  };
}

async function sessaoComPapel() {
  const supabase = await createClientUntyped();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) return null;
  const papel = await supabase.rpc("current_papel");
  if (papel.error || !isPapelUsuario(papel.data)) return null;
  return { supabase, id: data.user.id.toLowerCase(), papel: papel.data };
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

type PerfilUpdate = Database["public"]["Tables"]["perfis"]["Update"];

/**
 * Ajusta o perfil que o trigger criou para a conta nova. Se o ajuste falhar
 * (ou o perfil não existir), a conta é desfeita para não sobrar um acesso com
 * o papel padrão; se nem isso der certo, ela fica suspensa e a mensagem diz
 * o que fazer. Devolve null quando está tudo certo.
 */
async function ajustarPerfilDaContaNova(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  email: string,
  dados: Omit<PerfilUpdate, "permissoes" | "papel">,
): Promise<FormState | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("perfis").update(dados).eq("id", userId).select("id");
  if (!error && (data?.length ?? 0) > 0) return null;

  const { error: desfazerError } = await admin.auth.admin.deleteUser(userId);
  if (!desfazerError) {
    return {
      ok: false,
      message: `Não foi possível ajustar o perfil de ${email}; a conta não foi criada. Tente novamente.`,
    };
  }
  const { error: suspenderError } = await admin.auth.admin.updateUserById(userId, { ban_duration: BAN_SUSPENSO });
  return {
    ok: false,
    message: suspenderError
      ? `A conta ${email} foi criada, mas o perfil não foi ajustado e a conta não pôde ser desfeita nem suspensa. Exclua ${email} em Usuários antes de cadastrar de novo.`
      : `A conta ${email} foi criada, mas o perfil não foi ajustado; ela ficou suspensa. Exclua ${email} em Usuários e cadastre de novo.`,
  };
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
    if ((await sessaoComPapel())?.papel !== "admin") {
      return { ok: false, message: "Sem permissão para cadastrar usuários." };
    }
    const recusa = negarPermissaoIndividual(formData);
    if (recusa) return recusa;

    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const nome = String(formData.get("nome") ?? "").trim();
    const papel = formData.get("papel");
    if (!email) return { ok: false, message: "Informe o e-mail do usuário." };
    if (papel !== "laboratorio") {
      return { ok: false, message: "Crie a conta com a função inicial Laboratório; outras funções exigem nomeação separada." };
    }

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

    // O trigger cria em Laboratório; somente a RPC separada muda a função.
    const falhaPerfil = await ajustarPerfilDaContaNova(admin, data.user.id, email, {
      nome: nome || null,
      senha_provisoria: true,
      suspenso: false,
    });
    if (falhaPerfil) return falhaPerfil;

    revalidatePath("/usuarios");
    return {
      ok: true,
      message: `Usuário ${email} criado. ${AVISO_SENHA_PROVISORIA}`,
      senhaProvisoria,
    };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: mensagemErroAcao(error) };
  }
}

/** Edição cadastral continua Admin-only; nenhuma mudança de função é feita aqui. */
export async function editarUsuario(_prev: UsuarioFormState, formData: FormData): Promise<UsuarioFormState> {
  try {
    const ator = await sessaoComPapel();
    if (ator?.papel !== "admin") {
      return { ok: false, message: "Sem permissão para editar usuários." };
    }
    const recusa = negarPermissaoIndividual(formData);
    if (recusa) return recusa;
    const id = String(formData.get("id") ?? "");
    const nomeInformado = formData.get("nome");
    if (!id) return { ok: false, message: "Usuário inválido." };
    if (typeof nomeInformado !== "string") return { ok: false, message: "Informe o nome do usuário." };
    const nome = nomeInformado.trim();

    const { supabase } = ator;
    const alvo = await supabase.from("perfis").select("papel").eq("id", id).maybeSingle();
    if (alvo.error || !isPapelUsuario(alvo.data?.papel)) {
      return { ok: false, message: "Não foi possível confirmar a função atual do usuário." };
    }
    const papelAtual = alvo.data.papel;
    if (formData.getAll("papel").some((legado) => legado !== papelAtual)) {
      return { ok: false, message: "Use a nomeação separada para mudar a função." };
    }
    const { data, error } = await supabase
      .from("perfis")
      .update({ nome: nome || null })
      .eq("id", id)
      .eq("papel", papelAtual)
      .select("id");
    // perfil recusado: o Auth fica como estava
    if (error) return { ok: false, message: error.message };
    if (data?.length !== 1 || data[0]?.id !== id) {
      return { ok: false, message: "O perfil mudou ou a edição não foi permitida." };
    }

    // mantém o nome também no Auth (user_metadata)
    const { error: authError } = await createAdminClient().auth.admin.updateUserById(id, { user_metadata: { nome } });
    if (authError) return { ok: false, message: mensagemErroAdminSupabase(authError) };
    revalidatePath("/usuarios");
    return { ok: true, message: "Usuário atualizado." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: mensagemErroAcao(error) };
  }
}

/** Único canal de troca de função; a 0151 é a autoridade transacional. */
export async function nomearPapelUsuario(_prev: UsuarioFormState, formData: FormData): Promise<UsuarioFormState> {
  try {
    const recusa = negarPermissaoIndividual(formData);
    if (recusa) return recusa;
    const id = String(formData.get("id") ?? "").trim().toLowerCase();
    const atualEsperado = formData.get("papel_atual_esperado");
    const destino = formData.get("papel_destino");
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id) ||
      !isPapelUsuario(atualEsperado) || !isPapelUsuario(destino)) {
      return { ok: false, message: "Dados de nomeação inválidos." };
    }
    const ator = await sessaoComPapel();
    if (!ator || !avaliarTrocaDeFuncao(ator.id, id, ator.papel, atualEsperado, destino)) {
      return { ok: false, message: "Troca de função não autorizada." };
    }
    const alvo = await ator.supabase.from("perfis").select("id, papel").eq("id", id).maybeSingle();
    if (alvo.error || alvo.data?.id !== id || alvo.data.papel !== atualEsperado) {
      return { ok: false, codigo: "PAPEL_ALTERADO", message: "Não foi possível confirmar a função esperada. Recarregue a lista." };
    }
    const { data, error } = await ator.supabase.rpc("nomear_papel_usuario", {
      p_usuario_id: id,
      p_papel_atual_esperado: atualEsperado,
      p_papel_destino: destino,
    });
    if (error?.code === "40001") {
      return { ok: false, codigo: "PAPEL_ALTERADO", message: "A função mudou. Recarregue a lista." };
    }
    // Não confirmar a mutação com HTTP 2xx sozinho ou resposta de outra transição.
    if (error || !data || typeof data !== "object" || Array.isArray(data) ||
      data.usuario_id !== id || data.papel !== destino || data.alterado !== true) {
      return { ok: false, message: "A nomeação não foi confirmada. Recarregue a lista antes de tentar novamente." };
    }
    revalidatePath("/usuarios");
    return { ok: true, message: "Função atualizada." };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: "A nomeação não foi confirmada. Recarregue a lista antes de tentar novamente." };
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

export async function criarUsuarioPreAprovado(
  _prev: UsuarioFormState,
  formData: FormData,
): Promise<UsuarioFormState> {
  try {
    const ator = await sessaoComPapel();
    if (ator?.papel !== "admin") {
      return { ok: false, message: "Sem permissão para cadastrar usuários." };
    }
    const recusa = negarPermissaoIndividual(formData);
    if (recusa) return recusa;

    const id = Number(formData.get("pre_aprovado_id") ?? 0);
    if (!id) return { ok: false, message: "Pré-aprovação inválida." };

    const { data: pre, error: preError } = await ator.supabase
      .from("usuarios_pre_aprovados")
      .select("id, nome, email, papel")
      .eq("id", id)
      .single();

    if (preError || !pre?.email) return { ok: false, message: "Pré-aprovação não encontrada." };

    const email = String(pre.email).trim().toLowerCase();
    const nome = String(pre.nome ?? "").trim();
    const papel = pre.papel;
    if (papel !== "laboratorio") {
      return { ok: false, message: "A pré-aprovação não usa a função inicial Laboratório. Nenhuma conta foi criada." };
    }
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

    const falhaPerfil = await ajustarPerfilDaContaNova(admin, data.user.id, email, {
      nome: nome || null,
      senha_provisoria: true,
      suspenso: false,
    });
    if (falhaPerfil) return falhaPerfil;

    revalidatePath("/usuarios");
    return {
      ok: true,
      message: `Acesso de ${email} criado. ${AVISO_SENHA_PROVISORIA}`,
      senhaProvisoria,
    };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: mensagemErroAcao(error) };
  }
}

/**
 * Suspende (bloqueia login) ou reativa um usuário. O bloqueio no Auth e a
 * marca no perfil andam juntos: se o perfil falhar, o Auth volta ao que era.
 */
export async function alternarSuspensao(formData: FormData): Promise<FormState> {
  try {
    if (!(await temPapel("admin"))) return { ok: false, message: "Sem permissão para suspender usuários." };
    const id = String(formData.get("id") ?? "");
    const suspender = String(formData.get("suspender") ?? "") === "1";
    if (!id) return { ok: false, message: "Usuário inválido." };

    // um admin não pode suspender a si mesmo (evita travar o próprio acesso)
    const eu = await usuarioAtual();
    if (suspender && eu?.id === id) {
      return { ok: false, message: "Você não pode suspender o seu próprio usuário." };
    }

    const admin = createAdminClient();
    const { error: authError } = await admin.auth.admin.updateUserById(id, {
      ban_duration: suspender ? BAN_SUSPENSO : "none",
    });
    if (authError) return { ok: false, message: mensagemErroAdminSupabase(authError) };

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("perfis")
      .update({ suspenso: suspender })
      .eq("id", id)
      .select("id");
    if (error || (data?.length ?? 0) === 0) {
      const { error: desfazerError } = await admin.auth.admin.updateUserById(id, {
        ban_duration: suspender ? "none" : BAN_SUSPENSO,
      });
      return {
        ok: false,
        message: desfazerError
          ? "O perfil não foi atualizado e o login ficou diferente do perfil. Tente de novo antes de qualquer outra alteração."
          : `Não foi possível ${suspender ? "suspender" : "reativar"} o usuário; nada foi alterado. Tente novamente.`,
      };
    }
    revalidatePath("/usuarios");
    return { ok: true, message: suspender ? "Usuário suspenso." : "Usuário reativado." };
  } catch (error) {
    return { ok: false, message: mensagemErroAcao(error) };
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
    // arquivo que ficou no Storage = assinatura ainda disponível; não limpa o cadastro
    const { error: removeError } = await supabase.storage.from(BUCKET_ASSINATURAS).remove([path]);
    if (removeError) return { ok: false, message: "Não foi possível apagar o arquivo da assinatura. Tente novamente." };
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
