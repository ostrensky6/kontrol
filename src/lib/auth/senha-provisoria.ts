import { randomInt } from "node:crypto";

/**
 * Senha provisória: gerada na hora, individual, para cada cadastro ou quando o
 * administrador pede uma nova. Ela aparece uma única vez para o administrador,
 * que a repassa à pessoa. No primeiro acesso a pessoa define a senha
 * definitiva em /trocar-senha. A provisória vence em PRAZO_SENHA_PROVISORIA_DIAS.
 */

/** Senha fixa usada até a 1.1.7. Não vale mais para entrar nem como senha nova. */
export const SENHA_PROVISORIA_LEGADA = "GIA2026";

export const PRAZO_SENHA_PROVISORIA_DIAS = 7;

// Sem caracteres que se confundem ao ditar ou copiar à mão (0/O, 1/l/I).
const MAIUSCULAS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const MINUSCULAS = "abcdefghjkmnpqrstuvwxyz";
const DIGITOS = "23456789";
const ALFABETO = MAIUSCULAS + MINUSCULAS + DIGITOS;

/** 12 caracteres em três grupos (ex.: "kx7M-4pqR-29tW"), com maiúscula, minúscula e dígito. */
export function gerarSenhaProvisoria(): string {
  for (;;) {
    let bruto = "";
    for (let i = 0; i < 12; i += 1) bruto += ALFABETO[randomInt(ALFABETO.length)];
    if (/[A-Z]/.test(bruto) && /[a-z]/.test(bruto) && /[2-9]/.test(bruto)) {
      return `${bruto.slice(0, 4)}-${bruto.slice(4, 8)}-${bruto.slice(8)}`;
    }
  }
}

export function validadeSenhaProvisoria(agora = new Date()): string {
  return new Date(agora.getTime() + PRAZO_SENHA_PROVISORIA_DIAS * 86_400_000).toISOString();
}

export function senhaProvisoriaVencida(
  appMetadata: Record<string, unknown> | undefined,
  agora = new Date(),
): boolean {
  if (appMetadata?.senha_provisoria !== true) return false;
  const expira = appMetadata.senha_provisoria_expira_em;
  if (typeof expira !== "string") return false;
  const limite = Date.parse(expira);
  return Number.isFinite(limite) && limite < agora.getTime();
}

/** Marcação no Auth de quem está com senha provisória. */
export function appMetadataSenhaProvisoria(agora = new Date()) {
  return {
    cadastrado_pelo_admin: true,
    senha_provisoria: true,
    senha_provisoria_expira_em: validadeSenhaProvisoria(agora),
  } as const;
}
