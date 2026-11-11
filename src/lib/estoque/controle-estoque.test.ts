import { describe, expect, it } from "vitest";

import {
  FILTROS_AVISO,
  FILTROS_CRITICIDADE,
  FILTROS_SITUACAO_CONTROLE,
  VISOES_SITUACAO,
  avisosDoInsumo,
  filtrarInsumosDoControle,
  hrefListaPorInsumo,
  numerosDoEstoque,
  filtroSituacaoControleValido,
  hrefVisaoSituacao,
  insumoAtendeAvisos,
  insumosPorSituacaoPrincipal,
  loteAtendeControle,
  resumirSinais,
  visaoSituacaoValida,
  type AvisoDb,
  type InsumoParaControle,
} from "./controle-estoque";
import type { SinalInsumo } from "./situacao-insumo";

const aviso = (dados: Partial<AvisoDb> & { id: number }): AvisoDb => ({
  titulo: "Aviso",
  corpo: null,
  entidade_tipo: null,
  entidade_id: null,
  status: "nao_lida",
  criado_em: "2026-11-10T12:00:00Z",
  ...dados,
});

const insumo = (dados: Partial<InsumoParaControle> & { insumoId: number }): InsumoParaControle => ({
  especificacao: `Insumo ${dados.insumoId}`,
  sinais: [],
  categoriaCompra: "operacional",
  avisos: [],
  ...dados,
});

describe("avisos de cada insumo", () => {
  const avisos = [
    aviso({ id: 1, entidade_tipo: "insumo", entidade_id: 7, titulo: "Reposição necessária" }),
    aviso({ id: 2, titulo: "Falta de estoque no planejamento", corpo: "Mix PCR: falta 10 uL no planejamento #1." }),
    aviso({ id: 3, titulo: "Etanol 70% vence em 5 dias", status: "lida" }),
    aviso({ id: 4, entidade_tipo: "planejamento", entidade_id: 7, titulo: "Plano aprovado" }),
  ];

  it("liga o aviso gravado para o insumo e o que cita o nome no título ou no texto", () => {
    expect(avisosDoInsumo(avisos, 7, "Tampão TE").map((a) => a.id)).toEqual([1]);
    expect(avisosDoInsumo(avisos, 9, "Mix PCR").map((a) => a.id)).toEqual([2]);
    expect(avisosDoInsumo(avisos, 10, "etanol 70%").map((a) => [a.id, a.status])).toEqual([[3, "lida"]]);
  });

  it("prova negativa: outro tipo de registro com o mesmo número e nome curto demais não ligam", () => {
    // o aviso 4 é do planejamento 7, não do insumo 7
    expect(avisosDoInsumo(avisos, 7, "Tampão TE").some((a) => a.id === 4)).toBe(false);
    // "Mi" apareceria em qualquer texto com "Mix"
    expect(avisosDoInsumo(avisos, 99, "Mi")).toEqual([]);
    expect(avisosDoInsumo(avisos, 99, "Primer que ninguém citou")).toEqual([]);
  });
});

describe("filtro pelos avisos: pendentes, tratados e sem aviso", () => {
  const pendente = [{ status: "nao_lida" }, { status: "lida" }];
  const tratado = [{ status: "lida" }];

  it("cada insumo entra em um só dos três estados", () => {
    expect(insumoAtendeAvisos(pendente, "pendentes")).toBe(true);
    expect(insumoAtendeAvisos(pendente, "tratados")).toBe(false);
    expect(insumoAtendeAvisos(tratado, "tratados")).toBe(true);
    expect(insumoAtendeAvisos(tratado, "pendentes")).toBe(false);
    expect(insumoAtendeAvisos([], "sem_aviso")).toBe(true);
    expect(insumoAtendeAvisos(tratado, "sem_aviso")).toBe(false);
  });

  it("prova negativa: insumo sem aviso não passa por tratado, e filtro desconhecido não mostra nada", () => {
    expect(insumoAtendeAvisos([], "tratados")).toBe(false);
    expect(insumoAtendeAvisos(pendente, "qualquer")).toBe(false);
    expect(insumoAtendeAvisos([], "todos")).toBe(true);
  });

  it("as opções são as quatro do Controle de Estoque", () => {
    expect(FILTROS_AVISO.map((f) => f.valor)).toEqual(["todos", "pendentes", "tratados", "sem_aviso"]);
  });
});

describe("os quatro filtros da visão por insumo", () => {
  const itens = [
    insumo({ insumoId: 1, especificacao: "Mix PCR", sinais: ["sem_disponivel", "reposicao"], categoriaCompra: "critico", avisos: [{ status: "nao_lida" }] }),
    insumo({ insumoId: 2, especificacao: "Etanol 70%", sinais: ["vencendo"], categoriaCompra: "operacional", avisos: [{ status: "lida" }] }),
    insumo({ insumoId: 3, especificacao: "Kit extração", sinais: [], categoriaCompra: "eventual" }),
  ];
  const base = { busca: "", situacao: "todos", criticidade: "todos", avisos: "todos" };
  const ids = (filtros: Partial<typeof base>) => filtrarInsumosDoControle(itens, { ...base, ...filtros }).map((i) => i.insumoId);

  it("situação: o insumo aparece em todo filtro de sinal que tem", () => {
    expect(ids({ situacao: "atencao" })).toEqual([1, 2]);
    expect(ids({ situacao: "sem_disponivel" })).toEqual([1]);
    expect(ids({ situacao: "reposicao" })).toEqual([1]);
    expect(ids({ situacao: "vencido_vencendo" })).toEqual([2]);
    expect(ids({ situacao: "ok" })).toEqual([3]);
  });

  it("criticidade usa a categoria de compra do cadastro", () => {
    expect(FILTROS_CRITICIDADE.map((f) => f.valor)).toEqual(["todos", "critico", "operacional", "eventual"]);
    expect(ids({ criticidade: "critico" })).toEqual([1]);
    expect(ids({ criticidade: "eventual" })).toEqual([3]);
  });

  it("busca pelo nome ou pelo número; os filtros somam", () => {
    expect(ids({ busca: "etanol" })).toEqual([2]);
    expect(ids({ busca: "3" })).toEqual([3]);
    expect(ids({ situacao: "atencao", avisos: "pendentes" })).toEqual([1]);
    expect(ids({ situacao: "atencao", avisos: "tratados" })).toEqual([2]);
    expect(ids({ avisos: "sem_aviso" })).toEqual([3]);
    // negativa: crítico em dia não existe nesta lista
    expect(ids({ situacao: "ok", criticidade: "critico" })).toEqual([]);
  });

  it("a lista abre em Precisa de atenção, e valor desconhecido na URL volta ao padrão", () => {
    expect(FILTROS_SITUACAO_CONTROLE[0].valor).toBe("atencao");
    expect(filtroSituacaoControleValido(undefined)).toBe("atencao");
    expect(filtroSituacaoControleValido("inventado")).toBe("atencao");
    expect(filtroSituacaoControleValido("compra_atrasada")).toBe("compra_atrasada");
  });
});

describe("números do estoque (topo da Situação e Início)", () => {
  const sinais = (...lista: SinalInsumo[][]) => lista.map((s) => ({ sinais: s }));
  const itens = sinais(
    ["vencido", "sem_disponivel", "reposicao"],
    ["sem_disponivel"],
    ["vencendo"],
    ["compra_atrasada", "reposicao_pendente"],
    ["sem_validade"],
    [],
    [],
    [],
  );

  it("um insumo com dois sinais conta nos dois números; a saúde conta quem não tem nenhum", () => {
    expect(resumirSinais(itens)).toEqual({
      total: 8,
      semEstoque: 2,
      repor: 1,
      reporAguardandoAprovacao: 1,
      vencido: 1,
      vencendo: 1,
      vencidosOuVencendo: 2,
      semValidade: 1,
      compraAtrasada: 1,
      emDia: 3,
      saudePct: 38,
    });
  });

  it("sem estoque e vencidos ou vencendo são números separados", () => {
    const resumo = resumirSinais(sinais(["sem_disponivel"], ["vencido"], ["vencendo"]));
    expect(resumo.semEstoque).toBe(1);
    expect(resumo.vencidosOuVencendo).toBe(2);
  });

  it("sem insumo, a saúde é zero e nada divide por zero", () => {
    expect(resumirSinais([]).saudePct).toBe(0);
    expect(resumirSinais(sinais([], [])).saudePct).toBe(100);
  });

  it("gráfico: cada insumo uma vez, na situação mais grave, e as barras somam o total", () => {
    const barras = insumosPorSituacaoPrincipal(itens);
    expect(barras).toEqual([
      { situacao: "Lote vencido", insumos: 1, tom: "red" },
      { situacao: "Sem validade", insumos: 1, tom: "red" },
      { situacao: "Sem estoque", insumos: 1, tom: "red" },
      { situacao: "Compra atrasada", insumos: 1, tom: "red" },
      { situacao: "Vence em breve", insumos: 1, tom: "amber" },
      { situacao: "Em dia", insumos: 3, tom: "ok" },
    ]);
    expect(barras.reduce((soma, barra) => soma + barra.insumos, 0)).toBe(itens.length);
  });
});

describe("os quatro números do estoque (Situação e Início usam a mesma regra)", () => {
  const sinais = (...lista: SinalInsumo[][]) => lista.map((s) => ({ sinais: s }));

  it("cada número traz o valor, o texto e o filtro da lista que ele abre", () => {
    const numeros = numerosDoEstoque(
      resumirSinais(sinais(["vencido", "sem_disponivel", "reposicao"], ["vencendo"], ["reposicao_pendente"], ["sem_validade"], [])),
    );
    expect(numeros.map((n) => [n.label, n.value, n.filtro, n.tone])).toEqual([
      ["Sem estoque", 1, "sem_disponivel", "danger"],
      ["Repor", 1, "reposicao", "warning"],
      ["Vencidos ou vencendo", 2, "vencido_vencendo", "danger"],
      ["Compra atrasada", 0, "compra_atrasada", "neutral"],
    ]);
    expect(numeros[1].detail).toBe("hora de pedir · 1 com pedido aguardando aprovação");
    expect(numeros[2].detail).toBe("1 com lote vencido · 1 vencendo · 1 sem validade");
    expect(hrefListaPorInsumo("sem_disponivel")).toBe("/estoque/situacao?alerta=sem_disponivel#controle-por-insumo");
  });

  it("só vencendo é atenção, não urgência; sem nada, todos ficam neutros", () => {
    expect(numerosDoEstoque(resumirSinais(sinais(["vencendo"])))[2].tone).toBe("warning");
    expect(numerosDoEstoque(resumirSinais(sinais([], []))).map((n) => [n.value, n.tone])).toEqual([
      [0, "neutral"],
      [0, "neutral"],
      [0, "neutral"],
      [0, "neutral"],
    ]);
  });

  it("prova negativa: leitura incompleta mostra “sem dado” nos quatro, nunca zero", () => {
    const numeros = numerosDoEstoque(null);
    expect(numeros.map((n) => n.value)).toEqual(["sem dado", "sem dado", "sem dado", "sem dado"]);
    expect(numeros.every((n) => n.tone === "neutral" && n.detail === "a leitura do estoque não respondeu por inteiro")).toBe(true);
    // o destino continua o mesmo: a pessoa abre a lista e vê o aviso da leitura
    expect(numeros.map((n) => n.filtro)).toEqual(["sem_disponivel", "reposicao", "vencido_vencendo", "compra_atrasada"]);
  });
});

describe("visão por lote", () => {
  const vencido = { vencido: true, vencendo: false, validadeIso: "2026-01-01" };
  const vencendo = { vencido: false, vencendo: true, validadeIso: "2026-11-20" };
  const semValidade = { vencido: false, vencendo: false, validadeIso: null };
  const emDia = { vencido: false, vencendo: false, validadeIso: "2099-01-01" };

  it("Precisa de atenção junta vencido, vence em breve e sem validade; lote em dia fica de fora", () => {
    expect([vencido, vencendo, semValidade, emDia].map((lote) => loteAtendeControle(lote, "atencao"))).toEqual([true, true, true, false]);
    expect(loteAtendeControle(emDia, "todos")).toBe(true);
    expect(loteAtendeControle(vencendo, "vencido")).toBe(false);
    expect(loteAtendeControle(semValidade, "sem_validade")).toBe(true);
    expect(loteAtendeControle(vencido, "inventado")).toBe(false);
  });
});

describe("as três visões da Situação do estoque", () => {
  it("por insumo, por lote e gráficos, nessa ordem", () => {
    expect(VISOES_SITUACAO.map((v) => v.rotulo)).toEqual(["Por insumo", "Por lote", "Gráficos"]);
    expect(visaoSituacaoValida("lote")).toBe("lote");
    expect(visaoSituacaoValida(undefined)).toBe("insumo");
    expect(visaoSituacaoValida("grafica")).toBe("insumo");
  });

  it("o endereço leva a visão e o filtro, sem repetir o padrão", () => {
    expect(hrefVisaoSituacao("insumo")).toBe("/estoque/situacao");
    expect(hrefVisaoSituacao("lote")).toBe("/estoque/situacao?ver=lote");
    expect(hrefVisaoSituacao("insumo", "sem_disponivel")).toBe("/estoque/situacao?alerta=sem_disponivel");
    expect(hrefVisaoSituacao("insumo", "atencao")).toBe("/estoque/situacao");
  });
});
