import { describe, expect, it } from "vitest";
import {
  FILTROS_PAINEL_VAZIOS,
  SEM_CATEGORIA,
  filtrarLista,
  filtrarRecorte,
  inicioJanelaMeses,
  montarInsumosPainel,
  movimentosPorMes,
  opcoesFiltro,
  resumirPainel,
  resumoPorCategoria,
  situacaoPainel,
} from "./painel-insumos";

const insumos = [
  { id: 1, especificacao: "Ladder 100 pb", nome_item: "Ladder", categoria_compra: "Reagentes", fabricante: "Kasvi", codigo_fabricante: "K9-100", unidade: "un", ponto_reposicao: 2 },
  { id: 2, especificacao: "Beads AMPure", nome_item: "Beads", categoria_compra: "Reagentes", fabricante: "Beckman", codigo_fabricante: "A63881", unidade: "frasco", ponto_reposicao: 3 },
  { id: 3, especificacao: "Ponteira 10 µL", nome_item: "Ponteira", categoria_compra: "Plásticos", fabricante: "Axygen", codigo_fabricante: "T-300", unidade: "cx", ponto_reposicao: 5 },
  { id: 4, especificacao: "Tubo 1,5 mL", nome_item: null, categoria_compra: null, fabricante: null, codigo_fabricante: null, unidade: "pct", ponto_reposicao: 0 },
];

const saldos = [
  { insumo_id: 1, disponivel: 0, em_maos: 1, unidade_saldo: "un" },
  { insumo_id: 2, disponivel: "1", em_maos: 1, unidade_saldo: "frasco" },
  { insumo_id: 3, disponivel: 8, em_maos: 8, unidade_saldo: "cx" },
  // insumo 4 sem linha de saldo: conta como zero
];

const itens = montarInsumosPainel(insumos, saldos);

describe("situacaoPainel", () => {
  it("usa o ponto de reposição como mínimo", () => {
    expect(situacaoPainel(0, 2)).toBe("em_falta");
    expect(situacaoPainel(1, 2)).toBe("abaixo_minimo");
    expect(situacaoPainel(2, 2)).toBe("ok");
    expect(situacaoPainel(0, 0)).toBe("sem_minimo");
    expect(situacaoPainel(5, 0)).toBe("sem_minimo");
  });
});

describe("montarInsumosPainel", () => {
  it("junta cadastro e saldo, com críticos primeiro", () => {
    expect(itens.map((i) => [i.id, i.situacao])).toEqual([
      [1, "em_falta"],
      [2, "abaixo_minimo"],
      [4, "sem_minimo"],
      [3, "ok"],
    ]);
    const tubo = itens.find((i) => i.id === 4)!;
    expect(tubo.disponivel).toBe(0);
    expect(tubo.categoriaCurta).toBe(SEM_CATEGORIA);
    expect(tubo.unidade).toBe("pct");
  });
});

describe("resumo", () => {
  it("conta crítico = em falta + abaixo do mínimo", () => {
    expect(resumirPainel(itens)).toEqual({
      cadastrados: 4,
      comEstoque: 2,
      acimaMinimo: 1,
      critico: 2,
      emFalta: 1,
      abaixoMinimo: 1,
      semMinimo: 1,
      saude: 1 / 3,
    });
  });

  it("sem nenhum mínimo cadastrado a saúde fica indefinida", () => {
    expect(resumirPainel([]).saude).toBeNull();
  });

  it("agrupa por categoria, das mais críticas para as menos", () => {
    expect(resumoPorCategoria(itens, "categoriaCompra")).toEqual([
      { categoria: "Reagentes", total: 2, ok: 0, critico: 2, semMinimo: 0 },
      { categoria: "Plásticos", total: 1, ok: 1, critico: 0, semMinimo: 0 },
      { categoria: SEM_CATEGORIA, total: 1, ok: 0, critico: 0, semMinimo: 1 },
    ]);
  });
});

describe("filtros", () => {
  it("filtra por categoria, código e busca sem acento", () => {
    expect(filtrarRecorte(itens, { ...FILTROS_PAINEL_VAZIOS, categoriaCompra: "Reagentes" }).map((i) => i.id)).toEqual([1, 2]);
    expect(filtrarRecorte(itens, { ...FILTROS_PAINEL_VAZIOS, codigoFabricante: "T-300" }).map((i) => i.id)).toEqual([3]);
    expect(filtrarRecorte(itens, { ...FILTROS_PAINEL_VAZIOS, busca: "PONTEIRA 10 ul" }).map((i) => i.id)).toEqual([]);
    expect(filtrarRecorte(itens, { ...FILTROS_PAINEL_VAZIOS, busca: "ampure" }).map((i) => i.id)).toEqual([2]);
    expect(filtrarRecorte(itens, { ...FILTROS_PAINEL_VAZIOS, busca: "a63881" }).map((i) => i.id)).toEqual([2]);
  });

  it("a situação filtra só a lista, não o recorte", () => {
    const filtros = { ...FILTROS_PAINEL_VAZIOS, situacao: "critico" };
    expect(filtrarLista(itens, filtros).map((i) => i.id)).toEqual([1, 2]);
    expect(filtrarRecorte(itens, filtros)).toHaveLength(4);
  });

  it("opções em cascata mantêm o valor escolhido", () => {
    const filtros = { ...FILTROS_PAINEL_VAZIOS, categoriaCompra: "Reagentes" };
    expect(opcoesFiltro(itens, filtros, "categoriaCurta")).toEqual(["Beads", "Ladder"]);
    expect(opcoesFiltro(itens, filtros, "categoriaCompra")).toEqual(["Plásticos", "Reagentes", SEM_CATEGORIA]);
    expect(opcoesFiltro(itens, { ...filtros, categoriaCurta: "Ponteira" }, "categoriaCurta")).toEqual(["Beads", "Ladder", "Ponteira"]);
  });
});

describe("movimentosPorMes", () => {
  it("abre a janela no primeiro dia de 11 meses atrás", () => {
    expect(inicioJanelaMeses("2026-11-06")).toBe("2025-12-01");
    expect(inicioJanelaMeses("2026-01-31", 3)).toBe("2025-11-01");
  });

  it("conta entradas e saídas do recorte, sem ajustes", () => {
    const movimentos = [
      { insumo_id: 1, tipo: "entrada", data: "2026-11-02" },
      { insumo_id: 1, tipo: "saida", data: "2026-11-03T10:00:00Z" },
      { insumo_id: 2, tipo: "saida", data: "2026-10-15" },
      { insumo_id: 2, tipo: "ajuste", data: "2026-10-15" },
      { insumo_id: 3, tipo: "entrada", data: "2025-11-30" }, // fora da janela
    ];
    const serie = movimentosPorMes(movimentos, null, "2026-11-06");
    expect(serie).toHaveLength(12);
    expect(serie[0]).toMatchObject({ mes: "2025-12", rotulo: "dez/25" });
    expect(serie.at(-1)).toEqual({ mes: "2026-11", rotulo: "nov/26", entradas: 1, saidas: 1 });
    expect(serie.at(-2)).toMatchObject({ entradas: 0, saidas: 1 });

    const soInsumo2 = movimentosPorMes(movimentos, new Set([2]), "2026-11-06");
    expect(soInsumo2.at(-1)).toMatchObject({ entradas: 0, saidas: 0 });
    expect(soInsumo2.at(-2)).toMatchObject({ saidas: 1 });
  });
});
