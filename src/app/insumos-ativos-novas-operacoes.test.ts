import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PAGINAS = [
  "src/app/compras/[id]/page.tsx",
  "src/app/pedido/[id]/page.tsx",
  "src/app/recebimento/page.tsx",
];

describe("insumos disponíveis para novas operações", () => {
  for (const pagina of PAGINAS) {
    it(`${pagina} seleciona somente cadastros ativos`, () => {
      const fonte = readFileSync(resolve(pagina), "utf8");
      const inicio = fonte.indexOf('.from("insumos")');
      const fim = fonte.indexOf('.order("especificacao")', inicio);

      expect(inicio).toBeGreaterThanOrEqual(0);
      expect(fim).toBeGreaterThan(inicio);
      expect(fonte.slice(inicio, fim)).toContain('.eq("ativo", true)');
    });
  }

  it("preserva só o vínculo atual ao editar item histórico", () => {
    const fonte = readFileSync(resolve("src/app/pedido/[id]/page.tsx"), "utf8");

    expect(fonte.match(/catalogoComVinculoAtual\(catalogoItens, item\)/g)).toHaveLength(2);
  });
});
