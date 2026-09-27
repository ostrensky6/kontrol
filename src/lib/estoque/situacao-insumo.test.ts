import { describe, expect, it } from "vitest";
import {
  FILTROS_INSUMO,
  FILTROS_LOTE,
  FILTROS_SALDO,
  SINAIS_INSUMO,
  contarComSinal,
  contarSemSinal,
  filtroValidoNaVisao,
  insumoAtendeFiltro,
  janelaVencimentoDias,
  loteAtendeFiltro,
  loteVenceEmBreve,
  rotuloDoSaldo,
  saldoAtendeFiltro,
  sinaisDoInsumo,
  situacaoDoInsumo,
  situacoesDoSaldo,
  somarDiasIso,
  type SinalInsumo,
} from "./situacao-insumo";

const HOJE = "2026-09-27";
const alerta = (tipo: string) => ({ tipo });

describe("sinais do insumo", () => {
  it("insumo sem alerta, com saldo e sem sugestão de compra está em dia", () => {
    const situacao = situacaoDoInsumo({ disponivel: 10, qtd_sugerida_compra: 0 }, []);
    expect(situacao).toEqual({ sinais: [], principal: null, rotulo: "Estoque OK", tom: "slate" });
  });

  it("guarda todos os sinais simultâneos, em ordem de gravidade", () => {
    const sinais = sinaisDoInsumo({ disponivel: 0, qtd_sugerida_compra: 5 }, [
      alerta("vencimento"),
      alerta("reposicao"),
      alerta("compra_atrasada"),
      alerta("vencido"),
      alerta("sem_validade"),
      alerta("vencido"),
    ]);
    expect(sinais).toEqual(["vencido", "sem_validade", "sem_disponivel", "compra_atrasada", "reposicao", "vencendo"]);
  });

  it("reposição vem da sugestão da previsão, não da linha de alerta", () => {
    expect(sinaisDoInsumo({ disponivel: 3, qtd_sugerida_compra: "2.5" }, [])).toEqual(["reposicao"]);
    expect(sinaisDoInsumo({ disponivel: 3, qtd_sugerida_compra: 0 }, [alerta("reposicao")])).toEqual([]);
  });

  it("sem estoque quando o disponível é zero, negativo ou ausente", () => {
    expect(sinaisDoInsumo({ disponivel: 0 }, [])).toEqual(["sem_disponivel"]);
    expect(sinaisDoInsumo({ disponivel: -1 }, [])).toEqual(["sem_disponivel"]);
    expect(sinaisDoInsumo({ disponivel: null }, [])).toEqual(["sem_disponivel"]);
  });

  it("reposição aguardando aprovação é um sinal próprio e tira o insumo do estoque OK", () => {
    const situacao = situacaoDoInsumo({ disponivel: 8, qtd_sugerida_compra: 0 }, [alerta("reposicao_pendente")]);
    expect(situacao.sinais).toEqual(["reposicao_pendente"]);
    expect(situacao.principal).toBe("reposicao_pendente");
    expect(situacao.rotulo).toBe("Reposição aguardando aprovação");
    expect(situacao.tom).toBe("amber");
    expect(insumoAtendeFiltro(situacao.sinais, "ok")).toBe(false);
    expect(insumoAtendeFiltro(situacao.sinais, "reposicao_pendente")).toBe(true);
    expect(insumoAtendeFiltro(situacao.sinais, "reposicao")).toBe(false);
  });

  it("principal segue a gravidade: vencido > sem validade > sem estoque > compra atrasada > reposição > aguardando > vence em breve", () => {
    const casos: [Parameters<typeof situacaoDoInsumo>, SinalInsumo][] = [
      [[{ disponivel: 0, qtd_sugerida_compra: 1 }, [alerta("vencido"), alerta("sem_validade")]], "vencido"],
      [[{ disponivel: 0, qtd_sugerida_compra: 1 }, [alerta("sem_validade")]], "sem_validade"],
      [[{ disponivel: 0, qtd_sugerida_compra: 1 }, [alerta("compra_atrasada")]], "sem_disponivel"],
      [[{ disponivel: 5, qtd_sugerida_compra: 1 }, [alerta("compra_atrasada")]], "compra_atrasada"],
      [[{ disponivel: 5, qtd_sugerida_compra: 1 }, [alerta("reposicao_pendente"), alerta("vencimento")]], "reposicao"],
      [[{ disponivel: 5, qtd_sugerida_compra: 0 }, [alerta("vencimento"), alerta("reposicao_pendente")]], "reposicao_pendente"],
      [[{ disponivel: 5, qtd_sugerida_compra: 0 }, [alerta("vencimento")]], "vencendo"],
    ];
    for (const [args, principal] of casos) {
      expect(situacaoDoInsumo(...args).principal).toBe(principal);
    }
  });

  it("ignora tipos de alerta desconhecidos ou nulos", () => {
    expect(sinaisDoInsumo({ disponivel: 1 }, [{ tipo: null }, alerta("quarentena")])).toEqual([]);
  });
});

describe("filtros e contadores por sinal", () => {
  const semEstoqueERepor = { sinais: sinaisDoInsumo({ disponivel: 0, qtd_sugerida_compra: 4 }, []) };
  const vencidoERepor = { sinais: sinaisDoInsumo({ disponivel: 5, qtd_sugerida_compra: 4 }, [alerta("vencido")]) };
  const semValidade = { sinais: sinaisDoInsumo({ disponivel: 5 }, [alerta("sem_validade")]) };
  const vencendo = { sinais: sinaisDoInsumo({ disponivel: 5 }, [alerta("vencimento")]) };
  const aguardando = { sinais: sinaisDoInsumo({ disponivel: 5 }, [alerta("reposicao_pendente")]) };
  const emDia = { sinais: sinaisDoInsumo({ disponivel: 5 }, []) };
  const itens = [semEstoqueERepor, vencidoERepor, semValidade, vencendo, aguardando, emDia];

  it("insumo com alertas simultâneos aparece em cada filtro secundário", () => {
    expect(insumoAtendeFiltro(semEstoqueERepor.sinais, "sem_disponivel")).toBe(true);
    expect(insumoAtendeFiltro(semEstoqueERepor.sinais, "reposicao")).toBe(true);
    expect(insumoAtendeFiltro(vencidoERepor.sinais, "reposicao")).toBe(true);
    expect(insumoAtendeFiltro(vencidoERepor.sinais, "vencido_vencendo")).toBe(true);
  });

  it("Vencido/Vencendo não inclui sem validade; sem validade tem filtro próprio", () => {
    expect(insumoAtendeFiltro(semValidade.sinais, "vencido_vencendo")).toBe(false);
    expect(insumoAtendeFiltro(semValidade.sinais, "sem_validade")).toBe(true);
    expect(insumoAtendeFiltro(vencendo.sinais, "vencido_vencendo")).toBe(true);
  });

  it("Estoque OK só pega insumo sem nenhum sinal", () => {
    expect(itens.filter((item) => insumoAtendeFiltro(item.sinais, "ok"))).toEqual([emDia]);
  });

  it("cada opção oferecida na visão por insumo filtra alguma coisa e Todos filtra nada", () => {
    const atrasada = { sinais: sinaisDoInsumo({ disponivel: 1 }, [alerta("compra_atrasada")]) };
    const todos = [...itens, atrasada];
    for (const { valor } of FILTROS_INSUMO) {
      const passam = todos.filter((item) => insumoAtendeFiltro(item.sinais, valor)).length;
      if (valor === "todos") expect(passam).toBe(todos.length);
      else expect(passam, valor).toBeGreaterThan(0);
    }
    expect(insumoAtendeFiltro(emDia.sinais, "inexistente")).toBe(false);
  });

  it("contador conta o insumo em todo cartão cujo sinal ele tem; saúde = sem sinal", () => {
    expect(contarComSinal(itens, "sem_disponivel")).toBe(1);
    expect(contarComSinal(itens, "reposicao")).toBe(2);
    expect(contarComSinal(itens, "reposicao_pendente")).toBe(1);
    expect(contarComSinal(itens, "vencido", "sem_validade", "vencendo")).toBe(3);
    expect(contarSemSinal(itens)).toBe(1);
  });

  it("todo sinal tem opção de filtro na visão por insumo", () => {
    const valores = FILTROS_INSUMO.map((f) => f.valor as string);
    for (const sinal of SINAIS_INSUMO) {
      const coberto = valores.includes(sinal) || (["vencido", "vencendo"].includes(sinal) && valores.includes("vencido_vencendo"));
      expect(coberto, sinal).toBe(true);
    }
  });
});

describe("validade do lote", () => {
  it("janela de vencimento usa o parâmetro, com 60 dias de padrão", () => {
    expect(janelaVencimentoDias(undefined)).toBe(60);
    expect(janelaVencimentoDias(null)).toBe(60);
    expect(janelaVencimentoDias("")).toBe(60);
    expect(janelaVencimentoDias("abc")).toBe(60);
    expect(janelaVencimentoDias(30)).toBe(30);
    expect(janelaVencimentoDias("45")).toBe(45);
  });

  it("soma dias atravessando mês e ano", () => {
    expect(somarDiasIso("2026-09-27", 60)).toBe("2026-11-26");
    expect(somarDiasIso("2026-12-20", 15)).toBe("2027-01-04");
    expect(somarDiasIso("2026-09-27", 0)).toBe("2026-09-27");
  });

  it("vence em breve: não vencido e dentro da janela (limite incluído)", () => {
    expect(loteVenceEmBreve("2026-09-27", HOJE, 60)).toBe(true); // vence hoje: ainda não venceu
    expect(loteVenceEmBreve("2026-11-26", HOJE, 60)).toBe(true);
    expect(loteVenceEmBreve("2026-11-27", HOJE, 60)).toBe(false);
    expect(loteVenceEmBreve("2026-09-26", HOJE, 60)).toBe(false); // já venceu
    expect(loteVenceEmBreve(null, HOJE, 60)).toBe(false);
    expect(loteVenceEmBreve("2026-10-10T00:00:00", HOJE, 30)).toBe(true);
  });

  it("filtros da visão por lote: cada opção oferecida funciona", () => {
    const vencido = { vencido: true, vencendo: false, validadeIso: "2026-01-01" };
    const vencendo = { vencido: false, vencendo: true, validadeIso: "2026-10-15" };
    const semValidade = { vencido: false, vencendo: false, validadeIso: null };
    const emDia = { vencido: false, vencendo: false, validadeIso: "2030-01-01" };
    const lotes = [vencido, vencendo, semValidade, emDia];
    const por = (filtro: string) => lotes.filter((lote) => loteAtendeFiltro(lote, filtro));

    expect(FILTROS_LOTE.map((f) => f.valor)).toEqual(["todos", "vencido", "vencendo", "sem_validade"]);
    expect(por("todos")).toEqual(lotes);
    expect(por("vencido")).toEqual([vencido]);
    expect(por("vencendo")).toEqual([vencendo]);
    expect(por("sem_validade")).toEqual([semValidade]);
    expect(por("reposicao")).toEqual([]);
  });

  it("ao trocar de visão, só filtros que existem na nova visão continuam", () => {
    expect(filtroValidoNaVisao("todos", "lote")).toBe(true);
    expect(filtroValidoNaVisao("sem_validade", "lote")).toBe(true);
    expect(filtroValidoNaVisao("sem_validade", "insumo")).toBe(true);
    expect(filtroValidoNaVisao("reposicao", "lote")).toBe(false);
    expect(filtroValidoNaVisao("vencendo", "insumo")).toBe(false);
    expect(filtroValidoNaVisao("vencido_vencendo", "lote")).toBe(false);
    expect(filtroValidoNaVisao("ok", "grafica")).toBe(true);
  });
});

describe("status da tabela de saldo (/estoque)", () => {
  it("sem estoque e repor ao mesmo tempo: casa com os dois filtros", () => {
    const situacoes = situacoesDoSaldo({ emMaos: 0, repor: true, reposicaoPendente: false });
    expect(situacoes).toEqual(["sem_estoque", "repor"]);
    expect(saldoAtendeFiltro(situacoes, "sem_estoque")).toBe(true);
    expect(saldoAtendeFiltro(situacoes, "repor")).toBe(true);
    expect(saldoAtendeFiltro(situacoes, "ok")).toBe(false);
    expect(rotuloDoSaldo(situacoes)).toBe("Sem estoque · Repor");
  });

  it("em dia só sem nenhuma condição; aguardando aprovação não está em dia", () => {
    const emDia = situacoesDoSaldo({ emMaos: 5, repor: false, reposicaoPendente: false });
    const aguardando = situacoesDoSaldo({ emMaos: 5, repor: false, reposicaoPendente: true });
    expect(emDia).toEqual([]);
    expect(rotuloDoSaldo(emDia)).toBe("Em dia");
    expect(saldoAtendeFiltro(emDia, "ok")).toBe(true);
    expect(saldoAtendeFiltro(aguardando, "ok")).toBe(false);
    expect(saldoAtendeFiltro(aguardando, "reposicao_pendente")).toBe(true);
  });

  it("filtro vazio mostra tudo; cada opção oferecida é tratada", () => {
    expect(saldoAtendeFiltro(["repor"], undefined)).toBe(true);
    expect(saldoAtendeFiltro(["repor"], "")).toBe(true);
    const todas = [
      [],
      ["sem_estoque"],
      ["repor"],
      ["reposicao_pendente"],
    ] as const;
    for (const { value } of FILTROS_SALDO) {
      expect(todas.some((s) => saldoAtendeFiltro(s, value)), value).toBe(true);
    }
    expect(saldoAtendeFiltro(["repor"], "inexistente")).toBe(false);
  });
});
