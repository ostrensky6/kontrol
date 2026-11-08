import { describe, expect, it } from "vitest";
import {
  FILTROS_PAINEL_VAZIOS,
  SEM_CATEGORIA,
  filtrarLista,
  filtrarRecorte,
  filtrosDaUrl,
  inicioJanelaMeses,
  montarInsumosPainel,
  movimentosPorMes,
  opcoesFiltro,
  resumirPainel,
  resumoPorCategoria,
  situacaoPainel,
  urlComFiltros,
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
  // insumo 4 sem linha de saldo
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
      [3, "ok"],
      [4, "saldo_indisponivel"],
    ]);
    const tubo = itens.find((i) => i.id === 4)!;
    expect(tubo).toMatchObject({ disponivel: null, emMaos: null, estadoSaldo: "nao_conferido" });
    expect(tubo.categoriaCurta).toBe(SEM_CATEGORIA);
    expect(tubo.unidade).toBe("pct");
  });

  it("leitura de saldo com falha: quem ficou sem linha é indisponível, não zero nem crítico", () => {
    // só a primeira linha chegou antes do erro
    const parcial = montarInsumosPainel(insumos, [saldos[1]], { saldosCompletos: false });
    expect(parcial[0]).toMatchObject({ id: 2, disponivel: 1, estadoSaldo: "saldo_sistema" });
    expect(parcial.find((i) => i.id === 1)).toMatchObject({
      disponivel: null, emMaos: null, estadoSaldo: "saldo_indisponivel",
    });
    const resumo = resumirPainel(parcial);
    expect(resumo.critico).toBe(1);
    expect(resumo.saldoIndisponivel).toBe(3);
    expect(resumo.comEstoque).toBe(1);
    expect(resumo.saude).toBe(0);
  });

  it("separa erro e consulta vazia de disponibilidade zero, mesmo com estoque em mãos", () => {
    const um = [insumos[0]];
    const [erro] = montarInsumosPainel(um, [], { saldosCompletos: false });
    const [ausente] = montarInsumosPainel(um, []);
    const [zero] = montarInsumosPainel(um, [saldos[0]]);
    expect(erro).toMatchObject({ disponivel: null, estadoSaldo: "saldo_indisponivel" });
    expect(ausente).toMatchObject({ disponivel: null, estadoSaldo: "nao_conferido" });
    expect(zero).toMatchObject({ disponivel: 0, emMaos: 1, estadoSaldo: "saldo_sistema", situacao: "em_falta" });
    const desconhecidos = [erro, ausente];
    expect(filtrarLista(desconhecidos, { ...FILTROS_PAINEL_VAZIOS, situacao: "critico" })).toEqual([]);
    expect(resumirPainel(desconhecidos)).toMatchObject({ emFalta: 0, critico: 0, saude: null });
    expect(filtrarLista([zero], { ...FILTROS_PAINEL_VAZIOS, situacao: "critico" })).toEqual([zero]);
    expect(resumirPainel([zero])).toMatchObject({ emFalta: 1, critico: 1, saldoIndisponivel: 0, saude: 0 });
  });

  it.each(["insumo sem lotes", "insumo consumido até zero"])(
    "detecta o zero explícito retornado pela view para %s, sem inferir diferença física",
    () => {
      // Ambos os contextos produzem a mesma linha na view; ela não atesta o físico.
      const [item] = montarInsumosPainel([insumos[0]], [
        { insumo_id: 1, disponivel: 0, em_maos: 0, unidade_saldo: "un" },
      ]);
      expect(item).toMatchObject({ disponivel: 0, emMaos: 0, estadoSaldo: "saldo_sistema", situacao: "em_falta" });
      expect(filtrarLista([item], { ...FILTROS_PAINEL_VAZIOS, situacao: "critico" })).toEqual([item]);
      expect(resumirPainel([item])).toMatchObject({ emFalta: 1, critico: 1, saldoIndisponivel: 0 });
    },
  );

  it("mantém zero sem mínimo detectável como saldo de sistema, sem torná-lo crítico", () => {
    const lista = montarInsumosPainel([insumos[3]], [
      { insumo_id: 4, disponivel: 0, em_maos: 0, unidade_saldo: "pct" },
    ]);
    expect(lista[0]).toMatchObject({ disponivel: 0, estadoSaldo: "saldo_sistema", situacao: "sem_minimo" });
    expect(lista.filter((item) => item.estadoSaldo === "saldo_sistema" && item.disponivel === 0)).toHaveLength(1);
    expect(filtrarLista(lista, { ...FILTROS_PAINEL_VAZIOS, situacao: "critico" })).toEqual([]);
    expect(resumirPainel(lista)).toMatchObject({ semMinimo: 1, emFalta: 0, critico: 0, saldoIndisponivel: 0, saude: null });
  });

  it.each([null, undefined, "", "  ", "inválido", Infinity, -1])(
    "saldo ausente ou inválido (%s) não vira zero",
    (disponivel) => {
      expect(montarInsumosPainel([insumos[0]], [{ insumo_id: 1, disponivel }])[0]).toMatchObject({
        disponivel: null, emMaos: null, estadoSaldo: "saldo_indisponivel",
      });
    },
  );

  it("mantém o saldo positivo e a unidade de sistema sem atribuir conferência", () => {
    expect(itens.find((i) => i.id === 2)).toMatchObject({
      disponivel: 1, emMaos: 1, unidade: "frasco", estadoSaldo: "saldo_sistema", situacao: "abaixo_minimo",
    });
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
      semMinimo: 0,
      saldoIndisponivel: 1,
      saude: 1 / 3,
    });
  });

  it("sem nenhum mínimo cadastrado a saúde fica indefinida", () => {
    expect(resumirPainel([]).saude).toBeNull();
  });

  it("agrupa por categoria, das mais críticas para as menos", () => {
    expect(resumoPorCategoria(itens, "categoriaCompra")).toEqual([
      { categoria: "Reagentes", total: 2, ok: 0, critico: 2, semMinimo: 0, saldoIndisponivel: 0 },
      { categoria: "Plásticos", total: 1, ok: 1, critico: 0, semMinimo: 0, saldoIndisponivel: 0 },
      { categoria: SEM_CATEGORIA, total: 1, ok: 0, critico: 0, semMinimo: 0, saldoIndisponivel: 1 },
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

  it("leitura desfeita anula a entrada ou a saída que tinha registrado", () => {
    const movimentos = [
      { insumo_id: 1, tipo: "saida", data: "2026-11-03" },
      { insumo_id: 1, tipo: "saida", data: "2026-11-03" },
      { insumo_id: 1, tipo: "ajuste", data: "2026-11-03", motivo: "leitura desfeita: abertura de embalagem" },
      { insumo_id: 1, tipo: "entrada", data: "2026-11-04" },
      { insumo_id: 1, tipo: "ajuste", data: "2026-11-04", motivo: "leitura desfeita: entrada por código de barras" },
      { insumo_id: 1, tipo: "ajuste", data: "2026-11-05", motivo: "contagem de inventário" },
      // desfazer sem a saída na janela não deixa o mês negativo
      { insumo_id: 1, tipo: "ajuste", data: "2026-10-01", motivo: "leitura desfeita: abertura de embalagem" },
    ];
    const serie = movimentosPorMes(movimentos, null, "2026-11-06");
    expect(serie.at(-1)).toMatchObject({ entradas: 0, saidas: 1 });
    expect(serie.at(-2)).toMatchObject({ entradas: 0, saidas: 0 });
  });
});

describe("filtros na URL", () => {
  it("lê e grava só os filtros preenchidos, sem perder outros parâmetros", () => {
    const filtros = { ...FILTROS_PAINEL_VAZIOS, categoriaCompra: "Reagentes", busca: "ácido", situacao: "critico" };
    const url = urlComFiltros("?aba=x&busca=velho", filtros);
    expect(url).toBe("?aba=x&busca=%C3%A1cido&compra=Reagentes&situacao=critico");
    expect(filtrosDaUrl(url)).toEqual(filtros);
    expect(urlComFiltros("?situacao=critico", FILTROS_PAINEL_VAZIOS)).toBe("");
    expect(filtrosDaUrl("")).toEqual(FILTROS_PAINEL_VAZIOS);
  });
});
