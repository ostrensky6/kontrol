import { describe, expect, it } from "vitest";
import { montarInsumosPainel } from "./painel-insumos";
import { faixasCobertura, filaDeAcao, maisUsados, montarDecisao, resumirDecisao, valorPorCategoria } from "./painel-decisao";

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

  it("saldo indisponível não inventa falta nem 'acaba antes'", () => {
    const parcial = montarInsumosPainel(insumos, [], { saldosCompletos: false });
    const { insumos: semSaldo } = montarDecisao(parcial, previsoes, [], []);
    expect(semSaldo.find((i) => i.id === 2)!.motivos).toEqual(["comprar"]);
    expect(semSaldo.find((i) => i.id === 1)!.motivos).toEqual(["comprar"]);
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

  it("cada alerta lista os itens que o disparam; os vazios vão para o fim", async () => {
    const { montarAlertas } = await import("./painel-decisao");
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
});
