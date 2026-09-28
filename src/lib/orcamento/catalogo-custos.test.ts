import { describe, expect, it } from "vitest";
import {
  MESES_VALOR_VELHO,
  lerItemCatalogo,
  origemDoValor,
  ROTULO_EVENTO_CATALOGO,
  valorDesatualizado,
} from "./catalogo-custos";

function formulario(campos: Record<string, string>) {
  const formData = new FormData();
  for (const [chave, valor] of Object.entries(campos)) formData.set(chave, valor);
  return formData;
}

describe("valorDesatualizado (DC7: alerta amarelo a partir de 8 meses)", () => {
  const hoje = new Date("2026-09-28T12:00:00Z");

  it("usa 8 meses como limite", () => {
    expect(MESES_VALOR_VELHO).toBe(8);
    expect(valorDesatualizado("2026-01-27T12:00:00Z", hoje)).toBe(true);
    expect(valorDesatualizado("2026-01-29T12:00:00Z", hoje)).toBe(false);
    expect(valorDesatualizado("2026-06-13T12:22:16Z", hoje)).toBe(false);
  });

  it("sem data ou data inválida não alerta", () => {
    expect(valorDesatualizado(null, hoje)).toBe(false);
    expect(valorDesatualizado("não é data", hoje)).toBe(false);
  });
});

describe("origemDoValor", () => {
  it("proposta, ajuste no catálogo, app antigo ou carga inicial", () => {
    expect(origemDoValor({ valor_origem_demanda_titulo: "Monitoramento Rio X", valor_atualizado_por: "a@b" })).toBe(
      "proposta “Monitoramento Rio X”",
    );
    expect(origemDoValor({ valor_origem_demanda_titulo: null, valor_atualizado_por: "a@b" })).toBe("ajustado no catálogo");
    expect(origemDoValor({ origem: "orcamento_projetos_antigo" })).toBe("carga do app antigo");
    expect(origemDoValor({})).toBe("carga inicial do catálogo");
  });
});

describe("ROTULO_EVENTO_CATALOGO", () => {
  it("tem rótulo para todos os eventos do histórico (0137)", () => {
    for (const evento of ["carga_inicial", "item_novo", "valor_alterado", "edicao_catalogo", "unificacao", "pendente_permissao"]) {
      expect(ROTULO_EVENTO_CATALOGO[evento]).toBeTruthy();
    }
  });
});

describe("lerItemCatalogo", () => {
  it("lê item novo com os campos aparados", () => {
    expect(
      lerItemCatalogo(
        formulario({ rubrica: "MC", descricao: "  Álcool 70%  ", unidade: " litro ", categoria: " Químicos ", preco: "12.5" }),
      ),
    ).toEqual({
      ok: true,
      item: { id: null, rubrica: "MC", descricao: "Álcool 70%", unidade: "litro", categoria: "Químicos", preco: 12.5 },
    });
  });

  it("na edição, valor vazio significa manter o valor atual", () => {
    expect(lerItemCatalogo(formulario({ id: "PE-1", rubrica: "PE", descricao: "Pesquisador", unidade: "mês", preco: "" }))).toEqual({
      ok: true,
      item: { id: "PE-1", rubrica: "PE", descricao: "Pesquisador", unidade: "mês", categoria: null, preco: null },
    });
  });

  it("recusa rubrica inválida, descrição vazia, valor negativo e item novo sem valor", () => {
    expect(lerItemCatalogo(formulario({ rubrica: "XX", descricao: "A", preco: "1" }))).toMatchObject({ ok: false, message: expect.stringContaining("rubrica") });
    expect(lerItemCatalogo(formulario({ rubrica: "MC", descricao: "   ", preco: "1" }))).toMatchObject({ ok: false, message: expect.stringContaining("descrição") });
    expect(lerItemCatalogo(formulario({ rubrica: "MC", descricao: "A", preco: "-1" }))).toMatchObject({ ok: false, message: expect.stringContaining("negativo") });
    expect(lerItemCatalogo(formulario({ rubrica: "MC", descricao: "A", preco: "" }))).toMatchObject({ ok: false, message: expect.stringContaining("valor") });
  });
});
