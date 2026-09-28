"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, mensagemErroAdminSupabase } from "@/lib/supabase/admin";
import { SENHA_PROVISORIA_LEGADA, senhaProvisoriaVencida } from "@/lib/auth/senha-provisoria";
import type { FormState } from "./cadastros";

function mensagemErroLogin(error: { code?: string; message?: string } | null) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();

  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "E-mail ou senha inválidos.";
  }

  return "Não foi possível conectar ao Supabase Auth. Verifique a conexão e os certificados locais.";
}

export async function entrar(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const senha = String(formData.get("senha") ?? "");
  if (!email || !senha) return { ok: false, message: "Informe e-mail e senha." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) return { ok: false, message: mensagemErroLogin(error) };

  // A senha fixa antiga aparecia na tela de login: não vale mais (1.1.8).
  if (senha === SENHA_PROVISORIA_LEGADA) {
    await supabase.auth.signOut();
    return {
      ok: false,
      message:
        "Essa senha provisória antiga não vale mais. Peça ao administrador uma nova senha provisória.",
    };
  }
  if (senhaProvisoriaVencida(data.user.app_metadata)) {
    await supabase.auth.signOut();
    return {
      ok: false,
      message: "Sua senha provisória venceu. Peça ao administrador uma nova.",
    };
  }

  redirect("/");
}

export async function sair() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function solicitarRedefinicaoSenha(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { ok: false, message: "Informe o e-mail para receber o link de redefinição." };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/login`,
  });

  if (error) return { ok: false, message: "Não foi possível enviar a redefinição agora." };
  return {
    ok: true,
    message: "Se o e-mail existir no Kontrol, o link de redefinição será enviado.",
  };
}

/**
 * Define a senha definitiva de quem entrou com senha provisória. Limpa a
 * flag senha_provisoria no Auth e no perfil. Como updateUser rotaciona a
 * sessão, a baixa em perfis é feita pelo cliente admin (o cliente do
 * usuário ficaria com token defasado e o RLS barraria a escrita).
 */
export async function definirSenhaDefinitiva(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const senha = String(formData.get("senha") ?? "");
    const confirmar = String(formData.get("confirmar") ?? "");
    if (senha.length < 8) return { ok: false, message: "A senha deve ter ao menos 8 caracteres." };
    if (senha === SENHA_PROVISORIA_LEGADA) {
      return { ok: false, message: "Escolha uma senha diferente da senha provisória." };
    }
    if (senha !== confirmar) return { ok: false, message: "As senhas não conferem." };

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, message: "Sessão expirada. Entre novamente." };

    const { error } = await supabase.auth.updateUser({
      password: senha,
      data: { senha_provisoria: false },
    });
    if (error) return { ok: false, message: error.message };

    const admin = createAdminClient();
    const { error: metadataError } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: {
        ...user.app_metadata,
        cadastrado_pelo_admin: true,
        senha_provisoria: false,
        senha_provisoria_expira_em: null,
      },
    });
    if (metadataError) return { ok: false, message: mensagemErroAdminSupabase(metadataError) };

    await admin.from("perfis").update({ senha_provisoria: false }).eq("id", user.id);
  } catch (error) {
    if (error instanceof Error) return { ok: false, message: mensagemErroAdminSupabase(error) };
    return { ok: false, message: "Não foi possível concluir a troca de senha." };
  }

  redirect("/");
}
