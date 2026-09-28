import { afterEach, describe, expect, it, vi } from "vitest";

import { definirRelatorErroBanco, mensagemDoBanco } from "./erros";

describe("mensagemDoBanco avisa o monitor de erros (0141)", () => {
  afterEach(() => definirRelatorErroBanco(null));

  it("entrega ao relator o erro técnico que a tela esconde", () => {
    const relator = vi.fn();
    definirRelatorErroBanco(relator);
    const erro = { code: "42703", message: 'column "x" does not exist', details: "linha 3" };

    expect(mensagemDoBanco(erro)).toMatch(/Não foi possível concluir/);
    expect(relator).toHaveBeenCalledWith(erro);
  });

  it("também avisa quando a recusa técnica vem como texto ou sem mensagem", () => {
    const relator = vi.fn();
    definirRelatorErroBanco(relator);

    mensagemDoBanco("fetch failed");
    mensagemDoBanco({ code: "XX000" });

    expect(relator).toHaveBeenCalledTimes(2);
  });

  it("não avisa recusas de negócio em português nem conflito de concorrência", () => {
    const relator = vi.fn();
    definirRelatorErroBanco(relator);

    mensagemDoBanco({ code: "P0001", message: "Lote vencido não pode ser usado." });
    mensagemDoBanco({ code: "42501", message: "Sem permissão para esta ação (compras.receber)." });
    mensagemDoBanco({ code: "40001", message: "could not serialize access due to concurrent update" });

    expect(relator).not.toHaveBeenCalled();
  });

  it("relator que falha não muda a mensagem ao usuário", () => {
    definirRelatorErroBanco(() => {
      throw new Error("banco fora");
    });

    expect(mensagemDoBanco({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(
      "Já existe um registro com esses dados.",
    );
  });
});
