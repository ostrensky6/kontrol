import { describe, expect, it, vi } from "vitest";

import { encerradosParciais, lerAbertosERecentes } from "./lista-recente";

type Linha = { id: number };

function tabela(total: number, opcoes: { contar?: boolean; erroNaPagina?: number } = {}) {
  const linhas = Array.from({ length: total }, (_, i) => ({ id: i + 1 }));
  return vi.fn(async (de: number, ate: number, contar?: boolean) => {
    if (opcoes.erroNaPagina != null && de >= opcoes.erroNaPagina) {
      return { data: null, error: { message: "sem resposta" } };
    }
    // como o PostgREST: pedir a contagem numa página depois da última linha é erro (416)
    if (contar && de > 0 && de >= total) {
      return { data: null, error: { message: "Requested range not satisfiable", code: "PGRST103" } };
    }
    return {
      data: linhas.slice(de, ate + 1),
      error: null,
      ...(opcoes.contar && contar ? { count: total } : {}),
    };
  });
}

describe("lerAbertosERecentes", () => {
  it("traz tudo o que está em andamento, mesmo passando de mil linhas", async () => {
    const abertos = tabela(2300);
    const lido = await lerAbertosERecentes<Linha>({ abertos, encerrados: tabela(0, { contar: true }) });
    expect(lido.error).toBeNull();
    expect(lido.data).toHaveLength(2300);
    expect(abertos).toHaveBeenCalledTimes(3);
  });

  it("dos encerrados traz só os mais recentes e diz quantos existem", async () => {
    const encerrados = tabela(1240, { contar: true });
    const lido = await lerAbertosERecentes<Linha>({ abertos: tabela(4), encerrados, limite: 300 });
    expect(lido.data).toHaveLength(304);
    expect(lido.encerrados).toEqual({ mostrados: 300, total: 1240 });
    expect(encerradosParciais(lido.encerrados)).toBe(true);
    expect(encerrados).toHaveBeenCalledTimes(1);
    expect(encerrados).toHaveBeenCalledWith(0, 299, true);
  });

  it("com poucos encerrados não há nada parcial", async () => {
    const lido = await lerAbertosERecentes<Linha>({ abertos: tabela(2), encerrados: tabela(12, { contar: true }) });
    expect(lido.encerrados).toEqual({ mostrados: 12, total: 12 });
    expect(encerradosParciais(lido.encerrados)).toBe(false);
  });

  it("sem a contagem do banco, vale o que veio (nunca um total menor que a lista)", async () => {
    const lido = await lerAbertosERecentes<Linha>({ abertos: tabela(0), encerrados: tabela(7) });
    expect(lido.encerrados).toEqual({ mostrados: 7, total: 7 });
  });

  it("um banco que ignora a faixa não faz a lista passar do limite", async () => {
    const semFaixa = vi.fn(async () => ({
      data: Array.from({ length: 50 }, (_, i) => ({ id: i })),
      error: null,
      count: 50,
    }));
    const lido = await lerAbertosERecentes<Linha>({ abertos: tabela(0), encerrados: semFaixa, limite: 20 });
    expect(lido.encerrados).toEqual({ mostrados: 20, total: 50 });
  });

  it("'todos' lê os encerrados de mil em mil", async () => {
    const encerrados = tabela(1240, { contar: true });
    const lido = await lerAbertosERecentes<Linha>({ abertos: tabela(1), encerrados, todos: true });
    expect(lido.data).toHaveLength(1241);
    expect(lido.encerrados).toEqual({ mostrados: 1240, total: 1240 });
    expect(encerrados).toHaveBeenCalledTimes(2);
  });

  it("'todos' com um múltiplo exato de mil não esbarra na página vazia do fim", async () => {
    const encerrados = tabela(2000, { contar: true });
    const lido = await lerAbertosERecentes<Linha>({ abertos: tabela(0), encerrados, todos: true });
    expect(lido.error).toBeNull();
    expect(lido.encerrados).toEqual({ mostrados: 2000, total: 2000 });
    expect(encerrados).toHaveBeenLastCalledWith(2000, 2999, false);
  });

  it("devolve o erro de qualquer das duas leituras, com o que já tinha lido", async () => {
    const falhaAbertos = await lerAbertosERecentes<Linha>({
      abertos: tabela(1500, { erroNaPagina: 1000 }),
      encerrados: tabela(3, { contar: true }),
    });
    expect(falhaAbertos.error).toEqual({ message: "sem resposta" });
    expect(falhaAbertos.data).toHaveLength(1003);

    const falhaEncerrados = await lerAbertosERecentes<Linha>({
      abertos: tabela(2),
      encerrados: tabela(3, { erroNaPagina: 0 }),
    });
    expect(falhaEncerrados.error).toEqual({ message: "sem resposta" });
    expect(falhaEncerrados.data).toHaveLength(2);
  });
});
