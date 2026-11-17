import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guarda da chegada única (auditoria de 16/11, item 10). O item da compra
 * aponta para `pedidos_compra` por duas colunas desde a 0130: `pedido_id` (a
 * compra dele) e `compra_pendencia_id` (a nova compra da pendência). Trazer a
 * compra junto do item sem dizer por qual coluna faz o banco recusar a leitura
 * inteira (PGRST201), e o modo simulado não acusa: só o roteiro contra o banco
 * real mostrou que Recebimento e a leitura do estoque ficavam sem essas linhas.
 *
 * Toda leitura de `pedidos_compra_itens` que traz a compra escreve a chave:
 * `pedidos_compra!pedidos_compra_itens_pedido_id_fkey!inner(...)`. O caminho
 * inverso (a compra trazendo os itens, como na página do projeto) também:
 * `pedidos_compra_itens!pedidos_compra_itens_pedido_id_fkey(...)`.
 */
const SRC = fileURLToPath(new URL("../..", import.meta.url));

function fontes(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return nome === "testing" ? [] : fontes(caminho);
    return /\.tsx?$/.test(nome) && !nome.includes(".test.") && nome !== "database.types.ts" ? [caminho] : [];
  });
}

/** Trechos `select(...)` das leituras de `pedidos_compra_itens` de um arquivo. */
function selecoesDeItensDaCompra(texto: string): string[] {
  const trechos: string[] = [];
  const padrao = /from\("pedidos_compra_itens"\)\s*\.select\(([\s\S]*?)\)\s*[.\n;,]/g;
  for (const achado of texto.matchAll(padrao)) trechos.push(achado[1]);
  return trechos;
}

describe("guarda: compra trazida junto do item da compra", () => {
  it("nenhuma leitura traz a compra sem dizer por qual chave", () => {
    const ambiguas = fontes(SRC).flatMap((caminho) => {
      const texto = readFileSync(caminho, "utf8");
      const arquivo = relative(SRC, caminho);
      const achados: string[] = [];
      // forma curta, que o banco recusa quando há duas chaves para a mesma tabela
      if (/pedidos_compra!inner\(/.test(texto)) achados.push(`${arquivo}: pedidos_compra!inner(`);
      for (const selecao of selecoesDeItensDaCompra(texto)) {
        if (/(^|[\s,"'`])pedidos_compra\(/.test(selecao)) achados.push(`${arquivo}: pedidos_compra( sem a chave`);
      }
      // o caminho inverso (a compra trazendo os itens) tem a mesma dúvida
      if (/[\s,"'`]pedidos_compra_itens(!inner)?\(/.test(texto)) achados.push(`${arquivo}: pedidos_compra_itens( sem a chave`);
      return achados;
    });
    expect(ambiguas).toEqual([]);
  });

  it("a regra da chegada única usa a chave do pedido_id", () => {
    const regra = readFileSync(join(SRC, "lib/pedido/chegada-pela-compra.ts"), "utf8");
    expect(regra).toContain("pedidos_compra!pedidos_compra_itens_pedido_id_fkey!inner(id, status)");
  });
});
