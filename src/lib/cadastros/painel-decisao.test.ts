import { describe, expect, it } from "vitest";
import { montarInsumosPainel } from "./painel-insumos";
import {
  faixasCobertura,
  filaDeAcao,
  linhasDeAtencao,
  maisUsados,
  montarAlertas,
  montarDecisao,
  resumirAlertas,
  resumirDecisao,
  textoResumoAlertas,
  valorPorCategoria,
} from "./painel-decisao";

const insumos = [
  { id: 1, especificacao: "Ladder", nome_item: "Ladder", categoria_compra: "Reagentes", ponto_reposicao: 2 },
  { id: 2, especificacao: "Beads", nome_item: "Beads", categoria_compra: "Reagentes", ponto_reposicao: 3 },
  { id: 3, especificacao: "Ponteira", nome_item: "Ponteira", categoria_compra: "Plásticos", ponto_reposicao: 5 },
  { id: 4, especificacao: "Tubo", nome_item: null, categoria_compra: null, ponto_reposicao: 0 },
];
const saldos = [
  { insumo_id: 1, disponivel: 0 },
  { insumo_id: 2, disponivel: 4 },
  { insumo_id: 3, disponivel: 50 },
  { insumo_id: 4, disponivel: 10 },
];
const previsoes = [
  { insumo_id: 1, qtd_sugerida_compra: 5, qtd_pedida_aberta: 0, consumo_medio_diario: 0.5, lead_time_dias: 20 },
  // dura 8 dias, a compra leva 20 e não há pedido: acaba antes de chegar
  { insumo_id: 2, qtd_sugerida_compra: 2, qtd_pedida_aberta: 0, consumo_medio_diario: 0.5, dias_cobertura: 8, lead_time_dias: 20 },
  // dura 100 dias, com compra atrasada
  { insumo_id: 3, qtd_sugerida_compra: 0, qtd_pedida_aberta: 10, qtd_compra_atrasada: 10, consumo_medio_diario: 0.5, dias_cobertura: 100, lead_time_dias: 10 },
];
const custos = [
  { insumo_id: 2, valor_liberado: 400 },
  { insumo_id: 3, valor_liberado: 100 },
  { insumo_id: 4, valor_liberado: 50 },
  { insumo_id: 99, valor_liberado: 9999 }, // inativo: fica de fora
];
const alertas = [
  { tipo: "vencido", insumo_id: 3, lote_id: 7, validade: "2026-10-01", valor: 2 },
  { tipo: "vencimento", insumo_id: 4, lote_id: 8, validade: "2026-12-01", valor: 1 },
  { tipo: "reposicao", insumo_id: 1, validade: null },
];

const { insumos: itens, lotes } = montarDecisao(montarInsumosPainel(insumos, saldos), previsoes, custos, alertas);
const porId = Object.fromEntries(itens.map((i) => [i.id, i]));

describe("montarDecisao", () => {
  it("dá o motivo de cada ação", () => {
    expect(porId[1].motivos).toEqual(["em_falta", "comprar"]);
    expect(porId[2].motivos).toEqual(["acaba_antes", "comprar"]);
    expect(porId[3].motivos).toEqual(["compra_atrasada", "vencido"]);
    expect(porId[4].motivos).toEqual(["vencendo"]);
  });

  it("cobertura usa a da previsão ou calcula disponível ÷ consumo; sem consumo fica nula", () => {
    expect(porId[2].coberturaDias).toBe(8);
    expect(porId[1].coberturaDias).toBe(0);
    expect(porId[4].coberturaDias).toBeNull();
  });

  it("lotes vencendo em ordem de data, só de insumos ativos", () => {
    expect(lotes.map((l) => [l.loteId, l.vencido])).toEqual([
      [7, true],
      [8, false],
    ]);
  });

  it("saldo desconhecido não sugere compra ou ruptura; atraso e lote continuam visíveis", () => {
    const parcial = montarInsumosPainel(insumos, [], { saldosCompletos: false });
    const { insumos: semSaldo } = montarDecisao(parcial, previsoes, [], alertas);
    expect(semSaldo.find((i) => i.id === 2)).toMatchObject({ motivos: [], sugestaoCompra: 0, coberturaDias: null });
    expect(semSaldo.find((i) => i.id === 1)!.motivos).toEqual([]);
    expect(semSaldo.find((i) => i.id === 3)!.motivos).toEqual(["compra_atrasada", "vencido"]);
  });

  it("não trata previsão parcial ou quantidade em aberto ausente como zero", () => {
    const base = montarInsumosPainel(insumos, saldos);
    const parcial = montarDecisao(base, previsoes, [], alertas, { previsoesCompletas: false });
    expect(parcial.insumos.find((i) => i.id === 2)).toMatchObject({ pedidoAberto: null, coberturaDias: null, motivos: [] });
    expect(parcial.insumos.find((i) => i.id === 3)!.motivos).toEqual(["compra_atrasada", "vencido"]);
    for (const invalida of [" ", "inválida", -1]) {
      const incompleta = montarDecisao(base, [
        { ...previsoes[0], qtd_pedida_aberta: invalida },
        { ...previsoes[1], qtd_pedida_aberta: invalida },
      ], [], []);
      expect(incompleta.insumos.find((i) => i.id === 2)).toMatchObject({ pedidoAberto: null, motivos: ["comprar"] });
      const alertas = montarAlertas({ itens: incompleta.insumos, lotesVencendo: [], lotes: [], movimentos: [], hojeIso: "2026-11-06" });
      expect(alertas.find((a) => a.chave === "em-falta")?.itens[0].detalhe).toBe("mínimo 2 · previsão indisponível");
      expect(faixasCobertura(incompleta.insumos).at(-1)?.faixa).toBe("Sem estimativa");
    }
  });
});

describe("fila e resumo", () => {
  it("ordena pela urgência do motivo principal", () => {
    expect(filaDeAcao(itens).map((i) => i.id)).toEqual([1, 3, 2, 4]);
    expect(filaDeAcao(itens, "comprar").map((i) => i.id)).toEqual([1, 2]);
  });

  it("resume o que importa para decidir", () => {
    expect(resumirDecisao(itens)).toMatchObject({
      insumos: 4,
      valorEstoque: 550,
      comprar: 2,
      critico: 1,
      emFalta: 1,
      acabaAntes: 1,
      compraAtrasada: 1,
      aCaminho: 1,
      lotesVencidos: 1,
      lotesVencendo: 1,
    });
  });

  it("faixas de cobertura, valor por categoria e mais usados", () => {
    expect(faixasCobertura(itens).map((f) => f.insumos)).toEqual([1, 1, 0, 0, 1, 1]);
    expect(valorPorCategoria(itens, "categoriaCompra")).toEqual([
      { categoria: "Reagentes", valor: 400 },
      { categoria: "Plásticos", valor: 100 },
      { categoria: "Sem categoria", valor: 50 },
    ]);
    const movs = [
      { insumo_id: 2, tipo: "saida" },
      { insumo_id: 2, tipo: "saida" },
      { insumo_id: 3, tipo: "saida" },
      { insumo_id: 3, tipo: "entrada" },
      { insumo_id: 99, tipo: "saida" },
    ];
    expect(maisUsados(itens, movs)).toEqual([
      { id: 2, especificacao: "Beads", saidas: 2 },
      { id: 3, especificacao: "Ponteira", saidas: 1 },
    ]);
  });
});

describe("painel de alertas", () => {
  const hoje = "2026-11-06";
  const lotesDb = [
    // insumo 2: abriram o lote 11 (vence 2027-06) com o 10 fechado vencendo antes (2027-01)
    { id: 10, insumo_id: 2, codigo_lote: "A", status: "aceito", quantidade_atual: 1, validade: "2027-01-10" },
    { id: 11, insumo_id: 2, codigo_lote: "B", status: "em_uso", quantidade_atual: 1, validade: "2027-06-10", data_abertura: "2026-11-01" },
    // insumo 3: dois abertos ao mesmo tempo, na ordem certa
    { id: 20, insumo_id: 3, codigo_lote: "C", status: "em_uso", quantidade_atual: 1, validade: "2027-01-01" },
    { id: 21, insumo_id: 3, codigo_lote: "D", status: "em_uso", quantidade_atual: 1, validade: "2027-02-01" },
    // fechado vencido não conta para a ordem
    { id: 22, insumo_id: 3, codigo_lote: "E", status: "aceito", quantidade_atual: 1, validade: "2026-10-01" },
    { id: 30, insumo_id: 4, codigo_lote: "F", status: "quarentena", quantidade_atual: 5, validade: "2027-01-01" },
    { id: 31, insumo_id: 4, codigo_lote: "G", status: "bloqueado", quantidade_atual: 5, validade: "2027-01-01" },
    { id: 32, insumo_id: 4, codigo_lote: "H", status: "aceito", quantidade_atual: 5, validade: null },
    { id: 99, insumo_id: 99, codigo_lote: "X", status: "aceito", quantidade_atual: 5, validade: null }, // inativo
  ];

  it("aberto fora da ordem de validade (FEFO)", async () => {
    const { abertosForaDeOrdem } = await import("./painel-decisao");
    expect(abertosForaDeOrdem(lotesDb, hoje).map((a) => [Number(a.aberto.id), Number(a.antes.id)])).toEqual([[11, 10]]);
  });

  it("estoque parado: saldo em mãos sem saída em 12 meses nem entrada recente", async () => {
    const { estoqueParado } = await import("./painel-decisao");
    const movs = [
      { insumo_id: 2, tipo: "saida", data: "2026-05-01" },
      { insumo_id: 3, tipo: "entrada", data: "2026-10-01" },
    ];
    // 1 está zerado; 2 tem saída; 3 recebeu há pouco; 4 está parado
    expect(estoqueParado(itens, movs, hoje).map((i) => i.id)).toEqual([4]);
  });

  it("só avalia estoque parado com janela de movimentos completa", () => {
    const entrada = { itens, lotesVencendo: lotes, lotes: lotesDb, movimentos: [], hojeIso: hoje };
    expect(montarAlertas(entrada).find((a) => a.chave === "parado")).toBeUndefined();
    expect(montarAlertas({ ...entrada, movimentosCompletos: true }).find((a) => a.chave === "parado")?.itens).toHaveLength(3);
  });

  it("distingue ausência de saldo, falha de leitura e zero explícito com ou sem mínimo", () => {
    const base = montarInsumosPainel(insumos, [saldos[0], { insumo_id: 3, disponivel: null }, { insumo_id: 4, disponivel: 0 }]);
    const decisao = montarDecisao(base, [], [], []);
    const alertas = montarAlertas({ itens: decisao.insumos, lotesVencendo: [], lotes: [], movimentos: [], hojeIso: hoje });
    const por = Object.fromEntries(alertas.map((a) => [a.chave, a]));
    expect(por["saldo-nao-conferido"].itens.map((i) => i.chave)).toEqual(["i2"]);
    expect(por["saldo-nao-conferido"].itens[0].detalhe).toBe("Sem dado de saldo nesta leitura");
    expect(por["saldo-indisponivel"].itens.map((i) => i.chave)).toEqual(["i3"]);
    expect(por["em-falta"].titulo).toBe("Sem estoque");
    expect(por["em-falta"].descricao).toContain("Confira o estoque");
    expect(por["em-falta"].itens.map((i) => i.detalhe)).toEqual(["mínimo 2 · previsão indisponível"]);
    expect(por["sem-minimo"]).toMatchObject({ tom: "cinza", itens: [{ detalhe: "Sem estoque · confira antes de decidir", href: "/cadastros/insumos?focus=4" }] });
    expect(decisao.insumos.find((i) => i.id === 4)?.motivos).not.toContain("em_falta");
    expect(faixasCobertura(decisao.insumos)[0]).toEqual({ faixa: "Sem estoque", insumos: 2, tom: "ambar" });
    expect(resumirDecisao(decisao.insumos)).toMatchObject({ emFalta: 1, critico: 1, naoConferido: 1, saldoIndisponivel: 1 });
  });

  it("cada alerta lista os itens que o disparam; os vazios vão para o fim", () => {
    const alertas = montarAlertas({ itens, lotesVencendo: lotes, lotes: lotesDb, movimentos: [], hojeIso: hoje });
    const por = Object.fromEntries(alertas.map((a) => [a.chave, a.itens.map((i) => i.titulo)]));
    expect(por["em-falta"]).toEqual(["Ladder"]);
    expect(por["acaba-antes"]).toEqual(["Beads"]);
    expect(por["fora-de-ordem"]).toEqual(["Beads"]);
    expect(por["varios-abertos"]).toEqual(["Ponteira"]);
    expect(por["quarentena"]).toEqual(["Tubo"]);
    expect(por["bloqueados"]).toEqual(["Tubo"]);
    expect(por["sem-validade"]).toEqual(["Tubo"]);
    expect(por["vencidos"]).toEqual(["Ponteira"]);
    expect(por["vencendo"]).toEqual(["Tubo"]);
    expect(por["saldo-indisponivel"]).toBeUndefined();
    // primeiro os vermelhos com itens; o último tem lista vazia
    expect(alertas[0].tom).toBe("vermelho");
    expect(alertas.at(-1)!.itens).toEqual([]);
  });

  // D1: Início e Cadastros mostram a contagem do painel, com as regras dele
  describe("contagem para as outras telas", () => {
    const entrada = { itens, lotesVencendo: lotes, lotes: lotesDb, movimentos: [], hojeIso: hoje };
    const alertas = montarAlertas(entrada);

    it("conta os itens dos quadros urgentes e de atenção; azul e cinza ficam de fora", () => {
      const resumo = resumirAlertas(alertas);
      // urgentes: Ladder zerado, Beads com risco de falta, Ponteira vencida e com compra atrasada
      expect(resumo.urgentes).toBe(4);
      // atenção: Beads aberto fora da ordem, Ponteira com dois abertos, Tubo vencendo
      expect(resumo.atencao).toBe(3);
      expect(resumo.quadros).toEqual([
        "Sem estoque",
        "Risco de falta sem pedido aberto",
        "Lotes vencidos com saldo",
        "Compras atrasadas",
        "Aberto fora da ordem de validade",
        "Mais de um frasco aberto",
        "Vencem em breve",
      ]);
      // quarentena, bloqueado e sem validade existem no painel, mas não entram na contagem
      expect(alertas.find((a) => a.chave === "quarentena")?.itens).toHaveLength(1);
    });

    it("não muda com o histórico de movimentos, que só alimenta o quadro cinza de estoque parado", () => {
      const comHistorico = montarAlertas({ ...entrada, movimentosCompletos: true });
      expect(comHistorico.find((a) => a.chave === "parado")?.itens.length).toBeGreaterThan(0);
      expect(resumirAlertas(comHistorico)).toEqual(resumirAlertas(alertas));
      expect(linhasDeAtencao(comHistorico)).toEqual(linhasDeAtencao(alertas));
    });

    it("texto igual em todas as telas; leitura incompleta é 'sem dado', nunca 'nada urgente'", () => {
      expect(textoResumoAlertas(resumirAlertas(alertas))).toBe("4 urgentes · 3 de atenção");
      expect(textoResumoAlertas({ urgentes: 1, atencao: 0, quadros: [] })).toBe("1 urgente");
      expect(textoResumoAlertas({ urgentes: 0, atencao: 2, quadros: [] })).toBe("2 de atenção");
      expect(textoResumoAlertas({ urgentes: 0, atencao: 0, quadros: [] })).toBe("nada urgente");
      expect(textoResumoAlertas(null)).toBe("sem dado");
    });

    it("linhas do Início: urgentes primeiro, cada uma com o quadro de origem e o destino do painel", () => {
      const linhas = linhasDeAtencao(alertas);
      expect(linhas).toHaveLength(7);
      expect(linhas.map((l) => l.tom)).toEqual(["vermelho", "vermelho", "vermelho", "vermelho", "ambar", "ambar", "ambar"]);
      expect(linhas[0]).toMatchObject({ quadro: "Sem estoque", titulo: "Ladder", href: "/estoque/insumos/1" });
      // lote vencido abre a página do lote; insumo abre a ficha
      expect(linhas.find((l) => l.quadro === "Lotes vencidos com saldo")?.href).toBe("/estoque/lotes/7");
      expect(new Set(linhas.map((l) => l.chave)).size).toBe(linhas.length);
      // prazo de cada linha, para a tabela do Início: sem estoque é hoje, lote traz a data, o resto não tem prazo
      expect(linhas[0]).toMatchObject({ alerta: "em-falta", prazo: "hoje" });
      expect(linhas.find((l) => l.alerta === "acaba-antes")?.prazo).toMatch(/^acaba em \d+ dia\(s\)$/);
      expect(linhas.find((l) => l.alerta === "vencidos")?.prazo).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      expect(linhas.find((l) => l.alerta === "vencendo")?.prazo).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      expect(linhas.find((l) => l.alerta === "compra-atrasada")?.prazo).toBeNull();
      expect(linhas.find((l) => l.alerta === "varios-abertos")?.prazo).toBeNull();
      // sem alerta, sem linha
      expect(linhasDeAtencao(montarAlertas({ itens: [], lotesVencendo: [], lotes: [], movimentos: [], hojeIso: hoje }))).toEqual([]);
    });
  });
});
