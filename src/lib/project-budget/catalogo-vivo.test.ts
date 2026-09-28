import { describe, expect, it } from "vitest";
import { formatCurrency as brl } from "@/lib/formatters";
import {
  frasesPreviaCatalogo,
  lerPlanoCatalogo,
  mensagemConclusaoCatalogo,
  resumirPlanoCatalogo,
  seloLinhaCatalogo,
  type LinhaPlanoCatalogo,
} from "./catalogo-vivo";

const linha = (extra: Partial<LinhaPlanoCatalogo>): LinhaPlanoCatalogo => ({
  linhaId: 1,
  rubrica: "MC",
  descricao: "Papel toalha",
  unidade: "fardo",
  valor: 55,
  catalogoItemId: "MC-6",
  acao: "inalterado",
  valorCatalogo: 55,
  valorCatalogoEm: "2026-09-12T10:00:00Z",
  ...extra,
});

describe("lerPlanoCatalogo", () => {
  it("converte números vindos como texto e descarta ação desconhecida", () => {
    const plano = lerPlanoCatalogo([
      { linha_id: "7", rubrica: "MC", descricao: "Álcool", unidade: null, valor: "130", catalogo_item_id: "MC-36", acao: "atualizar", valor_catalogo: "120", valor_catalogo_em: null },
      { linha_id: 8, rubrica: "MC", descricao: "X", unidade: "un", valor: 1, catalogo_item_id: null, acao: "apagar", valor_catalogo: null, valor_catalogo_em: null },
    ]);
    expect(plano).toEqual([
      { linhaId: 7, rubrica: "MC", descricao: "Álcool", unidade: null, valor: 130, catalogoItemId: "MC-36", acao: "atualizar", valorCatalogo: 120, valorCatalogoEm: null },
    ]);
  });

  it("resposta vazia ou com erro vira lista vazia", () => {
    expect(lerPlanoCatalogo(null)).toEqual([]);
    expect(lerPlanoCatalogo({ message: "erro" })).toEqual([]);
  });
});

describe("seloLinhaCatalogo", () => {
  it("item novo, atualização, repetido e pessoal pendente têm selo", () => {
    expect(seloLinhaCatalogo(linha({ acao: "novo", catalogoItemId: null, valorCatalogo: null }))).toMatchObject({ rotulo: "Novo no catálogo", tom: "novo" });
    expect(seloLinhaCatalogo(linha({ acao: "atualizar", valorCatalogo: 50 }))).toEqual({
      rotulo: "Atualiza o catálogo",
      tom: "atualiza",
      detalhe: `Catálogo: ${brl(50)} → ${brl(55)} ao concluir.`,
    });
    expect(seloLinhaCatalogo(linha({ acao: "repetido" }))).toMatchObject({ rotulo: "Repetido neste orçamento", tom: "aviso" });
    expect(seloLinhaCatalogo(linha({ acao: "pendente_permissao", rubrica: "PE", valorCatalogo: null }))).toMatchObject({ rotulo: "Pessoal: aguarda permissão", tom: "aviso" });
  });

  it("linha igual ao catálogo não tem selo; linha com catálogo mais novo só informa (DC5)", () => {
    expect(seloLinhaCatalogo(linha({}))).toBeNull();
    expect(seloLinhaCatalogo(linha({ acao: "vincular" }))).toBeNull();
    expect(seloLinhaCatalogo(linha({ valor: 50, valorCatalogo: 55 }))).toMatchObject({ rotulo: `Catálogo hoje: ${brl(55)}`, tom: "aviso" });
  });
});

describe("resumo e mensagens", () => {
  const plano = [
    linha({ linhaId: 1, acao: "novo", descricao: "Reagente Alfa", catalogoItemId: null, valorCatalogo: null, valor: 100 }),
    linha({ linhaId: 2, acao: "atualizar", valorCatalogo: 50, valor: 55 }),
    linha({ linhaId: 3, acao: "pendente_permissao", rubrica: "PE", descricao: "Bolsista", valorCatalogo: null }),
    linha({ linhaId: 4, acao: "inalterado", descricao: "Álcool etílico", valor: 120, valorCatalogo: 130 }),
    linha({ linhaId: 5, acao: "inalterado" }),
  ];

  it("agrupa o que a conclusão faria", () => {
    const resumo = resumirPlanoCatalogo(plano);
    expect(resumo.novos.map((l) => l.linhaId)).toEqual([1]);
    expect(resumo.atualizados.map((l) => l.linhaId)).toEqual([2]);
    expect(resumo.pendentes.map((l) => l.linhaId)).toEqual([3]);
    expect(resumo.desatualizados.map((l) => l.linhaId)).toEqual([4]);
    expect(resumo.repetidos).toEqual([]);
  });

  it("frases da confirmação", () => {
    expect(frasesPreviaCatalogo(resumirPlanoCatalogo(plano))).toEqual([
      "1 item novo entra no catálogo: Reagente Alfa.",
      `1 valor é atualizado: Papel toalha ${brl(50)} → ${brl(55)}.`,
      "1 valor de pessoal fica pendente para quem tem a permissão de valores de pessoal.",
      "1 linha está com valor diferente do catálogo atual e não muda o catálogo: Álcool etílico.",
    ]);
    expect(frasesPreviaCatalogo(resumirPlanoCatalogo([linha({})]))).toEqual([]);
  });

  it("mensagem depois de concluir", () => {
    expect(mensagemConclusaoCatalogo({ novos: 2, atualizados: 1, pendentes: 0, repetidos: 0 })).toBe(
      "Revisão dos custos concluída. Catálogo: 2 itens novos, 1 valor atualizado.",
    );
    expect(mensagemConclusaoCatalogo({ novos: 0, atualizados: 0, pendentes: 1, repetidos: 0 })).toBe(
      "Revisão dos custos concluída. Catálogo: 1 valor de pessoal pendente de permissão.",
    );
    expect(mensagemConclusaoCatalogo(null)).toBe("Revisão dos custos concluída. O catálogo não mudou.");
  });
});
