import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Guarda da auditoria de 16/11 (item 1): toda tela avisa quando uma leitura
 * falha. Leitura sem resposta não pode virar lista vazia nem zero.
 *
 * Em cada `page.tsx`, toda consulta feita na função da página
 * (`.from(...)` ou `.rpc(...)`) precisa de um destes:
 *  - estar dentro de `leitura.de("rótulo", consulta)` (o aviso sai em
 *    `<AvisoLeitura falhas={leitura.falhas} />`);
 *  - ter o `error` lido pela própria tela (`{ data, error }` ou `x.error`);
 *  - levar, nas linhas acima, `leitura-sem-aviso: <motivo>`.
 */
const APP = fileURLToPath(new URL(".", import.meta.url));
const MARCA = "leitura-sem-aviso:";
const GRAVACOES = new Set(["insert", "update", "delete", "upsert"]);

function paginas(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return paginas(caminho);
    return nome === "page.tsx" ? [caminho] : [];
  });
}

function leErro(padrao: ts.ObjectBindingPattern) {
  return padrao.elements.some((el) => (el.propertyName ?? el.name).getText() === "error");
}

/** Consultas da função da página que ninguém confere. */
function leiturasSemAviso(texto: string, onde = "page.tsx"): string[] {
  const sf = ts.createSourceFile(onde, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const pagina = sf.statements.find(
    (s): s is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(s) && Boolean(s.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)),
  );
  if (!pagina) return [];
  const linhas = texto.split("\n");
  const semAviso: string[] = [];

  // o que entra em algum leitura.de(...): consultas montadas antes numa variável contam
  const acompanhado: string[] = [];
  const junta = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText() === "leitura.de" && n.arguments[1]) {
      acompanhado.push(n.arguments[1].getText());
    }
    ts.forEachChild(n, junta);
  };
  junta(pagina);

  const dentroDeLeitura = (n: ts.Node) => {
    for (let p = n.parent; p && p !== pagina; p = p.parent) {
      if (ts.isCallExpression(p) && p.expression.getText() === "leitura.de") return true;
    }
    return false;
  };
  const nomeConferido = (nome: ts.BindingName | undefined) => {
    if (!nome) return false;
    if (ts.isObjectBindingPattern(nome)) return leErro(nome);
    if (ts.isIdentifier(nome)) {
      return (
        new RegExp(`\\b${nome.text}\\??\\.error\\b`).test(texto) ||
        acompanhado.some((arg) => new RegExp(`\\b${nome.text}\\b`).test(arg))
      );
    }
    return false;
  };
  /** Quem recebe a resposta: sobe por parênteses, `as`, `? :`, await, Promise.all e lerTudo. */
  const destino = (n: ts.Node): ts.BindingName | undefined => {
    let atual = n;
    for (let p = atual.parent; p; atual = p, p = p.parent) {
      if (ts.isVariableDeclaration(p)) return p.name;
      if (ts.isArrayLiteralExpression(p)) {
        const indice = p.elements.indexOf(atual as ts.Expression);
        const chamada = p.parent;
        const declaracao = ts.isCallExpression(chamada) && ts.isAwaitExpression(chamada.parent) ? chamada.parent.parent : null;
        if (declaracao && ts.isVariableDeclaration(declaracao) && ts.isArrayBindingPattern(declaracao.name)) {
          const el = declaracao.name.elements[indice];
          return el && ts.isBindingElement(el) ? el.name : undefined;
        }
        // Promise.all dentro de um condicional: sem como casar a posição, a tela decide
        return undefined;
      }
      const atravessa =
        ts.isParenthesizedExpression(p) ||
        ts.isAsExpression(p) ||
        ts.isNonNullExpression(p) ||
        ts.isAwaitExpression(p) ||
        ts.isConditionalExpression(p) ||
        ts.isArrowFunction(p) ||
        (ts.isCallExpression(p) && /lerTudo/.test(p.expression.getText()));
      if (!atravessa) return undefined;
    }
    return undefined;
  };

  const visita = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n !== pagina) return;
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ["from", "rpc"].includes(n.expression.name.text) &&
      ts.isIdentifier(n.expression.expression) &&
      !["Array", "Object", "Buffer"].includes(n.expression.expression.text)
    ) {
      let topo: ts.Node = n;
      const metodos: string[] = [];
      while (
        topo.parent &&
        (ts.isPropertyAccessExpression(topo.parent) ||
          (ts.isCallExpression(topo.parent) && topo.parent.expression === topo))
      ) {
        if (ts.isPropertyAccessExpression(topo.parent)) metodos.push(topo.parent.name.text);
        topo = topo.parent;
      }
      if (metodos.some((m) => GRAVACOES.has(m))) return;
      const linha = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      const acima = linhas.slice(Math.max(0, linha - 5), linha).join("\n");
      if (dentroDeLeitura(n) || acima.includes(MARCA) || nomeConferido(destino(topo))) return;
      semAviso.push(`${onde}:${linha}  ${n.getText().slice(0, 70)}`);
      return;
    }
    ts.forEachChild(n, visita);
  };
  visita(pagina);
  return semAviso;
}

describe("guarda: leitura de tela sem aviso", () => {
  const arquivos = paginas(APP);

  it("toda consulta de página é acompanhada ou tem o erro lido pela tela", () => {
    const semAviso = arquivos.flatMap((caminho) =>
      leiturasSemAviso(readFileSync(caminho, "utf8"), relative(APP, caminho)),
    );
    expect(semAviso).toEqual([]);
  });

  it("tela que acompanha leitura mostra o aviso (ou não tem tela para mostrar)", () => {
    const semLugar = arquivos
      .filter((caminho) => {
        const texto = readFileSync(caminho, "utf8");
        return texto.includes("novaLeitura(") && !texto.includes("<AvisoLeitura") && !texto.includes("semRegistro(leitura)");
      })
      .map((caminho) => relative(APP, caminho));
    expect(semLugar).toEqual([]);
  });

  it("a busca não ficou cega: as telas com consulta usam o acompanhamento", () => {
    const comAcompanhamento = arquivos.filter((caminho) => readFileSync(caminho, "utf8").includes("leitura.de(")).length;
    expect(comAcompanhamento).toBeGreaterThan(30);
  });

  it("reconhece a leitura solta e aceita as formas conferidas", () => {
    const pagina = (corpo: string) => `export default async function P() {\n${corpo}\n}`;

    expect(leiturasSemAviso(pagina('const { data } = await supabase.from("x").select("*");'))).toHaveLength(1);
    expect(
      leiturasSemAviso(pagina('const [{ data: a }] = await Promise.all([supabase.from("x").select("*")]);')),
    ).toHaveLength(1);

    expect(
      leiturasSemAviso(pagina('const { data } = await leitura.de("x", supabase.from("x").select("*"));')),
    ).toEqual([]);
    expect(leiturasSemAviso(pagina('const { data, error } = await supabase.from("x").select("*");'))).toEqual([]);
    expect(
      leiturasSemAviso(pagina('const r = await supabase.from("x").select("*");\nif (r.error) throw r.error;')),
    ).toEqual([]);
    expect(
      leiturasSemAviso(pagina('const q = supabase.from("x").select("*");\nconst { data } = await leitura.de("x", q);')),
    ).toEqual([]);
    expect(
      leiturasSemAviso(pagina('// leitura-sem-aviso: só enfeita o título\nconst { data } = await supabase.from("x").select("*");')),
    ).toEqual([]);

    // gravação e Array.from não são leitura de tela
    expect(
      leiturasSemAviso(pagina('await supabase.from("x").insert({ a: 1 });\nconst lista = Array.from(conjunto);')),
    ).toEqual([]);
  });
});
