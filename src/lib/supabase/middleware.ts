import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { acessoDaRota } from "@/config/acesso-modulos";
import { emailAutoLoginDev, ROTA_DEV_LOGIN } from "@/lib/auth/dev-auto-login";

const PUBLICAS = ["/login", "/auth", "/aprovar"];

function isInvalidRefreshToken(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; message?: string; name?: string };
  return (
    err.code === "refresh_token_not_found" ||
    err.name === "AuthSessionMissingError" ||
    String(err.message ?? "").toLowerCase().includes("invalid refresh token")
  );
}

function isSupabaseAuthCookie(name: string) {
  return name.startsWith("sb-") && (name.includes("auth-token") || name.includes("code-verifier"));
}

/** Atualiza a sessão e protege rotas (redireciona não autenticados ao /login). */
export async function updateSession(request: NextRequest) {
  if (process.env.PLAYWRIGHT_MOCK_SUPABASE === "1") {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data, error } = await supabase.auth.getUser();
  let user = data.user;

  if (error && isInvalidRefreshToken(error)) {
    user = null;
    response = NextResponse.next({ request });
    for (const cookie of request.cookies.getAll()) {
      if (isSupabaseAuthCookie(cookie.name)) {
        response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
      }
    }
  }

  const path = request.nextUrl.pathname;
  const publica = PUBLICAS.some((p) => path.startsWith(p));

  if (!user && !publica) {
    const url = request.nextUrl.clone();
    if (emailAutoLoginDev()) {
      // Ambiente local: entra direto, sem senha (ver lib/auth/dev-auto-login.ts).
      url.pathname = ROTA_DEV_LOGIN;
      url.search = "";
      url.searchParams.set("next", path + request.nextUrl.search);
    } else {
      url.pathname = "/login";
    }
    return NextResponse.redirect(url);
  }
  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Usuário com senha provisória: bloqueia tudo até definir a senha
  // definitiva (exceto a própria página de troca).
  if (user && user.app_metadata?.senha_provisoria === true && !path.startsWith("/trocar-senha")) {
    const url = request.nextUrl.clone();
    url.pathname = "/trocar-senha";
    return NextResponse.redirect(url);
  }
  // Já trocou a senha mas ainda tenta acessar a página de troca → home.
  if (user && user.app_metadata?.senha_provisoria !== true && path.startsWith("/trocar-senha")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // A caixinha manda (0124): sem a permissão "Acessar …" a área não abre.
  // Falha fechada: se a consulta das permissões falhar, a área não abre.
  const acesso = user ? acessoDaRota(path) : null;
  if (acesso) {
    const { data: efetivas, error: erroPermissoes } = await supabase.rpc("minhas_permissoes");
    const bruto = efetivas as { admin?: boolean; permissoes?: Record<string, unknown> } | null;
    const liberado =
      !erroPermissoes && (bruto?.admin === true || bruto?.permissoes?.[acesso.chave] === true);
    if (!liberado) {
      const url = request.nextUrl.clone();
      url.pathname = "/sem-acesso";
      url.search = `?area=${encodeURIComponent(acesso.area)}${erroPermissoes ? "&falha=1" : ""}`;
      return NextResponse.redirect(url);
    }
  }

  return response;
}
