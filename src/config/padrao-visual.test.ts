import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Padrão visual da revisão de 11/11 (seção 10): estas contagens só podem
 * diminuir. Se este teste falhar, a mudança trouxe de volta algo que o padrão
 * tirou; use os componentes padrão (PageHeader, Campo, DataTable) em vez de
 * aumentar o limite.
 */
const SRC = path.resolve(__dirname, "..");

function arquivos(dir: string, extensoes: string[]): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = path.join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho, extensoes);
    return extensoes.some((ext) => nome.endsWith(ext)) && !nome.includes(".test.") ? [caminho] : [];
  });
}

const telas = arquivos(SRC, [".tsx"]);
const relativo = (arquivo: string) => path.relative(SRC, arquivo).split(path.sep).join("/");

describe("padrão visual (revisão de 11/11, seção 10)", () => {
  it("título de tela de trabalho tem um tamanho só (20 px)", () => {
    // telas de entrada, institucionais e de impressão têm desenho próprio
    const comDesenhoProprio = [
      "app/login/LoginForm.tsx",
      "app/compras/[id]/imprimir/page.tsx",
      "components/layout/InstitutionalPage.tsx",
    ];
    const foraDoPadrao = telas
      .filter((arquivo) => !comDesenhoProprio.includes(relativo(arquivo)))
      .filter((arquivo) => /<h1[^>]*className="[^"]*\btext-(2xl|3xl|4xl)\b/.test(readFileSync(arquivo, "utf8")))
      .map(relativo);
    expect(foraDoPadrao).toEqual([]);
  });

  it("título de coluna da tabela padrão fica em frase normal, sem maiúsculas forçadas", () => {
    const tabela = readFileSync(path.join(SRC, "components/ui/table.tsx"), "utf8");
    const cabecalho = tabela.slice(tabela.indexOf("function TableHead"), tabela.indexOf("function TableCell"));
    expect(cabecalho).not.toMatch(/\buppercase\b/);
  });

  it("os componentes padrão não usam letra menor que 12 px", () => {
    for (const arquivo of [
      "components/app/PageHeader.tsx",
      "components/common/Campo.tsx",
      "components/common/CriarPorBotao.tsx",
      "components/common/DataTable.tsx",
      "components/layout/SubnavAbas.tsx",
      "components/ui/table.tsx",
      "components/ui/label.tsx",
    ]) {
      expect(readFileSync(path.join(SRC, arquivo), "utf8"), arquivo).not.toMatch(/text-\[(9|10|11)px\]/);
    }
  });

  it("letra menor que 12 px só diminui (meta do plano: zero)", () => {
    const LIMITE = 80;
    const total = telas.reduce(
      (soma, arquivo) => soma + (readFileSync(arquivo, "utf8").match(/text-\[(9|10|11)px\]/g)?.length ?? 0),
      0,
    );
    expect(total).toBeLessThanOrEqual(LIMITE);
  });

  it("maiúsculas forçadas só no papel: tela de trabalho escreve em frase normal (revisão de 16/11)", () => {
    // documento impresso e página institucional têm desenho próprio; o resto do
    // app não força maiúsculas em título de coluna, rótulo ou título de seção
    const comDesenhoProprio = [
      "app/compras/[id]/imprimir/page.tsx",
      "components/orcamento/documento/DocumentoProposta.tsx",
      "components/layout/InstitutionalPage.tsx",
    ];
    const comMaiusculas = telas
      .filter((arquivo) => !comDesenhoProprio.includes(relativo(arquivo)))
      .filter((arquivo) => /\buppercase\b/.test(readFileSync(arquivo, "utf8")))
      .map(relativo);
    expect(comMaiusculas).toEqual([]);
  });

  it("linha de tabela e etiqueta usam a cor de borda do tema, não a cor do texto", () => {
    // sem cor declarada, a borda herda a cor do texto e a tabela ganha linhas pretas
    const tabela = readFileSync(path.join(SRC, "components/ui/table.tsx"), "utf8");
    const linha = tabela.slice(tabela.indexOf("function TableRow"), tabela.indexOf("function TableHead("));
    expect(linha).toMatch(/border-b border-border/);
    const etiqueta = readFileSync(path.join(SRC, "components/ui/badge.tsx"), "utf8");
    expect(etiqueta).toMatch(/outline: "border-border/);
    expect(etiqueta).toMatch(/whitespace-nowrap/);
  });

  it("o app tem uma tabela só: tela nenhuma escreve <table> à mão (auditoria de 16/11, item 9)", () => {
    // A tabela é a de components/ui/table.tsx (Table, TableRow, TableCell...) ou a
    // DataTable. Exceção de verdade declara o motivo num comentário logo acima:
    // `tabela-fora-do-padrao: motivo`.
    const aMao: string[] = [];
    for (const arquivo of telas) {
      if (relativo(arquivo) === "components/ui/table.tsx") continue;
      const texto = readFileSync(arquivo, "utf8");
      for (const achado of texto.matchAll(/<table\b/g)) {
        const antes = texto.slice(Math.max(0, achado.index - 400), achado.index);
        if (!/tabela-fora-do-padrao: \S/.test(antes)) {
          aMao.push(`${relativo(arquivo)}:${texto.slice(0, achado.index).split("\n").length}`);
        }
      }
    }
    expect(aMao).toEqual([]);
  });

  it("linha e célula soltas (<tr>, <td>...) só existem dentro de exceção declarada", () => {
    const comParteSolta = telas
      .filter((arquivo) => relativo(arquivo) !== "components/ui/table.tsx")
      .filter((arquivo) => {
        const texto = readFileSync(arquivo, "utf8");
        return /<(thead|tbody|tfoot|tr|th|td)\b/.test(texto) && !texto.includes("tabela-fora-do-padrao:");
      })
      .map(relativo);
    expect(comParteSolta).toEqual([]);
  });

  it("exceção de tabela declarada não aumenta: documento impresso e a grade que vira cartão no celular", () => {
    const declaradas = telas
      .filter((arquivo) => relativo(arquivo) !== "components/ui/table.tsx")
      .filter((arquivo) => readFileSync(arquivo, "utf8").includes("tabela-fora-do-padrao:"))
      .map(relativo)
      .sort();
    expect(declaradas).toEqual([
      "app/compras/[id]/imprimir/page.tsx",
      "app/orcamento/[id]/page.tsx",
      "components/orcamento/documento/DocumentoProposta.tsx",
    ]);
  });

  it("célula da tabela padrão herda o alinhamento vertical, para a linha poder alinhar pelo topo", () => {
    const tabela = readFileSync(path.join(SRC, "components/ui/table.tsx"), "utf8");
    const celulas = tabela.slice(tabela.indexOf("function TableHead("));
    expect(celulas).not.toMatch(/align-middle/);
  });

  it("cabeçalho padrão em uso só aumenta", () => {
    const MINIMO = 8;
    const usam = telas.filter(
      (arquivo) => relativo(arquivo).startsWith("app/") && /<PageHeader\b/.test(readFileSync(arquivo, "utf8")),
    );
    expect(usam.length).toBeGreaterThanOrEqual(MINIMO);
  });
});
