/**
 * Retorno padrão das server actions ligadas a formulário. Erro de validação ou
 * recusa do banco volta como `{ ok: false, message }` — nunca como `throw`, que
 * em produção vira a tela genérica do `error.tsx` e apaga o que foi digitado.
 */
export type EstadoAcao = {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
};

export const ESTADO_INICIAL: EstadoAcao = { ok: false };

export function sucesso(message: string): EstadoAcao {
  return { ok: true, message };
}

export function falha(message: string, errors?: Record<string, string>): EstadoAcao {
  return errors ? { ok: false, message, errors } : { ok: false, message };
}

type ErroBanco = { code?: string | null; message?: string | null; details?: string | null };

const PADRAO = "Não foi possível concluir. Tente de novo; se continuar, avise o suporte.";

/** Mensagens em inglês do Postgres/PostgREST que nunca devem chegar à tela. */
const TECNICA = /violates|duplicate key|row-level security|permission denied|foreign key|null value|syntax|relation "|column "|function .*does not exist|invalid input|JSON|fetch failed|timeout|ECONN/i;

/**
 * Traduz uma recusa do banco para o usuário. As exceções escritas nas RPCs do
 * Kontrol já estão em português e são mantidas; as mensagens técnicas do
 * Postgres viram um texto curto conforme o código do erro.
 */
export function mensagemDoBanco(error: unknown, padrao: string = PADRAO): string {
  if (!error) return padrao;
  if (typeof error === "string") return TECNICA.test(error) ? padrao : error;
  if (typeof error !== "object") return padrao;
  const { code, message } = error as ErroBanco;
  const texto = (message ?? "").trim();

  switch (code) {
    case "42501":
      // exigir_permissao() já explica qual caixinha falta.
      return texto && !TECNICA.test(texto)
        ? texto
        : "Seu perfil não tem permissão para esta ação. Peça ao administrador para liberar em Usuários.";
    case "23505":
      return "Já existe um registro com esses dados.";
    case "23503":
      // Os gatilhos de exclusão (0120, 0129) explicam o vínculo e o que fazer.
      return texto && !TECNICA.test(texto)
        ? texto
        : "Este registro está em uso em outro lugar e não pode ser alterado ou excluído.";
    case "23502":
      return "Preencha todos os campos obrigatórios.";
    case "23514":
      return texto && !TECNICA.test(texto) ? texto : "Algum valor está fora do permitido. Confira os campos.";
    case "40001":
    case "40P01":
    case "55P03":
      return "Outra pessoa alterou este registro agora. Recarregue a página e tente de novo.";
  }
  if (/row-level security|permission denied/i.test(texto)) {
    return "Seu perfil não tem permissão para esta ação. Peça ao administrador para liberar em Usuários.";
  }
  if (!texto || TECNICA.test(texto)) return padrao;
  return texto;
}
