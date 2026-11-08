// Prepara o banco LOCAL (Supabase CLI/Docker) para os E2E contra banco real.
//
// Cria dois usuários de teste pelo Auth admin e define a função de cada um:
//   - administrador (pode tudo);
//   - compra (função de nível 0, sem "Editar cadastros" nem "Auditoria").
//
// Trava de segurança: só roda contra Supabase em 127.0.0.1/localhost. Nunca
// aponte para produção. As chaves vêm de `supabase status -o env` no CI.
import { createClient } from "@supabase/supabase-js";

const HOSTS_LOCAIS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export const USUARIOS_E2E = [
  { email: "admin.e2e@kontrol.local", nome: "Admin E2E Real", papel: "admin" },
  { email: "compra.e2e@kontrol.local", nome: "Compra E2E Real", papel: "compra" },
];

export function urlLocalOuErro(url) {
  let host;
  try {
    host = new URL(url ?? "").hostname;
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL ausente ou inválida.");
  }
  if (!HOSTS_LOCAIS.has(host)) {
    throw new Error(`Recusado: ${host} não é um Supabase local. Os E2E reais só rodam no Docker.`);
  }
  return url;
}

async function main() {
  const url = urlLocalOuErro(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const senha = process.env.E2E_REAL_SENHA;
  if (!chave) throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente (use a do Supabase local).");
  if (!senha || senha.length < 12) throw new Error("E2E_REAL_SENHA ausente ou curta (mínimo 12).");

  const admin = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });

  for (const u of USUARIOS_E2E) {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email,
      password: senha,
      email_confirm: true,
      user_metadata: { nome: u.nome },
      // 0132: só nasce ativo quem o administrador cadastrou.
      app_metadata: { cadastrado_pelo_admin: true },
    });
    if (error) throw new Error(`Não criou ${u.email}: ${error.message}`);

    const { error: erroPerfil } = await admin
      .from("perfis")
      .update({ papel: u.papel, nome: u.nome, suspenso: false, senha_provisoria: false })
      .eq("id", data.user.id);
    if (erroPerfil) throw new Error(`Não definiu a função de ${u.email}: ${erroPerfil.message}`);
    console.log(`ok: ${u.email} (${u.papel})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((erro) => {
    console.error(erro.message);
    process.exit(1);
  });
}
