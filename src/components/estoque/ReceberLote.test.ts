import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const button = readFileSync(new URL("./ReceberLote.tsx", import.meta.url), "utf8");
const tables = readFileSync(new URL("./EstoqueTables.tsx", import.meta.url), "utf8");
const loteAcoes = readFileSync(new URL("./LoteAcoes.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/estoque/page.tsx", import.meta.url), "utf8");

describe("entrada inicial de estoque", () => {
  it("permite abrir a mesma porta canonica de entrada por deep link do insumo", () => {
    expect(button).toMatch(/abertoInicial[\s\S]+useState\(abertoInicial\)/);
    expect(tables).toContain("entradaInicialInsumoId");
    expect(page).toMatch(/searchParams[\s\S]+entrada[\s\S]+entradaInicialInsumoId/);
    expect(button).toContain("entradaInventario");
  });

  it("mantem os saldos operacionais separados das unidades abertas e fechadas", () => {
    expect(tables).toContain('header: "Em mãos"');
    expect(tables).toContain('header: "Quarentena"');
    // explicação sob demanda ("?"), não mais texto fixo na tela
    expect(tables).toContain('<HelpTip title="Como ler o saldo">');
    expect(tables).toContain("<b>Em mãos</b> soma os lotes liberados");
    expect(tables).not.toContain('header: "Saldo aceito (calculado)"');
  });

  it("orienta antes e depois da entrada sem prometer permissao", () => {
    expect(button).toContain("O lote entra em quarentena e só fica disponível depois de aceito.");
    expect(button).toContain("Material comprado deve ser recebido");
    expect(button).toContain("Falta aceitar o lote para liberar o uso.");
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
