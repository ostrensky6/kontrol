import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { LINHA_EIXO, MARCA_EIXO, tituloEixoX, tituloEixoY } from "./eixos-grafico";

/**
 * Guarda do pedido de Antonio em 11/11/2026: gráfico XY sem a linha dos eixos
 * X e Y é erro. Lê todo arquivo do app que desenha gráfico e acusa o eixo que
 * ficar sem linha, sem marcas ou sem título.
 */

const RAIZ = join(process.cwd(), "src");

function arquivosTsx(pasta: string): string[] {
  return readdirSync(pasta, { recursive: true, encoding: "utf8" })
    .map((nome) => join(pasta, nome))
    .filter((nome) => nome.endsWith(".tsx") && statSync(nome).isFile());
}

/** Cada `<XAxis ... />` ou `<YAxis ... />` do código, inteiro (as chaves podem ter "=>"). */
function eixos(codigo: string): string[] {
  const achados: string[] = [];
  const inicio = /<(XAxis|YAxis)\b/g;
  for (let m = inicio.exec(codigo); m; m = inicio.exec(codigo)) {
    let chaves = 0;
    let fim = m.index;
    for (let i = m.index; i < codigo.length; i += 1) {
      const c = codigo[i];
      if (c === "{") chaves += 1;
      else if (c === "}") chaves -= 1;
      else if (chaves === 0 && c === "/" && codigo[i + 1] === ">") {
        fim = i + 2;
        break;
      }
    }
    achados.push(codigo.slice(m.index, fim));
  }
  return achados;
}

/** O que falta em cada eixo do código: linha, marcas ou título. Vazio quando está certo. */
function problemasDosEixos(codigo: string): string[] {
  const problemas: string[] = [];
  for (const eixo of eixos(codigo)) {
    const nome = eixo.startsWith("<XAxis") ? "eixo X" : "eixo Y";
    if (!/axisLine=\{LINHA_EIXO\}/.test(eixo)) problemas.push(`${nome} sem a linha (axisLine={LINHA_EIXO})`);
    if (!/tickLine=\{MARCA_EIXO\}/.test(eixo)) problemas.push(`${nome} sem as marcas (tickLine={MARCA_EIXO})`);
    if (!/label=\{tituloEixo[XY]\(/.test(eixo)) problemas.push(`${nome} sem título (label={tituloEixo…})`);
  }
  if (/(axisLine|tickLine)=\{false\}/.test(codigo)) problemas.push("eixo com linha ou marca desligada (={false})");
  return problemas;
}

const graficos = arquivosTsx(RAIZ)
  .map((arquivo) => ({ arquivo: relative(RAIZ, arquivo), codigo: readFileSync(arquivo, "utf8") }))
  .filter((f) => /from "recharts"/.test(f.codigo) && /<(XAxis|YAxis)\b/.test(f.codigo));

describe("eixos dos gráficos XY", () => {
  it("lê todos os gráficos do app", () => {
    expect(graficos.map((g) => g.arquivo).sort()).toEqual([
      "components/analises/CustoAnaliseChart.tsx",
      "components/custeio/CusteioAmostrasChart.tsx",
      "components/dashboard/ExecutiveCharts.tsx",
      "components/estoque/PainelSituacaoEstoque.tsx",
    ]);
  });

  it("todo gráfico XY tem os dois eixos, e cada eixo tem linha, marcas e título", () => {
    for (const { arquivo, codigo } of graficos) {
      const nomes = eixos(codigo).map((e) => (e.startsWith("<XAxis") ? "X" : "Y"));
      expect({ arquivo, x: nomes.filter((n) => n === "X").length }).toEqual({
        arquivo,
        x: nomes.filter((n) => n === "Y").length,
      });
      expect({ arquivo, problemas: problemasDosEixos(codigo) }).toEqual({ arquivo, problemas: [] });
    }
  });

  it("a linha do eixo usa a cor do texto, visível no claro e no escuro", () => {
    expect(LINHA_EIXO.stroke).toBe("var(--foreground)");
    expect(LINHA_EIXO.strokeWidth).toBeGreaterThanOrEqual(1);
    expect(MARCA_EIXO.stroke).toBeTruthy();
    expect(tituloEixoX("Mês").value).toBe("Mês");
    expect(tituloEixoY("Gasto (R$)")).toMatchObject({ value: "Gasto (R$)", angle: -90 });
  });

  it("prova negativa: acusa o eixo sem linha, sem marcas, sem título ou desligado", () => {
    expect(problemasDosEixos('<XAxis dataKey="mes" tickLine={false} axisLine={false} />')).toEqual([
      "eixo X sem a linha (axisLine={LINHA_EIXO})",
      "eixo X sem as marcas (tickLine={MARCA_EIXO})",
      "eixo X sem título (label={tituloEixo…})",
      "eixo com linha ou marca desligada (={false})",
    ]);
    expect(
      problemasDosEixos(
        '<YAxis tickLine={MARCA_EIXO} axisLine={LINHA_EIXO} tickFormatter={(v) => f(v)} width={52} />',
      ),
    ).toEqual(["eixo Y sem título (label={tituloEixo…})"]);
    expect(
      problemasDosEixos(
        '<YAxis tickLine={MARCA_EIXO} axisLine={LINHA_EIXO} tickFormatter={(v) => f(v)} label={tituloEixoY("Insumos")} />',
      ),
    ).toEqual([]);
  });
});
