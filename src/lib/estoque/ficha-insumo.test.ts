import { describe, expect, it } from "vitest";

import type { ItemACaminho } from "@/lib/suprimentos/a-caminho";

import {
  montarAnalisesDaFicha,
  montarAndamentoDaFicha,
  montarFichaInsumo,
  montarLotesDaFicha,
  montarMovimentosDaFicha,
  montarReservasDaFicha,
} from "./ficha-insumo";
import { hrefFichaInsumo, idDaFicha } from "./ficha-insumo-rota";

const HOJE = "2026-11-11";

function compra(parcial: Partial<ItemACaminho>): ItemACaminho {
  return {
    itemId: 1,
    compraId: 10,
    pedidoInternoId: null,
    insumoId: 7,
    especificacao: "Etanol",
    fornecedor: "Fornecedor A",
    caminho: null,
    situacao: "Compra aprovada",
    aguardaAprovacao: false,
    solicitado: "5 L",
    recebido: "0 L",
    pendente: "5 L",
    pendenteEstoque: 5,
    previsao: "2026-11-20",
    previsaoInformada: true,
    diasAtraso: null,
    ...parcial,
  };
}

describe("endereço da ficha", () => {
  it("só monta link para insumo cadastrado", () => {
    expect(hrefFichaInsumo(900)).toBe("/estoque/insumos/900");
    expect(hrefFichaInsumo("12")).toBe("/estoque/insumos/12");
    for (const semInsumo of [null, undefined, "", 0, -3, 1.5, "abc"]) {
      expect(hrefFichaInsumo(semInsumo), String(semInsumo)).toBeNull();
    }
  });

  it("a rota só aceita número inteiro positivo, escrito só com dígitos", () => {
    expect(idDaFicha("900")).toBe(900);
    for (const invalido of ["0", "-1", "1.5", "1e3", " 9", "9 ", "abc", "", "9999999999999999999"]) {
      expect(idDaFicha(invalido), invalido).toBeNull();
    }
  });
});

describe("lotes da ficha", () => {
  const lotes = [
    { id: 3, codigo_lote: null, validade: null, quantidade_atual: 4, status: "aceito" },
    { id: 2, codigo_lote: "B", validade: "2027-01-10", quantidade_atual: 20, status: "aceito" },
    { id: 1, codigo_lote: " A ", validade: "2026-12-01", validade_apos_abertura: "2026-11-05", quantidade_atual: 40, status: "em_uso", fornecedor: "Forn", nota_fiscal: "123" },
    { id: 4, codigo_lote: "C", validade: "2026-01-01", quantidade_atual: 0, status: "consumido" },
    { id: 5, codigo_lote: "D", validade: "2026-01-01", quantidade_atual: 3, status: "descartado" },
  ];
  const reservas = [
    { lote_id: 2, planejamento_id: 8, quantidade: 6, quantidade_consumida: 1, status: "parcial" },
    { lote_id: 2, planejamento_id: 9, quantidade: 4, quantidade_consumida: 0, status: "liberado" },
  ];

  it("mostra o que vence primeiro no topo, sem os esgotados e descartados", () => {
    const lista = montarLotesDaFicha(lotes, reservas, HOJE, 60);
    expect(lista.map((l) => l.id)).toEqual([1, 2, 3]);
    // sem validade vai para o fim; sem código, o número do lote identifica
    expect(lista[2]).toMatchObject({ codigo: "Lote #3", validade: null, validadeEstado: null });
  });

  it("usa a menor validade (fabricante ou depois de aberto) e marca vencido e vencendo", () => {
    const lista = montarLotesDaFicha(lotes, reservas, HOJE, 60);
    expect(lista[0]).toMatchObject({ codigo: "A", validade: "2026-11-05", validadeEstado: "vencido", statusRotulo: "Em uso", fornecedor: "Forn", notaFiscal: "123" });
    expect(lista[1]).toMatchObject({ validade: "2027-01-10", validadeEstado: "vencendo" });
    expect(montarLotesDaFicha(lotes, reservas, HOJE, 30)[1].validadeEstado).toBeNull();
  });

  it("reservado do lote conta só reserva ativa, descontado o que já foi consumido", () => {
    const lista = montarLotesDaFicha(lotes, reservas, HOJE, 60);
    expect(lista.find((l) => l.id === 2)?.reservado).toBe(5);
    expect(lista.find((l) => l.id === 1)?.reservado).toBe(0);
  });
});

describe("reservas da ficha", () => {
  it("soma por plano o que ainda falta consumir e ignora reserva encerrada", () => {
    const lista = montarReservasDaFicha(
      [
        { lote_id: 1, planejamento_id: 8, quantidade: 6, quantidade_consumida: 1, status: "parcial" },
        { lote_id: 2, planejamento_id: 8, quantidade: 3, quantidade_consumida: 0, status: "reservado" },
        { lote_id: 2, planejamento_id: 9, quantidade: 4, quantidade_consumida: 4, status: "parcial" },
        { lote_id: 2, planejamento_id: 10, quantidade: 4, quantidade_consumida: 0, status: "liberado" },
        { lote_id: 2, planejamento_id: null, quantidade: 2, quantidade_consumida: 0, status: "reservado" },
        { lote_id: 2, planejamento_id: 11, quantidade: 1, quantidade_consumida: 0, status: "reservado" },
      ],
      [{ id: 8, nome: " Sanger de novembro " }],
    );
    expect(lista).toEqual([
      { planejamentoId: 11, plano: "Plano #11", quantidade: 1 },
      { planejamentoId: null, plano: "Reserva sem plano", quantidade: 2 },
      { planejamentoId: 8, plano: "Sanger de novembro", quantidade: 8 },
    ]);
  });
});

describe("pedidos e compras em andamento", () => {
  const itens = [
    { id: 1, pedido_interno_id: 501, quantidade: 2, unidade: "L", recebido_em: null },
    { id: 2, pedido_interno_id: 502, quantidade: 5, unidade: "L", recebido_em: null },
    { id: 3, pedido_interno_id: 503, quantidade: 1, unidade: null, recebido_em: "2026-11-01" },
    { id: 4, pedido_interno_id: 504, quantidade: 9, unidade: "L", recebido_em: null },
    { id: 5, pedido_interno_id: 505, quantidade: 9, unidade: "L", recebido_em: null },
    { id: 6, pedido_interno_id: 999, quantidade: 9, unidade: "L", recebido_em: null },
  ];
  const pedidos = [
    { id: 501, titulo: "Etanol para o LAPOA", status: "em_validacao" },
    { id: 502, titulo: " ", status: "compra_fechada", pedido_compra_id: 10 },
    { id: 503, titulo: "Já chegou", status: "compra_fechada" },
    { id: 504, titulo: "Cancelado", status: "cancelado" },
    { id: 505, titulo: "Concluído", status: "compra_concluida" },
  ];

  it("lista o pedido uma vez, com a previsão da compra dele, e a compra sem pedido à parte", () => {
    const lista = montarAndamentoDaFicha({
      itens,
      pedidos,
      compras: [
        compra({ itemId: 1, compraId: 10, pedidoInternoId: 502, previsao: "2026-11-20" }),
        compra({ itemId: 2, compraId: 11, pedidoInternoId: null, previsao: "2026-11-15", previsaoInformada: false, fornecedor: null }),
        compra({ itemId: 3, compraId: 12, pedidoInternoId: null, previsao: null, aguardaAprovacao: true, situacao: "Compra aguardando aprovação" }),
      ],
    });
    expect(lista.map((l) => [l.chave, l.confirmado])).toEqual([
      ["compra-11-2", true],
      ["pedido-502-2", true],
      ["compra-12-3", false],
      ["pedido-501-1", false],
    ]);
    // o pedido que virou compra não repete a compra #10
    expect(lista.some((l) => l.chave.startsWith("compra-10"))).toBe(false);
    expect(lista[1]).toMatchObject({
      origem: "pedido",
      href: "/pedido/502",
      situacao: "Compra e entrega",
      quantidade: "5 L",
      previsao: "2026-11-20",
      previsaoInformada: true,
    });
    // título em branco: só o número do pedido
    expect(lista[1].rotulo).toBe("Pedido Nº 0502");
    expect(lista[0]).toMatchObject({ origem: "compra", href: "/compras/11", rotulo: "Compra #11", previsaoInformada: false });
    expect(lista[3]).toMatchObject({ situacao: "Aprovação", previsao: null });
    expect(lista[3].rotulo).toContain("Etanol para o LAPOA");
  });

  it("deixa de fora item recebido e pedido concluído, cancelado ou que o usuário não pode ler", () => {
    const chaves = montarAndamentoDaFicha({ itens, pedidos, compras: [] }).map((l) => l.chave);
    expect(chaves).toEqual(["pedido-502-2", "pedido-501-1"]);
  });

  it("pedido em aprovação ou cotação não conta como a caminho", () => {
    const lista = montarAndamentoDaFicha({
      itens: [
        { id: 1, pedido_interno_id: 1, quantidade: 1, unidade: "un", recebido_em: null },
        { id: 2, pedido_interno_id: 2, quantidade: 1, unidade: "un", recebido_em: null },
        { id: 3, pedido_interno_id: 3, quantidade: 1, unidade: "un", recebido_em: null },
      ],
      pedidos: [
        { id: 1, titulo: "a", status: "orcamentos" },
        { id: 2, titulo: "b", status: "aprovado_para_compra" },
        { id: 3, titulo: "c", status: "aguardando_pagamento_nf" },
      ],
      compras: [],
    });
    expect(Object.fromEntries(lista.map((l) => [l.href, l.confirmado]))).toEqual({
      "/pedido/1": false,
      "/pedido/2": true,
      "/pedido/3": true,
    });
  });
});

describe("análises e movimentações", () => {
  it("lista as análises em ordem, com etapa e quantidade por amostra", () => {
    const lista = montarAnalisesDaFicha([
      { codigo_analise: "qPCR10", nome_etapa: "Preparo", nome_atividade: "qPCR", quantidade_por_amostra: 2, unidade: " uL " },
      { codigo_analise: "qPCR2", nome_etapa: null, nome_atividade: null, quantidade_por_amostra: null, unidade: null },
      { codigo_analise: null, nome_etapa: "x", nome_atividade: "y", quantidade_por_amostra: 1, unidade: "un" },
    ]);
    expect(lista.map((a) => a.codigo)).toEqual(["qPCR2", "qPCR10"]);
    expect(lista[0]).toMatchObject({ etapa: "—", quantidade: null, unidade: "" });
    expect(lista[1]).toMatchObject({ etapa: "Preparo · qPCR", quantidade: 2, unidade: "uL" });
  });

  it("mostra só as movimentações mais recentes", () => {
    const movimentos = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      data: `2026-11-${String(i + 1).padStart(2, "0")}`,
      tipo: i % 2 ? "saida" : "entrada",
      quantidade: i + 1,
      motivo: i === 9 ? " baixa manual " : null,
      lote_id: i === 9 ? 7 : null,
    }));
    const lista = montarMovimentosDaFicha(movimentos);
    expect(lista).toHaveLength(8);
    expect(lista[0]).toEqual({ id: 10, data: "2026-11-10", tipo: "Saída", quantidade: 10, motivo: "baixa manual", loteId: 7 });
    expect(lista.at(-1)?.id).toBe(3);
    expect(montarMovimentosDaFicha([{ id: 1, data: null, tipo: "transferencia", quantidade: "2", motivo: null, lote_id: null }])[0])
      .toMatchObject({ tipo: "transferencia", quantidade: 2 });
  });
});

describe("ficha montada", () => {
  const base = {
    alertas: [],
    lotes: [{ id: 1, codigo_lote: "A", validade: "2026-12-01", quantidade_atual: 40, status: "aceito" }],
    reservas: [],
    planos: [],
    itensPedido: [],
    pedidos: [],
    compras: [],
    analises: [],
    movimentos: [],
    hoje: HOJE,
    janelaVencimento: 60,
  };

  it("usa os números e a situação do Estoque disponível", () => {
    const ficha = montarFichaInsumo({
      ...base,
      saldo: { insumo_id: 7, especificacao: "Etanol", unidade: "L", em_maos: 40, reservado: 5, disponivel: 0, ponto_reposicao: 10, em_quarentena: "3", bloqueado: null },
      previsao: { insumo_id: 7, qtd_sugerida_compra: 12, qtd_pedida_aberta: 8, qtd_pedida_pendente: 3, lead_time_dias: 30, dias_cobertura: "0" },
    });
    expect(ficha.estoque).toMatchObject({
      insumoId: 7,
      emMaos: 40,
      reservado: 5,
      disponivel: 0,
      aCaminho: 5,
      aguardandoAprovacao: 3,
      minimo: 10,
      sugerido: 12,
      validade: "2026-12-01",
      validadeEstado: "vencendo",
    });
    expect(ficha.estoque?.sinais).toEqual(["sem_disponivel", "reposicao"]);
    expect(ficha).toMatchObject({ emQuarentena: 3, bloqueado: 0, prazoCompraDias: 30, coberturaDias: 0 });
  });

  it("insumo inativo também tem ficha", () => {
    const ficha = montarFichaInsumo({
      ...base,
      saldo: { insumo_id: 7, especificacao: "Etanol", unidade: "L", ativo: false, em_maos: 40, reservado: 0, disponivel: 40, ponto_reposicao: 0 },
      previsao: null,
    });
    expect(ficha.estoque?.disponivel).toBe(40);
    // previsão não lida: "a caminho" e prazo ficam sem dado, não zero
    expect(ficha.estoque?.aCaminho).toBeNull();
    expect(ficha.prazoCompraDias).toBeNull();
    expect(ficha.coberturaDias).toBeNull();
  });

  it("saldo não lido não vira zero", () => {
    const ficha = montarFichaInsumo({ ...base, saldo: null, previsao: null });
    expect(ficha.estoque).toBeNull();
    expect(ficha.lotes).toHaveLength(1);
  });
});
