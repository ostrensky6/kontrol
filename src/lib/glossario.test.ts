import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Glossário da revisão de 11/11 (seção 10.5, decisão 6): uma palavra para
 * cada coisa. Este teste lê o código das telas que a Onda 2 tocou (Estoque,
 * Suprimentos, Cadastros e Início) e acusa a palavra antiga que voltar.
 * Comentários não contam; a ajuda (topics.ts) fica de fora porque guarda as
 * palavras antigas como sinônimos de busca.
 */

const RAIZ = join(__dirname, "..");

const ALVOS = [
  "app/estoque",
  "components/estoque",
  "lib/estoque",
  "app/suprimentos",
  "components/suprimentos",
  "lib/suprimentos",
  "app/cadastros",
  "components/cadastros",
  "lib/cadastros",
  "app/page.tsx",
];

const PALAVRAS_ANTIGAS: { antiga: RegExp; usar: string }[] = [
  { antiga: /Zero no sistema/, usar: "Sem estoque" },
  { antiga: /Sem disponível/, usar: "Sem estoque" },
  { antiga: /Comprar agora/, usar: "Repor" },
  { antiga: /Repor pelo consumo/, usar: "Repor" },
  { antiga: /Reposição aguardando/, usar: "Repor, aguardando aprovação" },
  { antiga: /Estoque OK/, usar: "Em dia" },
  { antiga: /label: "Repos\."|label: "Ponto de reposição"|>\s*Ponto de reposição\s*</, usar: "Mínimo" },
  { antiga: /header: "(Status|Estado|Estágio)"|label: "(Status|Estado)"/, usar: "Situação" },
  { antiga: /header: "Reagente"/, usar: "Insumo" },
  { antiga: /Campanha|campanha/, usar: "Contagem" },
];

function arquivos(caminho: string): string[] {
  const completo = join(RAIZ, caminho);
  if (statSync(completo).isFile()) return [completo];
  return readdirSync(completo, { recursive: true, encoding: "utf8" })
    .map((nome) => join(completo, nome))
    .filter((nome) => /\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome) && statSync(nome).isFile());
}

/** Tira comentários de bloco e de linha (sem confundir com "https://"). */
function semComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Os rótulos antigos guardados de propósito para importar planilhas antigas. */
function semRotulosAntigos(codigo: string): string {
  return codigo.replace(/rotulosAntigos: \[[^\]]*\]/g, "");
}

describe("glossário da revisão (10.5) nas telas da Onda 2", () => {
  const fontes = ALVOS.flatMap(arquivos).map((arquivo) => ({
    arquivo: relative(RAIZ, arquivo),
    codigo: semRotulosAntigos(semComentarios(readFileSync(arquivo, "utf8"))),
  }));

  it("lê as telas certas", () => {
    expect(fontes.length).toBeGreaterThan(40);
    expect(fontes.some((f) => f.arquivo.endsWith("app/estoque/inventario/page.tsx"))).toBe(true);
  });

  for (const { antiga, usar } of PALAVRAS_ANTIGAS) {
    it(`usa “${usar}” em vez de ${antiga}`, () => {
      const achados = fontes.filter((f) => antiga.test(f.codigo)).map((f) => f.arquivo);
      expect(achados).toEqual([]);
    });
  }

  it("prova negativa: o teste acusa a palavra antiga quando ela aparece", () => {
    const amostra = semComentarios('const a = { label: "Repos." }; // Zero no sistema só no comentário');
    expect(PALAVRAS_ANTIGAS.some(({ antiga }) => antiga.test(amostra))).toBe(true);
    expect(/Zero no sistema/.test(amostra)).toBe(false);
  });
});
