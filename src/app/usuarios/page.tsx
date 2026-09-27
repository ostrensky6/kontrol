import { createClient } from "@/lib/supabase/server";
import { temPapel } from "@/lib/auth/roles";
import { PAPEIS } from "@/lib/auth/permissions";
import { buildPermissoesPorCategoria } from "@/lib/auth/permission-categories";
import { CriarUsuarioForm } from "@/components/usuarios/CriarUsuarioForm";
import { PermissoesCategoriasTable } from "@/components/usuarios/PermissoesCategoriasTable";
import { UsuariosTable, type UsuarioRow } from "@/components/usuarios/UsuariosTable";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  if (!(await temPapel("admin"))) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 text-center font-sans">
        <p className="text-muted-foreground">Acesso restrito — apenas administradores gerenciam usuários e permissões.</p>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: perfis } = await supabase
    .from("perfis")
    .select("id, nome, email, papel, criado_em, suspenso, senha_provisoria, assinatura_path, assinatura_url, permissoes")
    .order("email");
  const { data: preAprovados } = await supabase
    .from("usuarios_pre_aprovados")
    .select("id, nome, email, papel, permissoes")
    .order("nome");
  const { data: permissoesCategorias } = await supabase
    .from("permissoes_categorias")
    .select("papel, permissoes");
  const permissoesPorCategoria = buildPermissoesPorCategoria(permissoesCategorias ?? []);
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
    permissoes: perfil.permissoes ?? {},
    categorias: permissoesPorCategoria,
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
      permissoes: pre.permissoes ?? {},
      categorias: permissoesPorCategoria,
    });
  }

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <h1 className="text-xl font-semibold tracking-tight">Usuários e permissões</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Acessos, pré-aprovados, assinaturas e permissões. A categoria define o padrão; em Editar,
          ajuste as permissões de uma pessoa sem mudar a categoria.
        </p>

        <CriarUsuarioForm />

        <div className="mt-6">
          <UsuariosTable rows={linhas} />
        </div>

        <PermissoesCategoriasTable permissoesPorCategoria={permissoesPorCategoria} />
      </main>
    </div>
  );
}
