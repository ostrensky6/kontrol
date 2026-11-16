import "server-only";
import { notFound } from "next/navigation";

import { registrarErro } from "@/lib/monitoramento/erros";

/**
 * Leitura que falha não pode virar lista vazia nem zero (auditoria de 16/11,
 * item 1). A tela acompanha cada consulta com `leitura.de("rótulo", consulta)`:
 * a resposta volta como veio e, se o banco não respondeu, o rótulo fica
 * anotado para o aviso `<AvisoLeitura falhas={leitura.falhas} />` e o erro vai
 * para o registro de erros (Governança → Erros).
 */
type ErroLeitura = { message?: unknown; code?: unknown } | null | undefined;

/** `.single()` sem linha é "não encontrado", não falha de leitura. */
const SEM_LINHA = "PGRST116";

export type Leitura = {
  /** Acompanha uma consulta: devolve a resposta e anota o rótulo se ela falhou. */
  de<T extends { error: unknown }>(rotulo: string, consulta: PromiseLike<T>): Promise<T>;
  /** Anota a falha de uma resposta já lida (quando a tela precisa olhar o erro antes). */
  anotar(rotulo: string, erro: unknown): Promise<void>;
  /** Rótulos, sem repetição, das leituras que falharam até aqui. */
  readonly falhas: string[];
};

export function novaLeitura(tela: string): Leitura {
  const falhas: string[] = [];
  async function anotar(rotulo: string, bruto: unknown) {
    const erro = bruto as ErroLeitura;
    if (!erro || erro.code === SEM_LINHA) return;
    if (!falhas.includes(rotulo)) falhas.push(rotulo);
    await registrarErro({
      origem: "banco",
      mensagem: `Leitura falhou (${rotulo}): ${typeof erro.message === "string" ? erro.message : "sem mensagem"}`,
      rota: tela,
      codigo: typeof erro.code === "string" ? erro.code : null,
    });
  }
  return {
    falhas,
    anotar,
    async de(rotulo, consulta) {
      const resposta = await consulta;
      await anotar(rotulo, resposta.error);
      return resposta;
    },
  };
}

/**
 * O registro principal da tela não veio. Se a leitura falhou, é erro (a tela
 * de erro oferece tentar de novo); só é "não encontrado" quando o banco
 * respondeu que ele não existe.
 */
export function semRegistro(leitura: Leitura): never {
  if (leitura.falhas.length > 0) {
    throw new Error(`A leitura não respondeu (${leitura.falhas.join(", ")}). Tente de novo.`);
  }
  notFound();
}
