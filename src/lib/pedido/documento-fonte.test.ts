import { describe, expect, it } from "vitest";
import {
  dataPorExtenso,
  especificacaoDoItem,
  linhasDoDocumento,
  modeloDocumento,
  prazoDeEntrega,
  quantitativoDosItens,
  rubricasMarcadas,
  textosDosItens,
  type ItemDoDocumento,
} from "./documento-fonte";

const luva: ItemDoDocumento = {
  id: 1,
  tipo: "material",
  especificacao: "Luva PP",
  quantidade: 20,
  unidade: "caixa",
  orcamento_previo: 30,
  insumos: {
    especificacao: "Caixa de luva PP Latex Free",
    descricao_detalhada: "Luvas nitrilo tamanho PP, sem pó",
    fabricante: "Unigloves",
    justificativa_tr: "Proteção individual na manipulação de amostras de eDNA.",
    criterio_aceitabilidade: "Não serão aceitas luvas com pó.",
  },
};

const orcamentos = [
  { fornecedor_nome: "Loja A", valor_total: 648.5, escolhida: true, prazo_entrega_dias: null },
  { fornecedor_nome: "Loja B", valor_total: 700, escolhida: false, prazo_entrega_dias: 10 },
  { fornecedor_nome: "Loja C", valor_total: 751.5, escolhida: false, prazo_entrega_dias: 20 },
];

describe("documento para a fonte de pagamento (Ineo e Funpar)", () => {
  it("só conhece os dois modelos", () => {
    expect(modeloDocumento("solicitacao_compras")).toBe("solicitacao_compras");
    expect(modeloDocumento("termo_referencia")).toBe("termo_referencia");
    expect(modeloDocumento(null)).toBeNull();
    expect(modeloDocumento("outro")).toBeNull();
  });

  it("marca a rubrica pela natureza do pedido e pelo tipo dos itens", () => {
    expect([...rubricasMarcadas("material_consumo_lab", [luva])]).toEqual(["Material de Consumo"]);
    expect([...rubricasMarcadas("servico", [{ tipo: "material" }])]).toEqual(["Serviços de terceiros"]);
    expect(rubricasMarcadas("material_consumo_geral", [{ tipo: "equipamento" }]).has("Móveis e equipamentos")).toBe(true);
  });

  it("a especificação junta o item, a descrição detalhada e a marca de referência da planilha", () => {
    expect(especificacaoDoItem(luva)).toBe("Caixa de luva PP Latex Free — Luvas nitrilo tamanho PP, sem pó. Referência: Unigloves");
    expect(especificacaoDoItem({ id: 2, especificacao: "Etanol", quantidade: 1, volume: "1 L" })).toBe("Etanol (1 L)");
  });

  it("com um item, a Solicitação usa o orçamento escolhido e o Termo, a média dos três", () => {
    const solicitacao = linhasDoDocumento([luva], orcamentos, "escolhido");
    expect(solicitacao.total).toBe(648.5);
    expect(solicitacao.linhas[0]).toMatchObject({ numero: 1, unidade: "caixa", quantidade: 20, valorUnitario: 32.42, valorTotal: 648.5 });
    const termo = linhasDoDocumento([luva], orcamentos, "media");
    expect(termo.valorDoOrcamento).toBe(700);
    expect(termo.linhas[0]).toMatchObject({ valorUnitario: 35, valorTotal: 700 });
  });

  it("com vários itens, cada linha fica com o preço estimado e o total segue o orçamento", () => {
    const outro: ItemDoDocumento = { id: 3, especificacao: "Ponteira", quantidade: 2, unidade: "rack", orcamento_previo: 50 };
    const { linhas, total } = linhasDoDocumento([luva, outro], orcamentos, "escolhido");
    expect(linhas.map((l) => l.valorTotal)).toEqual([600, 100]);
    expect(total).toBe(648.5);
    // sem orçamento, o total é a soma das linhas
    expect(linhasDoDocumento([luva, outro], [], "media").total).toBe(700);
  });

  it("textos por item sem repetição; sem texto nos insumos, vale o do pedido", () => {
    expect(textosDosItens([luva, { ...luva, id: 9 }], "justificativa_tr", "do pedido")).toEqual([
      "Proteção individual na manipulação de amostras de eDNA.",
    ]);
    expect(textosDosItens([{ id: 4, especificacao: "x", quantidade: 1 }], "especificacoes_tr", "do pedido")).toEqual(["do pedido"]);
    expect(textosDosItens([{ id: 4, especificacao: "x", quantidade: 1 }], "especificacoes_tr")).toEqual([]);
  });

  it("sem o texto da planilha, o quantitativo sai dos itens", () => {
    const { linhas } = linhasDoDocumento([{ id: 5, especificacao: "Luva PP", quantidade: 20, unidade: "caixa" }], [], "media");
    expect(quantitativoDosItens(linhas)).toBe("O quantitativo total demandado é de 20 caixa de Luva PP.");
    expect(quantitativoDosItens([])).toBe("");
  });

  it("prazo do escolhido, senão o menor informado, senão 15 dias", () => {
    expect(prazoDeEntrega(orcamentos)).toBe(10);
    expect(prazoDeEntrega([{ ...orcamentos[0], prazo_entrega_dias: 7 }])).toBe(7);
    expect(prazoDeEntrega([])).toBe(15);
  });

  it("data por extenso no fuso de Brasília", () => {
    expect(dataPorExtenso(new Date("2026-11-28T02:00:00Z"))).toBe("Curitiba, 27 de novembro de 2026.");
  });
});
