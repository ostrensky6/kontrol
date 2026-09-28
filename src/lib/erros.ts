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

const CHAVE_RELATOR = Symbol.for("kontrol.relatorErroBanco");

type RelatorErroBanco = (erro: ErroBanco) => void;

/**
 * Quem recebe as recusas técnicas que mensagemDoBanco esconde do usuário. O
 * `instrumentation.ts` liga o registro em `erros_app` (0141) no servidor; fora
 * dele (navegador, testes) ninguém escuta. Fica em globalThis porque o
 * instrumentation e as telas são empacotados separadamente.
 */
export function definirRelatorErroBanco(relator: RelatorErroBanco | null): void {
  (globalThis as Record<symbol, unknown>)[CHAVE_RELATOR] = relator ?? undefined;
}

function relatarErroTecnico(error: ErroBanco): void {
  const relator = (globalThis as Record<symbol, unknown>)[CHAVE_RELATOR];
  if (typeof relator !== "function") return;
  try {
    (relator as RelatorErroBanco)(error);
  } catch {
    // registrar nunca pode atrapalhar a resposta ao usuário
  }
}

/** Conflito de concorrência: esperado, e a mensagem já diz o que fazer. */
const CONCORRENCIA = new Set(["40001", "40P01", "55P03"]);

/**
 * Traduz uma recusa do banco para o usuário. As exceções escritas nas RPCs do
 * Kontrol já estão em português e são mantidas; as mensagens técnicas do
 * Postgres viram um texto curto conforme o código do erro.
 */
export function mensagemDoBanco(error: unknown, padrao: string = PADRAO): string {
  if (!error) return padrao;
  if (typeof error === "string") {
    if (!TECNICA.test(error)) return error;
    relatarErroTecnico({ message: error });
    return padrao;
  }
  if (typeof error !== "object") return padrao;
  const { code, message } = error as ErroBanco;
  const texto = (message ?? "").trim();
  // O texto original some da tela; o registro guarda para quem vai corrigir.
  if ((!texto || TECNICA.test(texto)) && !CONCORRENCIA.has(code ?? "")) {
    relatarErroTecnico(error as ErroBanco);
  }

  switch (code) {
    case "42501":
      // exigir_permissao() já explica qual caixinha falta.
      return texto && !TECNICA.test(texto)
        ? texto
        : "Seu perfil não tem permissão para esta ação. Peça ao administrador para liberar em Usuários.";
    case "23505":
      // RPCs como a do catálogo (0138) dizem qual registro já existe.
      return texto && !TECNICA.test(texto) ? texto : "Já existe um registro com esses dados.";
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
