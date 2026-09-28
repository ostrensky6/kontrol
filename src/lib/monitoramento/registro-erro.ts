/**
 * Forma do registro de erro gravado em `erros_app` (0141). Sem dependência de
 * servidor: a normalização é testada à parte e também serve à rota que recebe
 * os erros do navegador.
 */

export type OrigemErro = "servidor" | "navegador" | "banco";

export type RegistroErro = {
  origem: OrigemErro;
  mensagem: string;
  rota?: string | null;
  codigo?: string | null;
  digest?: string | null;
  detalhe?: string | null;
  usuarioId?: string | null;
};

export type LinhaErroApp = {
  origem: OrigemErro;
  mensagem: string;
  rota: string | null;
  codigo: string | null;
  digest: string | null;
  detalhe: string | null;
  usuario_id: string | null;
};

// Mesmos limites dos checks da 0141.
const LIMITES = { mensagem: 2000, rota: 500, codigo: 100, digest: 100, detalhe: 8000 } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cortar(valor: unknown, limite: number): string | null {
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  if (!texto) return null;
  return texto.length > limite ? `${texto.slice(0, limite - 1)}…` : texto;
}

/**
 * Tira da rota o que não deve ir para o registro: a consulta (?a=b) e trechos
 * que parecem token, como o do link público da proposta (/aprovar/<token>).
 */
export function limparRota(rota: unknown): string | null {
  const texto = cortar(rota, 2000);
  if (!texto) return null;
  const semConsulta = texto.split(/[?#]/)[0] ?? "";
  const limpa = semConsulta
    .split("/")
    .map((parte) => (/^[A-Za-z0-9_-]{24,}$/.test(parte) ? ":token" : parte))
    .join("/");
  return cortar(limpa, LIMITES.rota);
}

export function normalizarRegistro(registro: RegistroErro): LinhaErroApp {
  return {
    origem: registro.origem,
    mensagem: cortar(registro.mensagem, LIMITES.mensagem) ?? "Erro sem mensagem",
    rota: limparRota(registro.rota),
    codigo: cortar(registro.codigo, LIMITES.codigo),
    digest: cortar(registro.digest, LIMITES.digest),
    detalhe: cortar(registro.detalhe, LIMITES.detalhe),
    usuario_id: typeof registro.usuarioId === "string" && UUID.test(registro.usuarioId) ? registro.usuarioId : null,
  };
}
