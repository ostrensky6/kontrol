import { describe, expect, it } from "vitest";
import { montarSnapshotLaboratorio } from "../orcamento/laboratorio-operacional";
import { calcularAnaliseOrcamento } from "./engine";
import { calcularOrcamentoEquivalencia, type EntradaEquivalencia } from "./equivalencia-orcamento";

const agora = 1000;
const contexto = {
  codigo_analise: "A1", necessidade_id: 11, etapa_id: 21,
  metodo_revisao_ref: "metodo:M1:r2", equipamento_ref: "modelo:E1",
};
const opcao = (insumo_id: number, custo_unitario_estoque: number | null, fator_conversao = 100) => ({
  insumo_id, apresentacao_ref: `apresentacao:${insumo_id}:r1`, unidade_estoque: "frasco",
  unidade_consumo: "reação", fator_conversao, custo_unitario_estoque,
  fonte_custo: "custo_padrao", referencia_custo: `insumos:${insumo_id}`,
});
const decisao = (o: ReturnType<typeof opcao>) => ({
  ...contexto, insumo_id: o.insumo_id, apresentacao_ref: o.apresentacao_ref,
  unidade_estoque: o.unidade_estoque, unidade_consumo: o.unidade_consumo, fator_conversao: o.fator_conversao,
  decisao_ref: `validacao:${o.insumo_id}:r1`, evidencia_ref: "evidencia:dimensionamento:r1",
  validador_id: "ator:1", papel_validador: "laboratorio" as const,
  estado: "validada" as const, vigente_desde: 100, vigente_ate: null as number | null,
});
const barata = opcao(91, 150, 100);
const cara = opcao(92, 90, 30);
const etapa = {
  id: 21, nome_etapa: "Preparo", nome_atividade: "Mistura", execucoes_por_dia: 1,
  amostras_por_execucao: 2, tempo_maquina_h: 0, tempo_bancada_h: 0,
};
const parametros = {
  dias_uteis_ano: 222, margem_lucro: 0, impostos: 0, taxas: 0, fundo_reserva: 0, fundo_investimento: 0,
};
const entrada = (opts = [barata, cara]): EntradaEquivalencia => ({
  versao: "equivalencia-contextual-v1", codigo: "A1", metodo_revisao_ref: contexto.metodo_revisao_ref,
  instante: agora, numeroAmostras: 3, etapas: [etapa], equip: [], valorHoraPessoal: 0,
  custoHoraOverhead: 0, params: parametros,
  necessidades: [{
    id: 11, etapa_id: 21, equipamento_ref: contexto.equipamento_ref,
    quantidade_por_base: 2, modo_cobranca: "por_execucao", unidade_consumo: "reação", alternativas: opts,
  }],
  decisoes: opts.map(decisao),
});

describe("orçamento opt-in com equivalência contextual", () => {
  it("seleciona o maior custo convertido da quantidade necessária, pelo lote da etapa identificada", () => {
    const args = entrada();
    // Mesmos nomes, outro ID e lote. Não se deve cobrar pelo lote do homônimo.
    args.etapas.push({ ...etapa, id: 22, amostras_por_execucao: 20 });
    const resultado = calcularOrcamentoEquivalencia(args);
    expect(resultado).toMatchObject({ estado: "calculado", versao: args.versao,
      calculo: { totais: { reagentes: 12, custoTotal: 12, preco: 12 }, provenienciaDimensional: [{
        insumo_id: 92, fator_conversao: 30, custo_unitario_estoque: 90, custo_unitario_consumo: 3,
      }] },
      selecao: [{
        necessidade_id: 11, etapa_id: 21, insumo_id: 92, decisao_ref: "validacao:92:r1",
        quantidade_consumo: 4, quantidade_estoque: 4 / 30, custo_total_insumo: 12,
      }],
    });
  });

  it("preserva preço zero comprovado, mas preço ausente impede afirmar o maior custo", () => {
    expect(calcularOrcamentoEquivalencia(entrada([opcao(91, 0)]))).toMatchObject({
      estado: "calculado", calculo: { totais: { custoTotal: 0 } },
    });
    expect(calcularOrcamentoEquivalencia(entrada([barata, opcao(92, null, 30)]))).toMatchObject({
      estado: "pendente", pendencias: [{ necessidade_id: 11, motivo: "preco_nao_comprovado", insumo_id: 92 }],
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("não usa preço de embalagem quando o fator é %s", (fator) => {
    const args = entrada([barata, { ...cara, fator_conversao: fator }]);
    args.decisoes[1] = decisao(cara);
    expect(calcularOrcamentoEquivalencia(args)).toMatchObject({
      estado: "pendente", pendencias: [{ necessidade_id: 11, motivo: "dimensao_nao_comprovada", insumo_id: 92 }],
    });
  });

  it.each([
    { estado: "revogada" }, { metodo_revisao_ref: "metodo:M1:r1" }, { equipamento_ref: "modelo:E2" },
    { apresentacao_ref: "apresentacao:92:r0" }, { etapa_id: null }, { necessidade_id: 12 },
    { vigente_ate: agora }, { vigente_desde: agora + 1 }, { papel_validador: "administrador" },
    { evidencia_ref: "" },
  ] as const)("não promove a decisão fora do contexto/vigência: %j", (delta) => {
    const args = entrada();
    args.decisoes[1] = { ...args.decisoes[1], ...delta } as typeof args.decisoes[number];
    expect(calcularOrcamentoEquivalencia(args)).toMatchObject({
      estado: "calculado", selecao: [{ insumo_id: 91 }], calculo: { totais: { reagentes: 6 } },
    });
  });

  it("não infere equivalência de nome, preferência ou cadastro sem decisão", () => {
    const homonima = { ...cara, preferencial: true, especificacao_insumo: "homônimo" };
    const args = entrada([homonima]);
    args.decisoes = [];
    expect(calcularOrcamentoEquivalencia(args)).toMatchObject({
      estado: "pendente", pendencias: [{ necessidade_id: 11, motivo: "sem_validacao_ativa" }],
    });
  });

  it("recusa entrada incompleta ou duas decisões efetivas para a mesma opção", () => {
    const args = entrada();
    expect(calcularOrcamentoEquivalencia({ ...args, metodo_revisao_ref: "" })).toMatchObject({
      estado: "pendente", pendencias: [{ motivo: "contexto_incompleto" }],
    });
    args.decisoes.push({ ...args.decisoes[1], estado: "revogada" });
    const resultado = calcularOrcamentoEquivalencia(args);
    expect(resultado).toMatchObject({ estado: "pendente", pendencias: [
      { necessidade_id: 11, insumo_id: 92, motivo: "decisao_ambigua" },
    ] });
    expect(resultado).not.toHaveProperty("calculo");
  });

  it("não calcula com opção ativa omitida ou lote desconhecido da etapa vinculada", () => {
    const args = entrada();
    args.necessidades[0].alternativas = [barata];
    expect(calcularOrcamentoEquivalencia(args)).toMatchObject({
      estado: "pendente", pendencias: [{ necessidade_id: 11, insumo_id: 92, motivo: "contexto_incompleto" }],
    });
    args.necessidades[0].alternativas = [barata, cara];
    args.etapas = [
      { ...etapa, amostras_por_execucao: null },
      { ...etapa, id: 22 },
    ];
    expect(calcularOrcamentoEquivalencia(args)).toMatchObject({
      estado: "pendente", pendencias: [{ necessidade_id: 11, motivo: "quantidade_nao_comprovada" }],
    });
  });

  it("preserva nulidade explícita de etapa e equipamento sem tratá-la como wildcard", () => {
    const args = entrada([barata]);
    args.necessidades[0] = { ...args.necessidades[0], etapa_id: null, equipamento_ref: null };
    expect(calcularOrcamentoEquivalencia(args)).toMatchObject({ estado: "pendente" });
    args.decisoes[0] = { ...args.decisoes[0], etapa_id: null, equipamento_ref: null, papel_validador: "supervisor" };
    expect(calcularOrcamentoEquivalencia(args)).toMatchObject({
      estado: "calculado", selecao: [{ etapa_id: null, insumo_id: 91 }],
    });
  });

  it("mantém serialização legada idêntica e usa a proveniência já gravada no histórico", () => {
    const args = entrada();
    const legado = {
      ...args,
      insumos: [barata, cara].map((o) => ({
        ...o, nome_etapa: etapa.nome_etapa, nome_atividade: etapa.nome_atividade,
        especificacao_insumo: String(o.insumo_id), grupo_escolha: "G", modo_cobranca: "por_execucao",
        quantidade_por_amostra: 2, custo_unitario: o.custo_unitario_estoque,
        custo_unitario_consumo: (o.custo_unitario_estoque ?? 0) / o.fator_conversao,
      })),
    };
    // Serialização completa capturada do motor base antes da mudança.
    const jsonLegado = '{"codigo":"A1","lote":2,"reagentes":2,"equipamento":0,"pessoal":0,"custoAnalitico":2,"overhead":0,"custoTotal":2,"fatores":0,"preco":2,"provenienciaDimensional":[{"insumo_id":91,"unidade_estoque":"frasco","unidade_consumo":"reação","fator_conversao":100,"fonte_custo":"custo_padrao","referencia_custo":"insumos:91","custo_unitario_estoque":150,"custo_unitario_consumo":1.5,"quantidade_consumo":2,"quantidade_estoque":0.02}],"nAmostras":3,"numeroExecucoes":2,"escolhasGrupo":{},"totais":{"reagentes":6,"equipamento":0,"pessoal":0,"overhead":0,"custoAnalitico":6,"custoTotal":6,"preco":6}}';
    const anterior: ReturnType<typeof calcularAnaliseOrcamento> = JSON.parse(jsonLegado);
    const item = { codigo_analise: args.codigo, n_amostras: 3, custo_unitario: anterior.custoTotal,
      preco_unitario: anterior.preco, valor_snapshot: { proveniencia_dimensional: anterior.provenienciaDimensional ?? [] } };
    const resultado = calcularOrcamentoEquivalencia(args);
    if (resultado.estado !== "calculado") throw new Error("fixture válida rejeitada");
    expect(resultado.calculo.totais.custoTotal).toBe(12);
    expect(anterior.totais.custoTotal).toBe(6);
    expect(JSON.stringify(calcularAnaliseOrcamento(legado))).toBe(jsonLegado);
    expect(montarSnapshotLaboratorio([item], [resultado.calculo])).toMatchObject({
      linhas: [{ proveniencia_dimensional: anterior.provenienciaDimensional }],
    });
  });
});
