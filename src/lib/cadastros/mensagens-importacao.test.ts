import { describe, expect, it } from "vitest";
import { agruparMensagensPorLinha, LINHAS_POR_MENSAGEM } from "./mensagens-importacao";

describe("agruparMensagensPorLinha", () => {
  it("junta a mesma mensagem de várias linhas e mantém as diferentes", () => {
    const grupos = agruparMensagensPorLinha([
      'Insumos · Linha 3, Categoria de compra: valor inválido "EPI"',
      'Insumos · Linha 2, Categoria de compra: valor inválido "EPI"',
      "Insumos · Linha 2: sem Quantidade na embalagem; considerado 1.",
      'Insumos · Linha 4, Categoria de compra: valor inválido "Plástico"',
      "Nenhuma aba de cadastro encontrada.",
    ]);
    expect(grupos.map((grupo) => grupo.texto)).toEqual([
      'Insumos · 2 linhas (2, 3), Categoria de compra: valor inválido "EPI"',
      "Insumos · Linha 2: sem Quantidade na embalagem; considerado 1.",
      'Insumos · Linha 4, Categoria de compra: valor inválido "Plástico"',
      "Nenhuma aba de cadastro encontrada.",
    ]);
  });

  it("corta a lista de linhas com 'e mais'", () => {
    const total = LINHAS_POR_MENSAGEM + 5;
    const mensagens = Array.from({ length: total }, (_, i) => `Linha ${i + 2}: sem Valor da embalagem.`);
    const [grupo] = agruparMensagensPorLinha(mensagens);
    expect(grupo.linhas).toHaveLength(total);
    expect(grupo.texto).toMatch(new RegExp(`^${total} linhas \\(2, 3, .* e mais 5\\), sem Valor da embalagem\\.$`));
  });
});
