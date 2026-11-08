import { describe, expect, it } from "vitest";
import { amostrasPrazo, caminhoCompra, confianca, percentil, resumirPrazos, type PedidoPrazoRow } from "./prazos-compra";

const item = (recebido_em: string | null, especificacao = "Kit X", categoria_compra: string | null = "Reagentes") => ({
  insumo_id: 1, recebido_em, insumos: { especificacao, categoria_compra },
});
const pedido = (id: number, extra: Partial<PedidoPrazoRow>): PedidoPrazoRow => ({
  id, criado_em: "2026-01-01T00:00:00Z", enviado_validacao_em: null, modalidade_compra: null, instituicao_destino: null,
  pedidos_internos_itens: [], ...extra,
});

describe("prazos de compra", () => {
  it("caminho: instituição vale sobre modalidade e Funpar é reconhecida", () => {
    expect(caminhoCompra({ modalidade_compra: "fundacao", instituicao_destino: "FUNPAR - UFPR" })).toBe("Funpar");
    expect(caminhoCompra({ modalidade_compra: "compra_direta", instituicao_destino: null })).toBe("ATGC (compra direta)");
    expect(caminhoCompra({ modalidade_compra: null, instituicao_destino: " " })).toBe("Caminho não informado");
  });

  it("conta do envio para validação até o recebimento; ignora item não recebido", () => {
    const a = amostrasPrazo([
      pedido(1, { enviado_validacao_em: "2026-01-11T00:00:00Z", pedidos_internos_itens: [item("2026-02-10T00:00:00Z"), item(null)] }),
      pedido(2, { pedidos_internos_itens: [item("2025-12-01T00:00:00Z")] }), // recebido antes do pedido: dado ruim
    ]);
    expect(a).toEqual([{ pedido_id: 1, caminho: "Caminho não informado", insumo_id: 1, insumo: "Kit X", categoria: "Reagentes", dias: 30 }]);
  });

  it("percentis e confiança", () => {
    expect(percentil([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentil([5], 0.9)).toBe(5);
    expect(confianca(2)).toBe("baixa");
    expect(confianca(3)).toBe("media");
    expect(confianca(10)).toBe("alta");
  });

  it("resume por caminho com prazo curto, intermediário e conservador", () => {
    const amostras = [10, 20, 30, 40, 100].map((dias, i) => ({ pedido_id: i, caminho: "Funpar", insumo_id: 1, insumo: "Kit", categoria: "R", dias }));
    const [r] = resumirPrazos(amostras, (a) => a.caminho);
    expect(r).toMatchObject({ chave: "Funpar", n: 5, curta: 30, intermediaria: 40, conservadora: 76, confianca: "media" });
  });
});
