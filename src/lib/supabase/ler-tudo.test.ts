import { describe, expect, it, vi } from "vitest";
import { lerTudo } from "./ler-tudo";

function fonte(total: number) {
  const linhas = Array.from({ length: total }, (_, i) => ({ id: i + 1 }));
  return vi.fn(async (de: number, ate: number) => ({ data: linhas.slice(de, ate + 1), error: null }));
}

describe("lerTudo", () => {
  it("lê mais de mil linhas, até a última página", async () => {
    const consulta = fonte(2345);
    const { data, error } = await lerTudo<{ id: number }>(consulta);
    expect(error).toBeNull();
    expect(data).toHaveLength(2345);
    expect(data.at(-1)).toEqual({ id: 2345 });
    expect(consulta).toHaveBeenCalledTimes(3);
    expect(consulta).toHaveBeenLastCalledWith(2000, 2999);
  });

  it("total múltiplo de mil faz uma leitura vazia para confirmar o fim", async () => {
    const consulta = fonte(2000);
    expect((await lerTudo(consulta)).data).toHaveLength(2000);
    expect(consulta).toHaveBeenCalledTimes(3);
  });

  it("erro no meio devolve o erro (quem chama decide; nunca parece lista completa)", async () => {
    const consulta = vi
      .fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "timeout" } });
    const { data, error } = await lerTudo(consulta);
    expect(error?.message).toBe("timeout");
    expect(data).toHaveLength(1000);
  });
});
