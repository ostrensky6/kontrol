import { describe, expect, it } from "vitest";

import { falha, mensagemDoBanco, sucesso } from "./erros";

describe("mensagemDoBanco", () => {
  it("mantém as mensagens em português escritas nas RPCs", () => {
    expect(mensagemDoBanco({ code: "P0001", message: "Lote vencido não pode ser usado." })).toBe(
      "Lote vencido não pode ser usado.",
    );
    expect(
      mensagemDoBanco({
        code: "42501",
        message: "Sem permissão para esta ação (compras.receber). Peça ao administrador para liberar em Usuários.",
      }),
    ).toContain("compras.receber");
  });

  it("traduz as mensagens técnicas do Postgres", () => {
    expect(
      mensagemDoBanco({ code: "42501", message: 'new row violates row-level security policy for table "x"' }),
    ).toMatch(/não tem permissão/);
    expect(mensagemDoBanco({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(
      "Já existe um registro com esses dados.",
    );
    expect(mensagemDoBanco({ code: "23503", message: "update or delete violates foreign key" })).toMatch(/em uso/);
    expect(
      mensagemDoBanco({ code: "23503", message: "Este projeto tem pedidos internos. Conclua ou desative em vez de excluir." }),
    ).toMatch(/desative/);
    expect(mensagemDoBanco({ message: 'column "x" does not exist' })).toMatch(/Não foi possível/);
  });

  it("usa o texto padrão informado quando não há mensagem útil", () => {
    expect(mensagemDoBanco(null, "Falhou ao salvar.")).toBe("Falhou ao salvar.");
    expect(mensagemDoBanco({ message: "" }, "Falhou ao salvar.")).toBe("Falhou ao salvar.");
  });

  it("monta o retorno padrão das actions", () => {
    expect(sucesso("Salvo.")).toEqual({ ok: true, message: "Salvo." });
    expect(falha("Erro.", { campo: "Obrigatório" })).toEqual({
      ok: false,
      message: "Erro.",
      errors: { campo: "Obrigatório" },
    });
  });
});
