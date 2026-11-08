import { describe, expect, it } from "vitest";
import { prazoRecebimentoObservado } from "./prazo-recebimento";

const inicio = "2026-10-01T12:00:00Z";
const fim = "2026-10-03T18:00:00Z";
const compra = { status: "recebido", criado_em: inicio };
const entrada = (id: number, quantidade: number, recebido_em = fim) => ({
  id, quantidade, recebido_em, estornado_em: null as string | null,
});
const item = {
  id: 10, quantidade: 0.3, quantidade_recebida: 0.3,
  quantidade_nao_atendida: null, destino_pendencia: null, compra_pendencia_id: null,
  pedidos_compra_item_recebimentos: [entrada(1, 0.2), entrada(2, 0.1, "2026-10-02T12:00:00Z")],
};
const consulta = { data: [item], count: 1, error: null, escopoComprovado: true };

describe("prazo observado de recebimento formal", () => {
  it("conta uma compra, usando o último lançamento válido de todos os itens", () => {
    const outroItem = { ...item, id: 11, quantidade: 1, quantidade_recebida: 1,
      pedidos_compra_item_recebimentos: [entrada(3, 1, "2026-10-02T18:00:00Z")] };
    expect(prazoRecebimentoObservado(compra, { ...consulta, data: [item, outroItem], count: 2 })).toEqual({
      estado: "observado", n: 1, duracaoMs: 54 * 60 * 60 * 1000,
      inicioEm: inicio, fimEm: fim,
      origem: "livro_formal_de_recebimentos", fonteFinanciadora: null,
    });
  });

  it.each(["enviado", "cancelado"])("não amostra compra %s", (status) => {
    expect(prazoRecebimentoObservado({ ...compra, status }, consulta)).toMatchObject({ estado: "fora_da_amostra", n: 0 });
  });

  it("não amostra encerramento com pendência mesmo com status recebido", () => {
    const data = [{ ...item, quantidade: 1, quantidade_nao_atendida: 0.7, destino_pendencia: "desistencia" }];
    expect(prazoRecebimentoObservado(compra, { ...consulta, data })).toMatchObject({ estado: "nao_demonstrado", motivo: "pendencia" });
  });

  it("desconsidera estorno no fim e exige saldo válido integral", () => {
    const estornado = { ...entrada(3, 0.2, "2026-10-04T12:00:00Z"), estornado_em: "2026-10-05T12:00:00Z" };
    const observar = (livro: typeof item.pedidos_compra_item_recebimentos) => prazoRecebimentoObservado(compra, {
      ...consulta, data: [{ ...item, pedidos_compra_item_recebimentos: livro }],
    });
    expect(observar([...item.pedidos_compra_item_recebimentos, estornado])).toMatchObject({ estado: "observado", fimEm: fim });
    expect(observar([item.pedidos_compra_item_recebimentos[1], estornado])).toMatchObject({ estado: "nao_demonstrado", n: 0 });
  });

  it.each([{ error: new Error("consulta falhou") }, { count: 2 }, { count: null }, { data: null }, { escopoComprovado: false }])(
    "não observa consulta incompleta: %j", (delta) => {
      expect(prazoRecebimentoObservado(compra, { ...consulta, ...delta })).toMatchObject({ estado: "indisponivel", n: 0 });
    },
  );

  it("não transforma ausência ou corte do livro em prazo zero", () => {
    for (const livro of [undefined, [], [entrada(1, 0.2)]]) {
      const data = [{ ...item, pedidos_compra_item_recebimentos: livro }];
      const resultado = prazoRecebimentoObservado(compra, { ...consulta, data });
      expect(resultado).toMatchObject({ estado: "nao_demonstrado", n: 0 });
      expect(resultado).not.toHaveProperty("duracaoMs");
    }
  });

  it.each([
    ["inválida", fim], [inicio, "inválida"], [inicio, "2026-09-30T12:00:00Z"],
    [inicio, "2026-11-31T12:00:00Z"],
    ["2026-10-01T12:00:00.000002Z", "2026-10-01T09:00:00.000001-03:00"],
  ])(
    "rejeita par de datas %s → %s inválido", (criado_em, recebido_em) => {
      const data = [{ ...item, pedidos_compra_item_recebimentos: [entrada(1, 0.3, recebido_em)] }];
      expect(prazoRecebimentoObservado({ ...compra, criado_em }, { ...consulta, data })).toMatchObject({
        estado: "nao_demonstrado", motivo: "data_invalida_ou_invertida", n: 0,
      });
    },
  );
});
