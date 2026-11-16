import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { destinoAposLink, tipoLinkEmail } from "@/lib/auth/link-email";

/**
 * Abre a sessão a partir do link do e-mail do Supabase (recuperação de senha,
 * convite). Aceita os dois formatos:
 * - `?code=...` (PKCE, padrão do @supabase/ssr; só funciona no mesmo navegador
 *   em que a pessoa pediu o link);
 * - `?token_hash=...&type=recovery` (modelo de e-mail com {{ .TokenHash }},
 *   funciona em qualquer aparelho).
 * Falhou ou venceu: volta ao /login com o aviso.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const tipo = tipoLinkEmail(params.get("type"));

  const falha = (motivo: string) => {
    const url = new URL("/login", request.url);
    url.searchParams.set("erro", motivo);
    return NextResponse.redirect(url);
  };

  const erroSupabase = params.get("error_code") ?? params.get("error");
  if (erroSupabase) return falha(erroSupabase === "otp_expired" ? "otp_expired" : "link");
  if (!code && !(tokenHash && tipo)) return falha("link");

  const response = NextResponse.redirect(new URL(destinoAposLink(tipo, params.get("next")), request.url));
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ type: tipo!, token_hash: tokenHash! });
  if (error) {
    console.error(`[auth/confirmar] ${error.code ?? ""} ${error.message}`);
    return falha(error.code === "otp_expired" ? "otp_expired" : "link");
  }

  return response;
}
