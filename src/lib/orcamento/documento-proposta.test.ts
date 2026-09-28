import { describe, expect, it } from "vitest";

import { montarDocumentoProposta, type DemandaDoc } from "./documento-proposta";
import { calcularPropostaEconomica, parametrosDeRates } from "./engine-economica";
import { docDeTextoPlano } from "./texto-rico";
import type { TextosProposta } from "./textos-proposta";
import { montarVisaoInterna } from "./visao-interna";

const economia = calcularPropostaEconomica({
  custoLaboratorioTecnico: 1260,
  custoDiretoProjeto: 5740,
  parametros: parametrosDeRates({ impostos_legacy: 10, incubacao: 5, reserva: 2.5, investimentos: 1, lucro: 2 }),
});
const visao = montarVisaoInterna({
  itensLaboratorio: [
    { codigo_analise: "ExtDNA", n_amostras: 12, custo_unitario: 45, preco_unitario: 70 },
    { codigo_analise: "qPCR16S", n_amostras: 12, custo_unitario: 60, preco_unitario: 95 },
  ],
  custosProjeto: [
    { rubrica: "PE", descricao: "Técnico de laboratório", quantidade: 1, custo_unitario: 1200, meses_selecionados: [1, 2, 3, 4] },
    { rubrica: "MC", descricao: "Kit de extração", quantidade: 2, unidade: "un", custo_unitario: 300 },
    { rubrica: "MC", descricao: "Ponteiras com filtro", quantidade: 4, unidade: "cx", custo_unitario: 85 },
  ],
  analisesProjeto: [],
  parametros: economia.parametros,
  total: economia.totalFinal,
  legado: false,
  nomesAnalises: { ExtDNA: "Extração de DNA", qPCR16S: "qPCR 16S" },
});

const demanda: DemandaDoc = {
  titulo: "Monitoramento microbiológico do ar",
  instituicao: "ATGC",
  modalidade: "analises",
  cliente_nome: "Cliente Homologacao ATGC",
  cliente_cnpj: "00.000.000/0001-91",
  cliente_contato: "Contato ATGC",
  cliente_email: "contato@cliente.com.br",
  cliente_telefone: null,
  cliente_endereco: null,
  matriz_amostra: "Ar interno",
  quantidade_amostras_estimada: 12,
  prazo_tecnico_dias: 30,
};

const textos: TextosProposta = {
  descricao: docDeTextoPlano("Avaliar a presença de microrganismos no ar."),
  secoes: [
    { chave: "prazos", titulo: "Prazos e entregas", texto: docDeTextoPlano("Relatório em até 30 dias.") },
    { chave: "responsabilidades", titulo: "Responsabilidades das partes", texto: null },
    { chave: "condicoes", titulo: "Condições comerciais", texto: docDeTextoPlano("Pagamento em 30 dias.") },
  ],
};

const versao = {
  numero: "OF-2026-0004-v1",
  versao: 1,
  status: "emitido",
  criado_em: "2026-07-02T19:21:12Z",
  valido_ate: "2999-08-01",
  validade_dias: 30,
  total_final: 8750,
};

function montar(extra: Partial<Parameters<typeof montarDocumentoProposta>[0]> = {}) {
  return montarDocumentoProposta({ versao, demanda, visao, textos, empresa: null, ...extra });
}

describe("montarDocumentoProposta", () => {
  it("agrupa os serviços com nomes do cliente, sem códigos de rubrica", () => {
    const doc = montar();
    expect(doc.servicos.grupos.map((g) => g.titulo)).toEqual([
      "Análises laboratoriais",
      "Pessoal técnico",
      "Material de consumo",
    ]);
    const visivel = doc.servicos.grupos.flatMap((g) => [g.titulo, ...g.itens.flatMap((i) => [i.descricao, i.quantidade])]);
    expect(visivel.join(" ")).not.toMatch(/\b(PE|MC)\b/);
    expect(doc.servicos.grupos[0].itens[0]).toEqual({
      descricao: "Extração de DNA",
      quantidade: "12 amostras",
      valorUnitario: 56.25,
      valorTotal: 675,
    });
    expect(doc.servicos.grupos[1].itens[0].quantidade).toBe("4 meses");
    expect(doc.servicos.total).toBe(8750);
    const soma = doc.servicos.grupos.flatMap((g) => g.itens).reduce((a, i) => a + i.valorTotal, 0);
    expect(Math.round(soma * 100) / 100).toBe(8750);
  });

  it("numera as seções depois de objeto, escopo e serviços, sem as vazias", () => {
    const doc = montar();
    expect(doc.numeracao).toEqual({ objeto: 1, escopo: 2, servicos: 3, aceite: 6 });
    expect(doc.secoes.map((s) => [s.numero, s.chave])).toEqual([
      [4, "prazos"],
      [5, "condicoes"],
    ]);
  });

  it("põe a validade como linha automática dos prazos", () => {
    const doc = montar();
    expect(doc.secoes[0].linhasAutomaticas[0]).toBe("Validade da proposta: 30 dias a partir da emissão (até 01/08/2999).");
  });

  it("escopo técnico com matriz, amostras, análises e prazo", () => {
    const doc = montar();
    expect(doc.escopo).toEqual({
      matriz: "Ar interno",
      amostras: 12,
      analises: ["Extração de DNA (ExtDNA)", "qPCR 16S (qPCR16S)"],
      prazoDias: 30,
    });
  });

  it("sem escopo técnico a numeração sobe", () => {
    const doc = montar({
      demanda: { ...demanda, matriz_amostra: null, quantidade_amostras_estimada: null, prazo_tecnico_dias: null },
      visao: { ...visao, grupos: visao.grupos.filter((g) => g.id !== "laboratorio") },
    });
    expect(doc.escopo).toBeNull();
    expect(doc.numeracao.servicos).toBe(2);
  });

  it("cliente só com o que existe e aviso de empresa sem cadastro", () => {
    const doc = montar();
    expect(doc.cliente).toEqual({
      nome: "Cliente Homologacao ATGC",
      documento: "00.000.000/0001-91",
      endereco: null,
      contato: "Contato ATGC",
      email: "contato@cliente.com.br",
      telefone: null,
    });
    expect(doc.empresa.nomeLegal).toBe("ATGC Genética Ambiental Limitada");
    expect(doc.avisos.join(" ")).toMatch(/Empresas emissoras/);
  });

  it("prévia da elaboração não tem número", () => {
    const doc = montar({ rascunho: true });
    expect(doc.numero).toBe("Prévia");
    expect(doc.statusRotulo).toBe("Prévia, ainda não emitida");
  });
});
