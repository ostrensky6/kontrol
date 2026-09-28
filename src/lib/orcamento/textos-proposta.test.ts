import { describe, expect, it } from "vitest";
import { docDeTextoPlano, textoParaPlano } from "./texto-rico";
import {
  CHAVE_SECAO_REGEX,
  normalizarTextosProposta,
  resolverTextosDemanda,
  secaoCondicoesLegado,
  secoesImprimiveis,
  textosDaVersao,
  type SecaoPadrao,
  type TextosProposta,
} from "./textos-proposta";

const doc = (texto: string) => docDeTextoPlano(texto);

const padroes: SecaoPadrao[] = [
  { chave: "condicoes", titulo: "Condições comerciais", texto: doc("Pagamento em 30 dias."), ordem: 30, ativo: true },
  { chave: "prazos", titulo: "Prazos", texto: "Entrega em 60 dias.", ordem: 10, ativo: true },
  { chave: "confidencialidade", titulo: "Confidencialidade", texto: doc("Sigilo."), ordem: 40, ativo: false },
  { chave: "responsabilidades", titulo: "Responsabilidades das partes", texto: doc("Coleta pelo cliente."), ordem: 20, ativo: true },
];

describe("normalizarTextosProposta", () => {
  it("valor que não é objeto vira null", () => {
    expect(normalizarTextosProposta(null)).toBeNull();
    expect(normalizarTextosProposta(undefined)).toBeNull();
    expect(normalizarTextosProposta("texto")).toBeNull();
    expect(normalizarTextosProposta(42)).toBeNull();
    expect(normalizarTextosProposta([])).toBeNull();
  });

  it("objeto vazio vira textos vazios", () => {
    expect(normalizarTextosProposta({})).toEqual({ descricao: null, secoes: [] });
  });

  it("normaliza a descrição e o texto das seções (string legada vira doc)", () => {
    const r = normalizarTextosProposta({
      descricao: "Objeto do estudo",
      secoes: [{ chave: "prazos", titulo: "Prazos", texto: "60 dias" }],
    });
    expect(r).toEqual({
      descricao: doc("Objeto do estudo"),
      secoes: [{ chave: "prazos", titulo: "Prazos", texto: doc("60 dias") }],
    });
  });

  it("descarta seção com chave inválida ou título vazio", () => {
    const r = normalizarTextosProposta({
      secoes: [
        { chave: "Prazos", titulo: "Maiúscula", texto: null },
        { chave: "a", titulo: "Curta demais", texto: null },
        { chave: "com espaco", titulo: "Espaço", texto: null },
        { chave: 12, titulo: "Número", texto: null },
        { chave: "sem_titulo", titulo: "   ", texto: null },
        { chave: "sem_titulo_2", texto: null },
        "lixo",
        null,
        { chave: "valida_1", titulo: "  Válida  ", texto: null },
      ],
    });
    expect(r?.secoes).toEqual([{ chave: "valida_1", titulo: "Válida", texto: null }]);
  });

  it("chave repetida: a primeira vence", () => {
    const r = normalizarTextosProposta({
      secoes: [
        { chave: "prazos", titulo: "Primeira", texto: "a" },
        { chave: "prazos", titulo: "Segunda", texto: "b" },
      ],
    });
    expect(r?.secoes).toHaveLength(1);
    expect(r?.secoes[0].titulo).toBe("Primeira");
  });

  it("título longo é cortado em 120 caracteres", () => {
    const r = normalizarTextosProposta({ secoes: [{ chave: "longa", titulo: "t".repeat(300), texto: null }] });
    expect(r?.secoes[0].titulo).toHaveLength(120);
  });

  it("no máximo 30 seções", () => {
    const secoes = Array.from({ length: 40 }, (_, i) => ({ chave: `secao_${i}`, titulo: `Seção ${i}`, texto: null }));
    const r = normalizarTextosProposta({ secoes });
    expect(r?.secoes).toHaveLength(30);
    expect(r?.secoes[29].chave).toBe("secao_29");
  });

  it("secoes que não é array vira lista vazia", () => {
    expect(normalizarTextosProposta({ secoes: "x" })).toEqual({ descricao: null, secoes: [] });
  });

  it("regex da chave", () => {
    expect(CHAVE_SECAO_REGEX.test("condicoes")).toBe(true);
    expect(CHAVE_SECAO_REGEX.test("secao_2")).toBe(true);
    expect(CHAVE_SECAO_REGEX.test("x")).toBe(false);
    expect(CHAVE_SECAO_REGEX.test("a".repeat(41))).toBe(false);
    expect(CHAVE_SECAO_REGEX.test("condições")).toBe(false);
  });
});

describe("resolverTextosDemanda", () => {
  it("padrões ativos entram na ordem e inativos ficam de fora", () => {
    const r = resolverTextosDemanda({ salvos: null, padroes, escopoLegado: null });
    expect(r.secoes.map((s) => s.chave)).toEqual(["prazos", "responsabilidades", "condicoes"]);
    expect(r.secoes[0]).toEqual({ chave: "prazos", titulo: "Prazos", texto: doc("Entrega em 60 dias.") });
  });

  it("ordem empatada desempata pela chave", () => {
    const r = resolverTextosDemanda({
      salvos: null,
      padroes: [
        { chave: "zeta", titulo: "Z", texto: null, ordem: 10, ativo: true },
        { chave: "alfa", titulo: "A", texto: null, ordem: 10, ativo: true },
      ],
      escopoLegado: null,
    });
    expect(r.secoes.map((s) => s.chave)).toEqual(["alfa", "zeta"]);
  });

  it("seção salva sobrescreve o padrão pela chave", () => {
    const r = resolverTextosDemanda({
      salvos: { descricao: null, secoes: [{ chave: "prazos", titulo: "Prazos combinados", texto: doc("Entrega em 90 dias.") }] },
      padroes,
      escopoLegado: null,
    });
    expect(r.secoes[0]).toEqual({ chave: "prazos", titulo: "Prazos combinados", texto: doc("Entrega em 90 dias.") });
    expect(r.secoes[1].texto).toEqual(doc("Coleta pelo cliente."));
  });

  it("seção salva com texto vazio continua na lista mas não sai no documento", () => {
    const r = resolverTextosDemanda({
      salvos: { secoes: [{ chave: "condicoes", titulo: "Condições comerciais", texto: null }] },
      padroes,
      escopoLegado: null,
    });
    expect(r.secoes.find((s) => s.chave === "condicoes")).toEqual({
      chave: "condicoes",
      titulo: "Condições comerciais",
      texto: null,
    });
    expect(secoesImprimiveis(r).map((s) => s.chave)).toEqual(["prazos", "responsabilidades"]);
  });

  it("seção salva sem padrão continua, depois dos padrões e na ordem salva", () => {
    const r = resolverTextosDemanda({
      salvos: {
        secoes: [
          { chave: "garantias", titulo: "Garantias", texto: doc("G") },
          { chave: "prazos", titulo: "Prazos", texto: doc("P") },
          { chave: "confidencialidade", titulo: "Sigilo reforçado", texto: doc("S") },
        ],
      },
      padroes,
      escopoLegado: null,
    });
    expect(r.secoes.map((s) => s.chave)).toEqual([
      "prazos",
      "responsabilidades",
      "condicoes",
      "garantias",
      "confidencialidade",
    ]);
    expect(r.secoes[4].titulo).toBe("Sigilo reforçado");
  });

  it("sem textos salvos, a descrição cai no escopo legado", () => {
    const r = resolverTextosDemanda({ salvos: null, padroes: [], escopoLegado: "Escopo antigo\n\nSegundo parágrafo" });
    expect(r.descricao).toEqual(doc("Escopo antigo\n\nSegundo parágrafo"));
  });

  it("com textos salvos, a descrição salva vale mesmo vazia", () => {
    const r = resolverTextosDemanda({ salvos: { descricao: null, secoes: [] }, padroes: [], escopoLegado: "Escopo antigo" });
    expect(r.descricao).toBeNull();
    const r2 = resolverTextosDemanda({ salvos: { descricao: doc("Nova") }, padroes: [], escopoLegado: "Escopo antigo" });
    expect(r2.descricao).toEqual(doc("Nova"));
  });

  it("sem nada, descrição null e sem seções", () => {
    expect(resolverTextosDemanda({ salvos: undefined, padroes: [], escopoLegado: null })).toEqual({ descricao: null, secoes: [] });
  });
});

describe("textosDaVersao", () => {
  const validadeTexto = "Valores válidos por 30 dias a partir da emissão.";
  const textosColuna: TextosProposta = {
    descricao: doc("Da coluna"),
    secoes: [{ chave: "prazos", titulo: "Prazos", texto: doc("Coluna") }],
  };
  const textosSnapshot: TextosProposta = {
    descricao: doc("Do snapshot"),
    secoes: [{ chave: "condicoes", titulo: "Condições", texto: doc("Snapshot") }],
  };

  it("a coluna da versão tem prioridade", () => {
    expect(
      textosDaVersao({ coluna: textosColuna, snapshot: { textos_proposta: textosSnapshot }, escopoLegado: "x", validadeTexto }),
    ).toEqual(textosColuna);
  });

  it("versão sem coluna usa o snapshot", () => {
    expect(
      textosDaVersao({ coluna: null, snapshot: { textos_proposta: textosSnapshot }, escopoLegado: "x", validadeTexto }),
    ).toEqual(textosSnapshot);
  });

  it("versão sem coluna nem snapshot usa o escopo e a seção de condições legada", () => {
    const r = textosDaVersao({ coluna: null, snapshot: { consolidado: {} }, escopoLegado: "Escopo legado", validadeTexto });
    expect(r).toEqual({ descricao: doc("Escopo legado"), secoes: [secaoCondicoesLegado(validadeTexto)] });
    expect(textosDaVersao({ coluna: undefined, snapshot: null, escopoLegado: null, validadeTexto })).toEqual({
      descricao: null,
      secoes: [secaoCondicoesLegado(validadeTexto)],
    });
  });

  it("snapshot com textos inválidos cai no legado", () => {
    const r = textosDaVersao({ coluna: "lixo", snapshot: { textos_proposta: 7 }, escopoLegado: null, validadeTexto });
    expect(r.secoes).toEqual([secaoCondicoesLegado(validadeTexto)]);
  });
});

describe("secaoCondicoesLegado", () => {
  it("lista a validade e o aviso de alteração de escopo", () => {
    const secao = secaoCondicoesLegado("Valores válidos por 30 dias a partir da emissão.");
    expect(secao.chave).toBe("condicoes");
    expect(secao.titulo).toBe("Condições comerciais");
    expect(secao.texto?.content).toHaveLength(1);
    expect(secao.texto?.content[0].type).toBe("bulletList");
    expect(textoParaPlano(secao.texto)).toBe(
      [
        "• Valores válidos por 30 dias a partir da emissão.",
        "• Alterações de escopo, quantidade de amostras, premissas técnicas ou cronograma podem exigir nova versão da proposta.",
      ].join("\n"),
    );
  });
});

describe("secoesImprimiveis", () => {
  it("só seções com texto visível", () => {
    const textos: TextosProposta = {
      descricao: null,
      secoes: [
        { chave: "a_1", titulo: "A", texto: doc("tem") },
        { chave: "b_1", titulo: "B", texto: null },
        { chave: "c_1", titulo: "C", texto: { type: "doc", content: [{ type: "paragraph" }] } },
      ],
    };
    expect(secoesImprimiveis(textos).map((s) => s.chave)).toEqual(["a_1"]);
  });
});
