import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guarda da auditoria de 16/11 (item 2): toda gravação conferir se gravou.
 *
 * Com RLS, um UPDATE ou DELETE que não alcança nenhuma linha volta sem erro.
 * Só `.select()` na mesma cadeia mostra o que o banco gravou de verdade; sem
 * ele a tela diz "salvo" para algo que não mudou. Toda cadeia
 * `.from(...).update(...)` ou `.from(...).delete()` do aplicativo precisa de
 * `.select(...)`; a exceção (gravação de melhor esforço) leva, nas linhas
 * acima, um comentário com `escrita-sem-conferencia: <motivo>`.
 */
const SRC = fileURLToPath(new URL("../..", import.meta.url));
const MARCA = "escrita-sem-conferencia:";

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

type Escrita = { onde: string; cadeia: string; conferida: boolean; marcada: boolean };

/** Cadeias de gravação do Supabase encontradas no texto de um arquivo. */
function escritasDoTexto(texto: string, onde = "texto"): Escrita[] {
  const achadas: Escrita[] = [];
  const re = /\.(update|delete)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    // só conta o que vem de uma tabela: `.from(` no mesmo comando, antes da gravação
    const inicio = Math.max(
      texto.lastIndexOf(";", m.index),
      texto.lastIndexOf("{", m.index),
      texto.lastIndexOf("}", m.index),
    );
    if (!/\.from\(/.test(texto.slice(inicio + 1, m.index))) continue;
    // segue a cadeia até o fim do comando (`;` no nível zero ou o fecho de quem a contém)
    let profundidade = 0;
    let fim = texto.length;
    for (let i = m.index; i < texto.length; i += 1) {
      const c = texto[i];
      if (c === "(" || c === "[" || c === "{") profundidade += 1;
      else if (c === ")" || c === "]" || c === "}") {
        profundidade -= 1;
        if (profundidade < 0) {
          fim = i;
          break;
        }
      } else if (c === ";" && profundidade === 0) {
        fim = i;
        break;
      }
    }
    const cadeia = texto.slice(m.index, fim);
    const linha = texto.slice(0, m.index).split("\n").length;
    const acima = texto
      .split("\n")
      .slice(Math.max(0, linha - 5), linha)
      .join("\n");
    achadas.push({
      onde: `${onde}:${linha}`,
      cadeia: cadeia.replace(/\s+/g, " ").slice(0, 100),
      conferida: /\.select\(/.test(cadeia),
      marcada: acima.includes(MARCA),
    });
  }
  return achadas;
}

describe("guarda: gravação sem conferência", () => {
  const todas = arquivos(SRC)
    .filter((caminho) => !caminho.includes(`${join("lib", "testing")}`))
    .flatMap((caminho) => escritasDoTexto(readFileSync(caminho, "utf8"), relative(SRC, caminho)));

  it("encontra as gravações do aplicativo (a busca não ficou cega)", () => {
    expect(todas.length).toBeGreaterThan(60);
  });

  it("todo update e delete confere a linha gravada ou declara o motivo", () => {
    const semConferencia = todas.filter((e) => !e.conferida && !e.marcada).map((e) => `${e.onde}  ${e.cadeia}`);
    expect(semConferencia).toEqual([]);
  });

  it("a exceção é rara e sempre justificada", () => {
    const marcadas = todas.filter((e) => !e.conferida && e.marcada);
    // hoje: demanda em análise, limpeza de triagem, compensação de triagem e registro de erro de e-mail
    expect(marcadas.length).toBeLessThanOrEqual(6);
  });

  it("reconhece a gravação sem select e aceita a que confere", () => {
    const ruim = escritasDoTexto('await supabase.from("x").update({ a: 1 }).eq("id", 1);');
    expect(ruim).toHaveLength(1);
    expect(ruim[0].conferida).toBe(false);

    const boa = escritasDoTexto('const { data } = await supabase.from("x").delete().eq("id", 1).select("id");');
    expect(boa[0].conferida).toBe(true);

    const marcada = escritasDoTexto(
      '// escrita-sem-conferencia: melhor esforço\nawait supabase.from("x").update({ a: 1 }).eq("id", 1);',
    );
    expect(marcada[0].marcada).toBe(true);

    // Map.delete, hash.update e afins não são gravação no banco
    expect(escritasDoTexto('mapa.delete(chave); createHash("sha256").update(bytes);')).toHaveLength(0);
  });
});
