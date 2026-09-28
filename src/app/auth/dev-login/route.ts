import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { destinoAposDevLogin, emailAutoLoginDev } from "@/lib/auth/dev-auto-login";
import { contaCriadaPeloLinkLocal, prepararContaLocal } from "@/lib/auth/dev-conta-local";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Login automático do ambiente local (ver lib/auth/dev-auto-login.ts).
 * Gera um link mágico no Supabase local e o consome no servidor, gravando
 * os cookies de sessão — sem senha e sem e-mail.
 */
export async function GET(request: NextRequest) {
  const email = emailAutoLoginDev();
  if (!email) return new NextResponse(null, { status: 404 });

  const falha = (motivo: string) => {
    console.error(`[dev-login] ${motivo}`);
    return NextResponse.redirect(new URL("/login", request.url));
  };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return falha(`não foi possível gerar o link para ${email}: ${error?.message ?? "sem token"}`);

  // Banco local zerado: o link recriou a conta, que nasce suspensa (0132).
  // Promove antes de abrir a sessão, para o token já sair com o papel certo.
  if (data.user && contaCriadaPeloLinkLocal(data.user)) {
    const motivo = await prepararContaLocal(admin, data.user.id);
    if (motivo) return falha(motivo);
  }

  const destino = destinoAposDevLogin(request.nextUrl.searchParams.get("next"));
  const response = NextResponse.redirect(new URL(destino, request.url));

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

  const { error: otpError } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  if (otpError) return falha(`não foi possível abrir a sessão de ${email}: ${otpError.message}`);

  return response;
}
