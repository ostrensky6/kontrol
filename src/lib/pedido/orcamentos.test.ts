import { describe, expect, it } from "vitest";

import { motivoSemAprovacaoFinal, motivoSemCotacoesRecebidas, normalizarOrcamentos, resumirOrcamentos } from "./orcamentos";

const linha = (id: number, fornecedor: string, valor: number | string, escolhida = false) => ({
  id,
  fornecedor_id: null,
  fornecedor_nome: fornecedor,
  valor_total: valor,
  prazo_entrega_dias: 10,
  validade: null,
  condicoes: "",
  anexo_id: null,
  escolhida,
});

describe("três orçamentos (0171)", () => {
  it("normaliza a resposta do banco e ignora lixo", () => {
    const [o] = normalizarOrcamentos([linha(1, " Loja A ", "120.50"), null]);
    expect(o).toMatchObject({ id: 1, fornecedor_nome: "Loja A", valor_total: 120.5, condicoes: null, escolhida: false });
    expect(normalizarOrcamentos(null)).toEqual([]);
  });

  it("conta fornecedores diferentes e explica quantos faltam", () => {
    const dois = normalizarOrcamentos([linha(1, "Loja A", 100), linha(2, "loja a", 90), linha(3, "Loja B", 120)]);
    const resumo = resumirOrcamentos(dois);
    expect(resumo).toMatchObject({ fornecedores: 2, faltam: 1, menorValor: 90, escolhido: null });
    expect(motivoSemCotacoesRecebidas(resumo)).toBe("Toda compra precisa de 3 orçamentos de fornecedores diferentes. Falta 1.");
    expect(motivoSemCotacoesRecebidas(resumirOrcamentos([]))).toContain("Faltam 3.");
  });

  it("libera a aprovação final só com um escolhido e marca quando não é o menor", () => {
    const tres = normalizarOrcamentos([linha(1, "Loja A", 100), linha(2, "Loja B", 150), linha(3, "Loja C", 120)]);
    expect(motivoSemCotacoesRecebidas(resumirOrcamentos(tres))).toBeNull();
    expect(motivoSemAprovacaoFinal(resumirOrcamentos(tres))).toBe("Escolha um dos orçamentos antes de enviar para a aprovação final.");
    const comEscolha = normalizarOrcamentos([linha(1, "Loja A", 100), linha(2, "Loja B", 150, true), linha(3, "Loja C", 120)]);
    const resumo = resumirOrcamentos(comEscolha);
    expect(motivoSemAprovacaoFinal(resumo)).toBeNull();
    expect(resumo.escolhidoAcimaDoMenor).toBe(true);
  });
});
