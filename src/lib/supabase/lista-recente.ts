import { lerTudo } from "./ler-tudo";

/**
 * Lista de trabalho que cresce para sempre (pedidos, compras): o que está em
 * andamento vem inteiro, sem corte; do que já foi encerrado vêm só os mais
 * recentes, com o total do banco para a tela dizer que há mais.
 *
 * Sem isso a lista carregava a história toda a cada abertura e, passando de
 * mil linhas, o PostgREST cortava o resto sem avisar (auditoria de 16/11,
 * item 3). As duas consultas precisam de ordenação estável (termine em `id`).
 * A de encerrados pede `{ count: "exact" }` só quando `contar` vem ligado: na
 * leitura de todos, em páginas, a contagem não serve para nada e faz o
 * PostgREST recusar a página que cai depois da última linha.
 */
export const LIMITE_ENCERRADOS = 300;

type ErroLeitura = { message: string; code?: string } | null;
type Pagina = PromiseLike<{ data: unknown[] | null; error: ErroLeitura; count?: number | null }>;

export type Encerrados = {
  /** quantos encerrados a lista trouxe */
  mostrados: number;
  /** quantos existem no banco */
  total: number;
};

export type ListaRecente<T> = {
  data: T[];
  error: ErroLeitura;
  encerrados: Encerrados;
};

export async function lerAbertosERecentes<T>({
  abertos,
  encerrados,
  todos = false,
  limite = LIMITE_ENCERRADOS,
}: {
  abertos: (de: number, ate: number) => Pagina;
  encerrados: (de: number, ate: number, contar: boolean) => Pagina;
  /** traz todos os encerrados, de mil em mil */
  todos?: boolean;
  limite?: number;
}): Promise<ListaRecente<T>> {
  const [emAndamento, fim] = await Promise.all([
    lerTudo<T>(abertos),
    todos
      ? lerTudo<T>((de, ate) => encerrados(de, ate, false)).then((lido) => ({ ...lido, total: lido.data.length }))
      : Promise.resolve(encerrados(0, limite - 1, true)).then(({ data, error, count }) => {
          const linhas = ((data ?? []) as T[]).slice(0, limite);
          return { data: linhas, error, total: Math.max(Number(count ?? 0), linhas.length) };
        }),
  ]);
  return {
    data: [...emAndamento.data, ...fim.data],
    error: emAndamento.error ?? fim.error,
    encerrados: { mostrados: fim.data.length, total: fim.total },
  };
}

/** A lista não traz todos os encerrados do banco. */
export function encerradosParciais(encerrados: Encerrados | null | undefined): boolean {
  return Boolean(encerrados && encerrados.mostrados < encerrados.total);
}
