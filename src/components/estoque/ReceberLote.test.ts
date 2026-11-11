import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const button = readFileSync(new URL("./ReceberLote.tsx", import.meta.url), "utf8");
const tables = readFileSync(new URL("./EstoqueTables.tsx", import.meta.url), "utf8");
const loteAcoes = readFileSync(new URL("./LoteAcoes.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/estoque/page.tsx", import.meta.url), "utf8");
const tabelaComum = readFileSync(new URL("../suprimentos/EstoqueDisponivelTable.tsx", import.meta.url), "utf8");

describe("entrada inicial de estoque", () => {
  it("permite abrir a mesma porta canonica de entrada por deep link do insumo", () => {
    expect(button).toMatch(/abertoInicial[\s\S]+useState\(abertoInicial\)/);
    expect(tables).toContain("entradaInicialInsumoId");
    expect(page).toMatch(/searchParams[\s\S]+entrada[\s\S]+entradaInicialInsumoId/);
    expect(button).toContain("entradaInventario");
  });

  it("mantem os saldos operacionais separados das unidades abertas e fechadas", () => {
    // D1 (revisão de 11/11): o saldo usa a mesma tabela da visão geral de Suprimentos
    expect(tables).toContain("<EstoqueDisponivelTable");
    expect(tabelaComum).toContain('header: "Disponível"');
    expect(tabelaComum).toContain('header: "Reservado"');
    // 0130: sem quarentena, a coluna saiu do saldo
    expect(tables).not.toContain('header: "Quarentena"');
    expect(tabelaComum).not.toContain('header: "Quarentena"');
    // explicação sob demanda ("?"), não mais texto fixo na tela
    expect(tables).toContain('<HelpTip title="Como ler o saldo">');
    expect(tables).toContain("<b>Disponível</b> é o que pode ser usado agora: os lotes guardados menos o que está reservado");
    expect(tables).not.toContain('header: "Saldo aceito (calculado)"');
  });

  it("orienta antes e depois da entrada sem prometer permissao", () => {
    expect(button).toContain("O lote entra disponível para uso assim que a chegada é registrada.");
    expect(button).toContain("Material comprado deve ter a chegada");
    expect(button).not.toContain("Falta aceitar o lote");
    expect(button).toContain('href="/estoque"');
    expect(button).toContain("Revisar no Estoque");
    expect(button).toContain('role="status"');
    expect(button).toContain('aria-live="polite"');
    expect(button).toMatch(/<button\s+type="button"[\s\S]+\{triggerLabel\}/);
    expect(button.match(/await entradaInventario\(/g)).toHaveLength(1);
    const successBranch = button.indexOf("{state.ok ? (");
    expect(successBranch).toBeGreaterThan(-1);
    expect(successBranch).toBeLessThan(button.indexOf("<form onSubmit={enviarSemReset(action)}"));
  });

  it("mantem Aceitar visivel somente sob a permissao existente", () => {
    expect(loteAcoes).toMatch(/status\s*===\s*"quarentena"\s*&&\s*\(/);
    expect(loteAcoes).toMatch(/podeAceitar[\s\S]+setModal\("aceitar"\)[\s\S]+Aceitar/);
    expect(loteAcoes).toContain("estornoDiretoPermitido");
  });
});
