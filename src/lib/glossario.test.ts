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
  // 2e: pedidos, compras, recebimento e planejamento
  "app/pedido",
  "components/pedido",
  "lib/pedido",
  "app/compras",
  "components/compras",
  "app/recebimento",
  "app/planejamento",
  "components/planejamento",
  "lib/planejamento",
  "lib/actions/pedidos-internos.ts",
  "lib/actions/compras.ts",
  "lib/actions/estoque.ts",
  "lib/actions/leitura-estoque.ts",
  "components/layout/ContextHelp.tsx",
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
  // "Projeto ou campanha" é a campanha de campo do projeto, não a contagem do inventário.
  { antiga: /(?<!Projeto ou )[Cc]ampanha/, usar: "Contagem" },
  { antiga: /[Pp]edidos? internos?\b/, usar: "Pedido" },
  { antiga: /[Cc]ompras? forma(l|is)\b|[Pp]edidos? de compra/, usar: "Compra" },
  { antiga: /aguardando validação|para validação|\bvalidam\b/, usar: "Aprovar" },
  { antiga: /\+ Entrada|Registrar entrada|Entrada de inventário|Entrada registrada|Confirmar recebimento|Receber compras|Receber pedidos/, usar: "Registrar chegada" },
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

  it("campanha: passa só em “Projeto ou campanha”", () => {
    const regra = PALAVRAS_ANTIGAS.find(({ usar }) => usar === "Contagem")!.antiga;
    expect(regra.test('<Campo rotulo="Projeto ou campanha (texto livre)">')).toBe(false);
    expect(regra.test("Fechar a campanha de inventário")).toBe(true);
    expect(regra.test('header: "Campanha"')).toBe(true);
  });

  it("prova negativa: o teste acusa a palavra antiga quando ela aparece", () => {
    const amostra = semComentarios('const a = { label: "Repos." }; // Zero no sistema só no comentário');
    expect(PALAVRAS_ANTIGAS.some(({ antiga }) => antiga.test(amostra))).toBe(true);
    expect(/Zero no sistema/.test(amostra)).toBe(false);
  });
});

describe("noGlossario: recusas e avisos que vêm prontos do banco", () => {
  it("troca as palavras antigas e mantém o gênero", async () => {
    const { noGlossario } = await import("./glossario");
    expect(noGlossario("Item vinculado a compra formal deve ser recebido pelo pedido de compra.")).toBe(
      "Item vinculado a compra deve ser recebido pela compra.",
    );
    expect(noGlossario("Este pedido interno ja possui compra formal.")).toBe("Este pedido ja possui compra.");
    expect(noGlossario("Pedido interno aguardando validação")).toBe("Pedido aguardando aprovação");
    expect(noGlossario("Pedido interno validado: formalizar a compra")).toBe("Pedido aprovado pelo coordenador: formalizar a compra");
    expect(noGlossario('Escolher o orçamento exige a permissão "Aprovar pedidos internos".')).toBe(
      'Escolher o orçamento exige a permissão "Aprovar pedidos".',
    );
    expect(noGlossario("Faça pelo Pedido (Pedido interno), que leva à FUNPAR, e cancele esta compra.")).toBe(
      "Faça pelo Pedido, que leva à FUNPAR, e cancele esta compra.",
    );
    expect(noGlossario("Há 1 contagem(ns) com diferença sem ajuste aplicado. Aplique os ajustes antes de fechar a campanha.")).toBe(
      "Há 1 item(ns) contado(s) com diferença sem ajuste aplicado. Aplique os ajustes antes de fechar a contagem.",
    );
    expect(noGlossario("A campanha de inventário #4 não está aberta: não recebe contagem nova.")).toBe(
      "A contagem #4 não está aberta: não recebe contagem nova.",
    );
    expect(noGlossario("Este pedido é validado por Sandra (coordenação). Na ausência, o Administrador valida como substituto.")).toBe(
      "Este pedido é aprovado por Sandra (coordenação). Na ausência, o Administrador aprova como substituto.",
    );
  });

  it("prova negativa: texto sem palavra antiga sai igual, e vazio continua vazio", async () => {
    const { noGlossario } = await import("./glossario");
    const texto = "A validade informada (2026-01-01) já passou: material vencido não entra no estoque.";
    expect(noGlossario(texto)).toBe(texto);
    expect(noGlossario("A foto da validação é gravada pelo sistema.")).toBe("A foto da validação é gravada pelo sistema.");
    expect(noGlossario(null)).toBeNull();
    expect(noGlossario("")).toBe("");
  });

  it("mensagemDoBanco já entrega com as palavras do glossário", async () => {
    const { mensagemDoBanco } = await import("./erros");
    expect(mensagemDoBanco({ code: "P0001", message: "Pedido interno não encontrado." })).toBe("Pedido não encontrado.");
    expect(mensagemDoBanco({ code: "42501", message: 'Confirmar a entrega exige a permissão "Aprovar pedidos internos".' })).toBe(
      'Confirmar a entrega exige a permissão "Aprovar pedidos".',
    );
  });
});
