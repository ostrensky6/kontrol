import { describe, expect, it } from "vitest";
import {
  docDeTextoPlano,
  LIMITE_TEXTO_CARACTERES,
  normalizarTexto,
  textoParaPlano,
  textoVazio,
  type DocTexto,
} from "./texto-rico";

const docValido: DocTexto = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Subtítulo" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Texto com " },
        { type: "text", text: "negrito", marks: [{ type: "bold" }] },
        { type: "hardBreak" },
        { type: "text", text: "segunda linha" },
      ],
    },
    { type: "paragraph" },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item A" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item B" }] }] },
      ],
    },
    {
      type: "orderedList",
      content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "primeiro" }] }] }],
    },
  ],
};

describe("docDeTextoPlano", () => {
  it("linha em branco separa parágrafos e \\n vira hardBreak", () => {
    expect(docDeTextoPlano("Primeiro\ncontinua\n\nSegundo")).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Primeiro" },
            { type: "hardBreak" },
            { type: "text", text: "continua" },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "Segundo" }] },
      ],
    });
  });

  it("vazio, só espaços, null e undefined viram null", () => {
    expect(docDeTextoPlano("")).toBeNull();
    expect(docDeTextoPlano("   \n\n  ")).toBeNull();
    expect(docDeTextoPlano(null)).toBeNull();
    expect(docDeTextoPlano(undefined)).toBeNull();
  });

  it("bloco em que todas as linhas começam com '- ' ou '• ' vira lista", () => {
    expect(docDeTextoPlano("Condições:\n\n- pagamento em 30 dias\n• impostos inclusos")).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Condições:" }] },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "pagamento em 30 dias" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "impostos inclusos" }] }] },
          ],
        },
      ],
    });
  });

  it("bloco com linhas mistas continua parágrafo", () => {
    const doc = docDeTextoPlano("- item\ntexto comum");
    expect(doc?.content).toHaveLength(1);
    expect(doc?.content[0].type).toBe("paragraph");
  });

  it("\\r\\n é tratado como quebra de linha", () => {
    expect(docDeTextoPlano("a\r\n\r\nb")?.content).toHaveLength(2);
  });
});

describe("normalizarTexto", () => {
  it("null, undefined e valores que não são texto viram null", () => {
    expect(normalizarTexto(null)).toBeNull();
    expect(normalizarTexto(undefined)).toBeNull();
    expect(normalizarTexto(42)).toBeNull();
    expect(normalizarTexto(true)).toBeNull();
    expect(normalizarTexto([])).toBeNull();
    expect(normalizarTexto({ type: "paragraph", content: [] })).toBeNull();
  });

  it("string legada vira parágrafos", () => {
    expect(normalizarTexto("Um\n\nDois")).toEqual(docDeTextoPlano("Um\n\nDois"));
  });

  it("documento válido passa sem alteração", () => {
    expect(normalizarTexto(docValido)).toEqual(docValido);
    expect(normalizarTexto(normalizarTexto(docValido))).toEqual(docValido);
  });

  it("devolve cópia, não o próprio objeto", () => {
    expect(normalizarTexto(docValido)).not.toBe(docValido);
  });

  it("mantém bold e descarta italic e outras marcas", () => {
    const doc = normalizarTexto({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "forte", marks: [{ type: "bold" }, { type: "italic" }] },
            { type: "text", text: " inclinado", marks: [{ type: "italic" }, { type: "link", attrs: { href: "x" } }] },
          ],
        },
      ],
    });
    expect(doc).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "forte", marks: [{ type: "bold" }] },
            { type: "text", text: " inclinado" },
          ],
        },
      ],
    });
  });

  it("heading de qualquer nível vira nível 3", () => {
    const doc = normalizarTexto({
      type: "doc",
      content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Título" }] }],
    });
    expect(doc?.content[0]).toEqual({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Título" }] });
  });

  it("blockquote e codeBlock são desembrulhados mantendo o texto; image some", () => {
    const doc = normalizarTexto({
      type: "doc",
      content: [
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "citação" }] }] },
        { type: "image", attrs: { src: "https://exemplo/x.png" } },
        { type: "codeBlock", content: [{ type: "text", text: "linha 1\nlinha 2", marks: [{ type: "code" }] }] },
      ],
    });
    expect(doc).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "citação" }] },
        {
          type: "paragraph",
          content: [{ type: "text", text: "linha 1" }, { type: "hardBreak" }, { type: "text", text: "linha 2" }],
        },
      ],
    });
  });

  it("nó inline desconhecido some, texto e atributos extras são limpos", () => {
    const doc = normalizarTexto({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "center" },
          content: [
            { type: "mention", attrs: { id: "u1" } },
            { type: "text", text: "" },
            { type: "text", text: "a\u0000b\u0007c" },
            { type: "hardBreak", attrs: { x: 1 } },
          ],
        },
      ],
    });
    expect(doc).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "abc" }, { type: "hardBreak" }] }],
    });
  });

  it("lista aninhada é achatada em itens da mesma lista", () => {
    const doc = normalizarTexto({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "pai" }] },
                {
                  type: "orderedList",
                  attrs: { start: 1 },
                  content: [
                    { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "filho 1" }] }] },
                    { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "filho 2" }] }] },
                  ],
                },
              ],
            },
            { type: "listItem", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "irmão" }] }] },
          ],
        },
      ],
    });
    const item = (texto: string) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: texto }] }] });
    expect(doc).toEqual({
      type: "doc",
      content: [{ type: "bulletList", content: [item("pai"), item("filho 1"), item("filho 2"), item("irmão")] }],
    });
  });

  it("lista sem itens é descartada", () => {
    expect(normalizarTexto({ type: "doc", content: [{ type: "bulletList", content: [] }] })).toEqual({
      type: "doc",
      content: [],
    });
  });

  it("texto acima do limite vira null", () => {
    const grande = "x".repeat(LIMITE_TEXTO_CARACTERES + 1);
    expect(normalizarTexto({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: grande }] }] })).toBeNull();
    expect(normalizarTexto(grande)).toBeNull();
    const noLimite = "x".repeat(LIMITE_TEXTO_CARACTERES);
    expect(normalizarTexto(noLimite)).not.toBeNull();
  });

  it("aninhamento absurdo não estoura", () => {
    let no: unknown = { type: "text", text: "fundo" };
    for (let i = 0; i < 5000; i += 1) no = { type: "blockquote", content: [no] };
    expect(() => normalizarTexto({ type: "doc", content: [no] })).not.toThrow();
  });
});

describe("textoVazio", () => {
  it("null e doc só com parágrafos vazios são vazios", () => {
    expect(textoVazio(null)).toBe(true);
    expect(textoVazio(undefined)).toBe(true);
    expect(textoVazio({ type: "doc", content: [] })).toBe(true);
    expect(
      textoVazio({
        type: "doc",
        content: [
          { type: "paragraph" },
          { type: "paragraph", content: [{ type: "text", text: "   " }, { type: "hardBreak" }] },
          { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
        ],
      }),
    ).toBe(true);
  });

  it("qualquer texto visível torna não vazio", () => {
    expect(textoVazio(docValido)).toBe(false);
    expect(
      textoVazio({
        type: "doc",
        content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }] }],
      }),
    ).toBe(false);
  });
});

describe("textoParaPlano", () => {
  it("junta blocos com \\n, listas com '• ' e numeradas com '1. '", () => {
    expect(textoParaPlano(docValido)).toBe(
      ["Subtítulo", "Texto com negrito", "segunda linha", "", "• item A", "• item B", "1. primeiro"].join("\n"),
    );
  });

  it("numeração segue a ordem dos itens", () => {
    const doc = normalizarTexto({
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: ["a", "b", "c"].map((t) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] })),
        },
      ],
    });
    expect(textoParaPlano(doc)).toBe("1. a\n2. b\n3. c");
  });

  it("null vira string vazia", () => {
    expect(textoParaPlano(null)).toBe("");
  });
});
