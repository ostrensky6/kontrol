/**
 * Links de e-mail do Supabase Auth (recuperação de senha, convite).
 *
 * O e-mail leva a pessoa a /auth/confirmar, que troca o código (PKCE) ou o
 * token_hash por uma sessão e só então abre a página certa. Antes (até 2.0.4)
 * o link apontava direto para /login, que ignorava o código, e quando o
 * endereço não estava liberado no Supabase o link caía no "Site URL" do
 * projeto (http://localhost:3000): a pessoa via "página não encontrada".
 */

export const ROTA_CONFIRMAR_LINK = "/auth/confirmar";
export const DESTINO_RECUPERACAO = "/trocar-senha?recuperacao=1";

export type TipoLinkEmail = "recovery" | "invite" | "signup" | "magiclink" | "email" | "email_change";

const TIPOS: readonly TipoLinkEmail[] = ["recovery", "invite", "signup", "magiclink", "email", "email_change"];

export function tipoLinkEmail(valor: string | null | undefined): TipoLinkEmail | null {
  return TIPOS.includes(valor as TipoLinkEmail) ? (valor as TipoLinkEmail) : null;
}

/** Aceita só caminho interno ("/x"), nunca "//host" nem URL completa. */
export function destinoSeguro(next: string | null | undefined, padrao = "/"): string {
  const bruto = next?.trim();
  if (!bruto || !bruto.startsWith("/") || bruto.startsWith("//") || bruto.startsWith("/\\")) return padrao;
  return bruto;
}

/** Para onde ir depois que o link abriu a sessão. */
export function destinoAposLink(tipo: TipoLinkEmail | null, next: string | null | undefined): string {
  if (tipo === "recovery" || tipo === "invite") return DESTINO_RECUPERACAO;
  return destinoSeguro(next);
}

/** Endereço de volta enviado ao Supabase ao pedir o e-mail de recuperação. */
export function urlRetornoRecuperacao(origem: string): string {
  const url = new URL(ROTA_CONFIRMAR_LINK, origem);
  url.searchParams.set("type", "recovery");
  return url.toString();
}

/** Erro que o Supabase devolve na URL quando o link venceu ou já foi usado. */
export function mensagemErroLink(params: {
  erro?: string | null;
  error_code?: string | null;
  error?: string | null;
}): string | null {
  const codigo = params.error_code ?? params.erro ?? params.error;
  if (!codigo) return null;
  if (codigo === "otp_expired" || codigo === "link") {
    return "O link do e-mail venceu ou já foi usado. Peça um novo em \"Recuperar acesso\" e use o mais recente.";
  }
  return "Não foi possível abrir o link do e-mail. Peça um novo em \"Recuperar acesso\".";
}
