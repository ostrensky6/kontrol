import { describe, expect, it } from "vitest";
import { CADASTROS } from "./config";
import {
  menorValidadePorInsumo,
  modeloQuantidadePorInsumo,
  projetarQuantidadeInsumos,
  projetarTotaisInsumos,
  type LoteInsumo,
  type LoteModelo,
} from "./insumos";
import { workbookColumns } from "./xlsx";

const lote = (overrides: Partial<LoteInsumo> = {}): LoteInsumo => ({
  insumo_id: 1, status: "aceito", quantidade_atual: 2.5,
  validade: "2026-08-04", validade_apos_abertura: null, data_abertura: null, ...overrides,
});

describe("totais de unidades de insumos", () => {
  it("separa saldos fechados e abertos, incluindo fracoes", () => {
    const [insumo] = projetarTotaisInsumos([{ id: 1 }], [
      lote(), lote({ quantidade_atual: 1.25, data_abertura: "2026-08-01" }),
    ], "2026-08-04");
    expect(insumo).toMatchObject({ unidades_fechadas: 2.5, unidades_abertas: 1.25 });
  });

  it("mantem zero sem lote elegivel", () => {
    const [insumo] = projetarTotaisInsumos([{ id: 1 }], [lote({ status: "quarentena" })], "2026-08-04");
    expect(insumo).toMatchObject({ unidades_fechadas: 0, unidades_abertas: 0 });
  });

  it("exclui vencidos pela menor validade efetiva", () => {
    const [insumo] = projetarTotaisInsumos([{ id: 1 }], [
      lote({ validade: "2026-09-01", validade_apos_abertura: "2026-08-03" }),
      lote({ validade: "2026-08-03" }),
    ], "2026-08-04");
    expect(insumo).toMatchObject({ unidades_fechadas: 0, unidades_abertas: 0 });
  });

  it("expoe no XLSX uma unica coluna de quantidade logo apos Unidade, sem campos ocultos", () => {
    const [linha] = projetarQuantidadeInsumos(
      [
        {
          id: 1,
          especificacao: "Item",
          fabricante: "Marca",
          unidade: "un",
          tipo_insumo_id: 3,
          codigo_interno: "INT-1",
        },
      ],
      [lote({ quantidade_atual: 4 })],
      "2026-08-04",
    );
    const headers = workbookColumns(CADASTROS.insumos, [linha]).map((coluna) => coluna.header);

    expect(headers.slice(1, 5)).toEqual([
      "Item específico / SKU",
      "Marca / fabricante",
      "Unidade da embalagem",
      "Quantidade (embalagens fechadas)",
    ]);
    expect(headers.filter((header) => /calculado|unidades_(fechadas|abertas)/i.test(header))).toEqual([]);
    expect(headers).not.toContain("Tipo técnico");
    expect(headers).not.toContain("Código interno");
  });

  it("projeta a quantidade exibida (mesmo calculo da tela) sem expor unidades_*", () => {
    const [insumo] = projetarQuantidadeInsumos([{ id: 1 }], [
      lote({ quantidade_atual: 3 }),
      lote({ quantidade_atual: 1, data_abertura: "2026-08-01" }),
      lote({ status: "quarentena", quantidade_atual: 9 }),
    ], "2026-08-04");
    expect(insumo).toEqual({ id: 1, quantidade: 4 });
  });

  it("mostra uma unica coluna Quantidade, calculada e fora do formulario", () => {
    expect(CADASTROS.insumos.colunas.find((coluna) => coluna.key === "quantidade")).toMatchObject({
      label: "Quantidade",
      calculada: true,
    });
    expect(CADASTROS.insumos.colunas.some((coluna) => coluna.key === "unidades_fechadas")).toBe(false);
    expect(CADASTROS.insumos.colunas.some((coluna) => coluna.key === "unidades_abertas")).toBe(false);
    expect(CADASTROS.insumos.campos.map((campo) => campo.name)).not.toEqual(
      expect.arrayContaining(["quantidade", "unidades_fechadas", "unidades_abertas"]),
    );
  });
});

describe("modelo de quantidade por insumo", () => {
  const loteModelo = (overrides: Partial<LoteModelo> = {}): LoteModelo => ({
    insumo_id: 1,
    modelo_quantidade: "EMBALAGEM_FECHADA",
    quantidade_atual: 3,
    ...overrides,
  });

  it("classifica como embalagem fechada quando so ha lotes desse modelo com saldo", () => {
    const mapa = modeloQuantidadePorInsumo([loteModelo()]);
    expect(mapa.get("1")).toBe("EMBALAGEM_FECHADA");
  });

  it("ignora lotes com saldo zerado", () => {
    const mapa = modeloQuantidadePorInsumo([loteModelo({ quantidade_atual: 0 })]);
    expect(mapa.has("1")).toBe(false);
  });

  it("da prioridade ao legado quando o insumo mistura os dois modelos", () => {
    const mapa = modeloQuantidadePorInsumo([
      loteModelo({ modelo_quantidade: "LEGADO" }),
      loteModelo({ modelo_quantidade: "EMBALAGEM_FECHADA" }),
    ]);
    expect(mapa.get("1")).toBe("LEGADO");
  });

  it("trata modelo nulo/desconhecido como legado por seguranca", () => {
    const mapa = modeloQuantidadePorInsumo([loteModelo({ modelo_quantidade: null })]);
    expect(mapa.get("1")).toBe("LEGADO");
  });
});

describe("menorValidadePorInsumo", () => {
  it("usa o lote com saldo que vence primeiro, ignorando consumidos e descartados", () => {
    const mapa = menorValidadePorInsumo([
      { insumo_id: 1, status: "aceito", quantidade_atual: 2, validade: "2027-05-01", validade_apos_abertura: null },
      { insumo_id: 1, status: "em_uso", quantidade_atual: 1, validade: "2027-09-01", validade_apos_abertura: "2026-12-10" },
      { insumo_id: 1, status: "descartado", quantidade_atual: 3, validade: "2026-01-01", validade_apos_abertura: null },
      { insumo_id: 1, status: "aceito", quantidade_atual: 0, validade: "2026-02-01", validade_apos_abertura: null },
      { insumo_id: 2, status: "quarentena", quantidade_atual: 5, validade: "2028-01-31", validade_apos_abertura: null },
      { insumo_id: 3, status: "aceito", quantidade_atual: 5, validade: null, validade_apos_abertura: null },
    ]);
    expect(mapa.get("1")).toBe("2026-12-10");
    expect(mapa.get("2")).toBe("2028-01-31");
    expect(mapa.has("3")).toBe(false);
  });
});
