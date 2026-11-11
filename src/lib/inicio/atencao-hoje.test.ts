import { describe, expect, it } from "vitest";

import type { LinhaAtencao } from "@/lib/cadastros/painel-decisao";

import {
  LIMITE_ATENCAO_HOJE,
  ORIGENS_ATENCAO,
  comprasDoInicio,
  contarPorOrigem,
  filtrarPorOrigem,
  linhasDeAvisos,
  linhasDeCompras,
  linhasDeSugestao,
  linhasDoEstoque,
  ordenarAtencaoHoje,
  type CompraInicio,
  type LinhaAtencaoHoje,
} from "./atencao-hoje";

const doPainel = (dados: Partial<LinhaAtencao> & { chave: string; alerta: string }): LinhaAtencao => ({
  tom: "ambar",
  quadro: "Quadro",
  titulo: "Insumo",
  detalhe: "",
  href: "/estoque/insumos/1",
  prazo: null,
  ...dados,
});

const compra = (dados: Partial<CompraInicio> & { id: number }): CompraInicio => ({
  status: "enviado",
  dataSolicitacao: "2026-11-01",
  projeto: null,
  fornecedor: null,
  previsao: null,
  previsaoInformada: false,
  diasAtraso: null,
  ...dados,
});

describe("linhas do estoque e da validade (vêm do painel de situação)", () => {
  const linhas = linhasDoEstoque([
    doPainel({ chave: "a", alerta: "em-falta", tom: "vermelho", quadro: "Sem estoque", titulo: "Mix PCR", detalhe: "mínimo 10 · nada pedido", prazo: "hoje" }),
    doPainel({ chave: "b", alerta: "vencendo", quadro: "Vencem em breve", titulo: "Etanol 70%", href: "/estoque/lotes/7", prazo: "16/11/2026" }),
    doPainel({ chave: "c", alerta: "saldo-nao-conferido", quadro: "Saldo não conferido", titulo: "Primer F" }),
    doPainel({ chave: "d", alerta: "fora-de-ordem", quadro: "Aberto fora da ordem de validade", href: "/estoque/lotes/9", prazo: "01/12/2026" }),
  ]);

  it("lote e validade viram origem Validade; saldo e compra viram Estoque", () => {
    expect(linhas.map((l) => l.origem)).toEqual(["Estoque", "Validade", "Estoque", "Validade"]);
  });

  it("situação é o nome do quadro, a gravidade vem do tom e o prazo é o do painel", () => {
    expect(linhas[0]).toMatchObject({
      item: "Mix PCR",
      detalhe: "mínimo 10 · nada pedido",
      situacao: "Sem estoque",
      gravidade: "urgente",
      prazo: "hoje",
      acao: { rotulo: "Abrir a ficha", href: "/estoque/insumos/1" },
    });
    expect(linhas[1]).toMatchObject({ gravidade: "atencao", prazo: "16/11/2026", acao: { rotulo: "Abrir o lote", href: "/estoque/lotes/7" } });
    // sem prazo e sem detalhe: traço e nada, nunca texto inventado
    expect(linhas[2]).toMatchObject({ prazo: "—", detalhe: null });
  });

  it("o que falta preencher abre o cadastro", () => {
    const [linha] = linhasDoEstoque([doPainel({ chave: "x", alerta: "sem-minimo", href: "/cadastros/insumos?focus=3" })]);
    expect(linha.acao).toEqual({ rotulo: "Completar o cadastro", href: "/cadastros/insumos?focus=3" });
  });

  it("quem só vê Compras recebe a sugestão de compra como linha de Estoque", () => {
    expect(linhasDeSugestao([{ insumoId: 4, titulo: "Taq", meta: "disp. 0 · sugerido 5 un" }])).toEqual([
      {
        chave: "repor-4",
        origem: "Estoque",
        item: "Taq",
        detalhe: "disp. 0 · sugerido 5 un",
        situacao: "Repor",
        gravidade: "atencao",
        prazo: "—",
        acao: { rotulo: "Ver compras", href: "/compras" },
      },
    ]);
  });
});

describe("linhas de compras: a caminho é fato", () => {
  it("compra enviada e fora do prazo é urgente, com os dias de atraso e a data prevista", () => {
    const [linha] = linhasDeCompras([
      compra({ id: 42, fornecedor: "Fornecedor X", projeto: "Projeto Y", previsao: "2026-11-08", previsaoInformada: true, diasAtraso: 3 }),
    ]);
    expect(linha).toEqual({
      chave: "compra-42",
      origem: "Compras",
      item: "Compra #42, Fornecedor X",
      detalhe: "3 dia(s) de atraso · Projeto Y",
      situacao: "Entrega atrasada",
      gravidade: "urgente",
      prazo: "08/11/2026",
      acao: { rotulo: "Abrir a compra", href: "/compras/42" },
    });
  });

  it("dentro do prazo fica em andamento; previsão calculada aparece como estimada", () => {
    const [linha] = linhasDeCompras([compra({ id: 7, status: "em_transito", previsao: "2026-11-20" })]);
    expect(linha).toMatchObject({ item: "Compra #7", situacao: "Em trânsito", gravidade: "andamento", prazo: "20/11/2026 (estimada)", detalhe: null });
  });

  it("prova negativa: compra só solicitada nunca é atrasada nem tem data de entrega", () => {
    const [linha] = linhasDeCompras([
      compra({ id: 9, status: "solicitado", dataSolicitacao: "2026-11-07", previsao: "2026-11-08", previsaoInformada: true, diasAtraso: 3 }),
    ]);
    expect(linha).toMatchObject({ situacao: "Compra aguardando aprovação", gravidade: "andamento", prazo: "desde 07/11/2026", detalhe: null });
  });

  it("sem previsão, o prazo é desde quando foi solicitada; sem data nenhuma, traço", () => {
    expect(linhasDeCompras([compra({ id: 1 })])[0].prazo).toBe("desde 01/11/2026");
    expect(linhasDeCompras([compra({ id: 2, dataSolicitacao: null })])[0].prazo).toBe("—");
    // status que a tela não conhece aparece como veio, em vez de sumir
    expect(linhasDeCompras([compra({ id: 3, status: "outro" })])[0].situacao).toBe("outro");
  });
});

describe("compras do Início: prazo informado, estimado e atraso", () => {
  const pedido = { id: 42, status: "enviado", data_solicitacao: "2026-11-01", data_prevista_entrega: null, projeto: " Projeto Y ", fornecedores: { nome: "Fornecedor X" } };
  const hoje = "2026-11-11";

  it("a data informada na compra vale como prevista; o atraso vem dos itens que ainda faltam", () => {
    const [compra] = comprasDoInicio(
      [{ ...pedido, data_prevista_entrega: "2026-11-08" }],
      [
        { compraId: 42, previsao: "2026-11-08", diasAtraso: 3 },
        { compraId: 42, previsao: "2026-11-08", diasAtraso: 3 },
        { compraId: 7, previsao: "2026-10-01", diasAtraso: 41 },
      ],
      hoje,
    );
    expect(compra).toEqual({
      id: 42,
      status: "enviado",
      dataSolicitacao: "2026-11-01",
      projeto: "Projeto Y",
      fornecedor: "Fornecedor X",
      previsao: "2026-11-08",
      previsaoInformada: true,
      diasAtraso: 3,
    });
  });

  it("sem data informada, usa a estimada mais próxima e marca como estimada", () => {
    const [compra] = comprasDoInicio(
      [pedido],
      [
        { compraId: 42, previsao: "2026-11-20", diasAtraso: null },
        { compraId: 42, previsao: "2026-11-15", diasAtraso: null },
      ],
      hoje,
    );
    expect(compra).toMatchObject({ previsao: "2026-11-15", previsaoInformada: false, diasAtraso: null });
  });

  it("prova negativa: data informada vencida, mas nada mais a receber, não é atraso", () => {
    const [compra] = comprasDoInicio([{ ...pedido, data_prevista_entrega: "2026-11-08" }], [], hoje);
    expect(compra.diasAtraso).toBeNull();
  });

  it("sem a leitura dos prazos, só a data informada pode afirmar atraso", () => {
    expect(comprasDoInicio([{ ...pedido, data_prevista_entrega: "2026-11-08" }], null, hoje)[0].diasAtraso).toBe(3);
    expect(comprasDoInicio([{ ...pedido, data_prevista_entrega: "2026-11-30" }], null, hoje)[0].diasAtraso).toBeNull();
    expect(comprasDoInicio([pedido], null, hoje)[0]).toMatchObject({ previsao: null, diasAtraso: null });
    // fornecedor em lista (como o banco às vezes devolve) e sem fornecedor
    expect(comprasDoInicio([{ ...pedido, fornecedores: [{ nome: "Lista" }] }], null, hoje)[0].fornecedor).toBe("Lista");
    expect(comprasDoInicio([{ ...pedido, fornecedores: null, projeto: null }], null, hoje)[0]).toMatchObject({ fornecedor: null, projeto: null });
  });
});

describe("linhas de avisos", () => {
  const aviso = { id: 1, tipo: "falta_plano", titulo: "Falta de estoque no planejamento", corpo: "Mix PCR: falta 10 uL.", criadoEm: "2026-11-10T12:00:00Z" };

  it("aviso ligado a uma tela abre essa tela", () => {
    const [linha] = linhasDeAvisos([{ ...aviso, entidadeTipo: "planejamento", entidadeId: 1 }]);
    expect(linha).toEqual({
      chave: "aviso-1",
      origem: "Aviso",
      item: "Falta de estoque no planejamento",
      detalhe: "Mix PCR: falta 10 uL.",
      situacao: "Falta no plano",
      gravidade: "atencao",
      prazo: "desde 10/11/2026",
      acao: { rotulo: "Abrir o plano", href: "/planejamento/1" },
    });
  });

  it("prova negativa: aviso sem tela ligada, ou de tipo desconhecido, abre em Notificações", () => {
    const destinos = linhasDeAvisos([
      { ...aviso, id: 2, entidadeTipo: null, entidadeId: null },
      { ...aviso, id: 3, entidadeTipo: "coisa_nova", entidadeId: 5 },
      // o resumo semanal aponta para o próprio Início: não vira um link que não leva a lugar nenhum
      { ...aviso, id: 4, entidadeTipo: "resumo_semanal", entidadeId: null, criadoEm: null },
    ]);
    expect(destinos.map((l) => l.acao)).toEqual([
      { rotulo: "Ver o aviso", href: "/notificacoes" },
      { rotulo: "Ver o aviso", href: "/notificacoes" },
      { rotulo: "Ver o aviso", href: "/notificacoes" },
    ]);
    expect(destinos[2].prazo).toBe("—");
  });
});

describe("ordem e filtro da tabela", () => {
  const linha = (chave: string, origem: LinhaAtencaoHoje["origem"], gravidade: LinhaAtencaoHoje["gravidade"]): LinhaAtencaoHoje => ({
    chave,
    origem,
    item: chave,
    detalhe: null,
    situacao: "s",
    gravidade,
    prazo: "—",
    acao: { rotulo: "Abrir", href: "/" },
  });

  it("do mais grave para o menos grave", () => {
    const ordem = ordenarAtencaoHoje([
      linha("compra-em-dia", "Compras", "andamento"),
      linha("aviso", "Aviso", "atencao"),
      linha("vencido", "Validade", "urgente"),
      linha("abaixo", "Estoque", "atencao"),
      linha("sem-estoque", "Estoque", "urgente"),
    ]);
    expect(ordem.map((l) => l.chave)).toEqual(["sem-estoque", "vencido", "abaixo", "aviso", "compra-em-dia"]);
  });

  it("com a mesma gravidade as origens se alternam: muitas linhas de uma não escondem as outras", () => {
    const estoque = Array.from({ length: 12 }, (_, i) => linha(`e${i}`, "Estoque", "atencao"));
    const ordem = ordenarAtencaoHoje([...estoque, linha("v0", "Validade", "atencao"), linha("a0", "Aviso", "atencao"), linha("a1", "Aviso", "atencao")]);
    expect(ordem.slice(0, 6).map((l) => l.chave)).toEqual(["e0", "v0", "a0", "e1", "a1", "e2"]);
    // as primeiras linhas da tabela trazem as três origens
    expect(new Set(ordem.slice(0, LIMITE_ATENCAO_HOJE).map((l) => l.origem))).toEqual(new Set(["Estoque", "Validade", "Aviso"]));
    // nada se perde nem se repete, e a ordem de cada origem é a que veio
    expect(ordem).toHaveLength(15);
    expect(new Set(ordem.map((l) => l.chave)).size).toBe(15);
    expect(ordem.filter((l) => l.origem === "Estoque").map((l) => l.chave)).toEqual(estoque.map((l) => l.chave));
  });

  it("contagem e filtro por origem", () => {
    const linhas = [linha("e", "Estoque", "urgente"), linha("c1", "Compras", "andamento"), linha("c2", "Compras", "urgente")];
    expect(contarPorOrigem(linhas)).toEqual({ Estoque: 1, Validade: 0, Compras: 2, Aviso: 0 });
    expect(filtrarPorOrigem(linhas, "Compras").map((l) => l.chave)).toEqual(["c1", "c2"]);
    expect(filtrarPorOrigem(linhas, "todas")).toHaveLength(3);
    expect(filtrarPorOrigem(linhas, "Validade")).toEqual([]);
    expect(contarPorOrigem([])).toEqual({ Estoque: 0, Validade: 0, Compras: 0, Aviso: 0 });
  });

  it("as quatro origens são as das quatro listas que o Início tinha", () => {
    expect(ORIGENS_ATENCAO).toEqual(["Estoque", "Validade", "Compras", "Aviso"]);
    expect(LIMITE_ATENCAO_HOJE).toBe(10);
  });
});
