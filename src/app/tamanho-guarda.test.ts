import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guarda da auditoria de 16/11 (item 12): tela grande demais vira várias
 * partes. Cadastros tinha 1.816 linhas num arquivo, o pedido 1.314 e o
 * orçamento 1.290; hoje a página carrega os dados e monta as partes, que
 * ficam em `src/components/<área>/...`.
 *
 * Arquivo de tela (`.tsx`) não passa de 1.000 linhas. Ao bater no limite,
 * separe uma parte com props explícitas em vez de aumentar o número.
 */
const SRC = fileURLToPath(new URL("..", import.meta.url));
const LIMITE = 1000;

function telas(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return telas(caminho);
    return nome.endsWith(".tsx") && !nome.includes(".test.") ? [caminho] : [];
  });
}

describe("guarda: tamanho das telas", () => {
  it(`nenhum arquivo de tela passa de ${LIMITE} linhas`, () => {
    const grandes = telas(SRC)
      .map((caminho) => ({ arquivo: relative(SRC, caminho), linhas: readFileSync(caminho, "utf8").split("\n").length }))
      .filter((tela) => tela.linhas > LIMITE)
      .map((tela) => `${tela.arquivo}: ${tela.linhas} linhas`);
    expect(grandes).toEqual([]);
  });

  it("as três telas divididas continuam sendo montagem de partes", () => {
    const linhas = (arquivo: string) => readFileSync(join(SRC, arquivo), "utf8").split("\n").length;
    expect(linhas("components/cadastros/CrudShell.tsx")).toBeLessThan(800);
    expect(linhas("app/pedido/[id]/page.tsx")).toBeLessThan(600);
    expect(linhas("app/orcamento/demandas/[id]/page.tsx")).toBeLessThan(650);
  });
});
