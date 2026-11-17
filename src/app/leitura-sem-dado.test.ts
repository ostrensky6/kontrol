import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// KAT-01 (auditoria integrada de 16/11): leitura que falha não pode virar zero nem fila vazia.
const inicio = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const recebimento = readFileSync(new URL("./recebimento/page.tsx", import.meta.url), "utf8");

describe("Início: previsão e indicadores que não respondem", () => {
  it("guarda o erro da previsão e do dashboard", () => {
    expect(inicio).toContain("{ data: previsaoRaw, error: erroPrevisao }");
    expect(inicio).toContain("{ data: dashboardRaw, error: erroDashboard }");
  });

  it("mostra 'sem dado' em Repor e Propostas e some com os gráficos", () => {
    expect(inicio).toContain('value: erroPrevisao ? "sem dado" : comprarAgora.length');
    expect(inicio).toContain('value: erroDashboard ? "sem dado" : enviados');
    expect(inicio).toMatch(/const gastos =\s+erroDashboard\s+\? null/);
    expect(inicio).toContain("const funil = verOrcamentos && !erroDashboard");
    expect(inicio).toContain("Indicadores: sem dado.");
    expect(inicio).toContain("A leitura da previsão de compra não respondeu");
  });
});

describe("Recebimento: fila que não responde", () => {
  it("não mostra fila vazia nem conta zero quando a leitura falha", () => {
    expect(recebimento).toContain("{ data: itensData, error: erroItens }");
    expect(recebimento).toContain("{ data: comprasData, error: erroCompras }");
    // a fila é uma só (chegada única): faltando as compras, a tela diz antes da tabela
    expect(recebimento).toMatch(/erroCompras && !erroItens \? \([\s\S]*Compras sem pedido: sem dado[\s\S]*<RecebimentoItensTable/);
    expect(recebimento).toMatch(/erroItens \? \([\s\S]*Pedidos: sem dado[\s\S]*<RecebimentoItensTable/);
    expect(recebimento).toContain("const semDado = Boolean(erroItens || erroCompras);");
    expect(recebimento).toContain('semDado ? "sem dado" : rows.length');
    expect(recebimento).toContain('semDado ? "sem dado" : prontos');
  });
});
