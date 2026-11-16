import { beforeEach, describe, expect, it, vi } from "vitest";

const registrarErro = vi.fn(async () => undefined);
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("@/lib/monitoramento/erros", () => ({ registrarErro }));
vi.mock("next/navigation", () => ({ notFound }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("novaLeitura", () => {
  it("devolve a resposta como veio e não anota nada quando o banco respondeu", async () => {
    const { novaLeitura } = await import("./leitura");
    const leitura = novaLeitura("/compras");
    const resposta = { data: [{ id: 1 }], error: null };

    expect(await leitura.de("compras", Promise.resolve(resposta))).toBe(resposta);
    expect(leitura.falhas).toEqual([]);
    expect(registrarErro).not.toHaveBeenCalled();
  });

  it("anota o rótulo e registra o erro quando a leitura falha", async () => {
    const { novaLeitura } = await import("./leitura");
    const leitura = novaLeitura("/compras");
    const resposta = { data: null, error: { message: "timeout", code: "57014" } };

    expect(await leitura.de("compras", Promise.resolve(resposta))).toBe(resposta);
    expect(leitura.falhas).toEqual(["compras"]);
    expect(registrarErro).toHaveBeenCalledWith({
      origem: "banco",
      mensagem: "Leitura falhou (compras): timeout",
      rota: "/compras",
      codigo: "57014",
    });
  });

  it("não repete o rótulo de duas leituras da mesma coisa", async () => {
    const { novaLeitura } = await import("./leitura");
    const leitura = novaLeitura("/projetos/[id]");
    const falha = { data: null, error: { message: "fora" } };

    await leitura.de("projetos", Promise.resolve(falha));
    await leitura.de("projetos", Promise.resolve(falha));
    await leitura.de("clientes", Promise.resolve(falha));

    expect(leitura.falhas).toEqual(["projetos", "clientes"]);
  });

  it("registro que não existe (.single sem linha) não é falha de leitura", async () => {
    const { novaLeitura } = await import("./leitura");
    const leitura = novaLeitura("/pedido/[id]");

    await leitura.de("pedidos", Promise.resolve({ data: null, error: { message: "0 rows", code: "PGRST116" } }));

    expect(leitura.falhas).toEqual([]);
    expect(registrarErro).not.toHaveBeenCalled();
  });

  it("anotar serve à resposta que a tela leu por conta própria", async () => {
    const { novaLeitura } = await import("./leitura");
    const leitura = novaLeitura("/planejamento");

    await leitura.anotar("planejamentos", null);
    expect(leitura.falhas).toEqual([]);
    await leitura.anotar("planejamentos", { message: "fora" });
    expect(leitura.falhas).toEqual(["planejamentos"]);
  });
});

describe("semRegistro", () => {
  it("é 'não encontrado' quando o banco respondeu que o registro não existe", async () => {
    const { novaLeitura, semRegistro } = await import("./leitura");
    const leitura = novaLeitura("/pedido/[id]");

    expect(() => semRegistro(leitura)).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("é erro (com tentar de novo) quando a leitura falhou", async () => {
    const { novaLeitura, semRegistro } = await import("./leitura");
    const leitura = novaLeitura("/pedido/[id]");
    await leitura.de("pedidos", Promise.resolve({ data: null, error: { message: "fora" } }));

    expect(() => semRegistro(leitura)).toThrow("A leitura não respondeu (pedidos)");
    expect(notFound).not.toHaveBeenCalled();
  });
});
