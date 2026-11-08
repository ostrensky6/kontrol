import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { HelpTip } from "@/components/common/HelpTip";
import { usuarioAtual } from "@/lib/auth/roles";
import { isPapelUsuario, PAPEIS } from "@/lib/auth/permissions";
import { avaliarTrocaDeFuncao } from "@/lib/auth/contrato-funcao";
import { CriarUsuarioForm } from "@/components/usuarios/CriarUsuarioForm";
import { UsuariosTable, type UsuarioRow } from "@/components/usuarios/UsuariosTable";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const ator = await usuarioAtual();
  if (!ator || ator.suspenso || ator.papel !== "admin") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 text-center font-sans">
        <p className="text-muted-foreground">Acesso restrito — apenas administradores gerenciam usuários.</p>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: perfis } = await supabase
    .from("perfis")
    .select("id, nome, email, papel, suspenso, senha_provisoria, assinatura_path, assinatura_url")
    .order("email");
  const { data: preAprovados } = await supabase
    .from("usuarios_pre_aprovados")
    .select("id, nome, email, papel")
    .order("nome");
  const papelLabel = new Map(PAPEIS.map((papel) => [papel.value, papel.label]));
  const emailsComAcesso = new Set((perfis ?? []).map((perfil) => String(perfil.email ?? "").toLowerCase()));
  const linhas: UsuarioRow[] = (perfis ?? []).map((perfil) => ({
    id: String(perfil.id),
    userId: String(perfil.id),
    nome: perfil.nome ?? "—",
    email: perfil.email ?? "—",
    papel: perfil.papel,
    papelLabel: papelLabel.get(perfil.papel as (typeof PAPEIS)[number]["value"]) ?? perfil.papel,
    suspenso: Boolean(perfil.suspenso),
    senhaProvisoria: Boolean(perfil.senha_provisoria),
    temAcesso: true,
    assinaturaPath: perfil.assinatura_path ?? null,
    assinaturaUrl: perfil.assinatura_url ?? null,
    papeisDestino: PAPEIS.filter(({ value }) =>
      isPapelUsuario(perfil.papel) &&
      avaliarTrocaDeFuncao(ator.id.toLowerCase(), String(perfil.id).toLowerCase(), ator.papel, perfil.papel, value),
    ).map(({ value }) => value),
  }));
  for (const pre of preAprovados ?? []) {
    const email = String(pre.email ?? "").toLowerCase();
    if (emailsComAcesso.has(email)) continue;
    linhas.push({
      id: `pre-${pre.id}`,
      preAprovadoId: Number(pre.id),
      nome: pre.nome ?? "—",
      email: pre.email ?? "—",
      papel: pre.papel,
      papelLabel: papelLabel.get(pre.papel as (typeof PAPEIS)[number]["value"]) ?? pre.papel,
      suspenso: false,
      senhaProvisoria: false,
      temAcesso: false,
      assinaturaPath: null,
      assinaturaUrl: null,
    });
  }

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex items-center gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Usuários</h1>
          <HelpTip title="Usuários">
            <p>
              Acessos, pré-aprovados, funções, assinaturas e senhas. O que cada função pode fazer fica em{" "}
              <Link href="/governanca/privilegios" className="underline">Governança → Privilégios</Link>.
              Use Editar cadastro para mudar o nome. Quando disponível, Trocar função é uma ação separada.
            </p>
          </HelpTip>
        </div>

        <CriarUsuarioForm />

        <div className="mt-6">
          <UsuariosTable rows={linhas} />
        </div>
      </main>
    </div>
  );
}
