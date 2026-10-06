import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const analiseSource = readFileSync(
  new URL("../analises/[codigo]/page.tsx", import.meta.url),
  "utf8",
);
const cadastroSource = readFileSync(new URL("./[slug]/page.tsx", import.meta.url), "utf8");
const crudSource = readFileSync(
  new URL("../../components/cadastros/CrudShell.tsx", import.meta.url),
  "utf8",
);

describe("selecoes novas respeitam o ciclo de vida dos insumos", () => {
  it("oferece somente insumos ativos no catalogo de uma analise", () => {
    expect(analiseSource).toMatch(
      /\.from\("insumos"\)\s*\.select\("id, especificacao, nome_item, unidade"\)\s*\.eq\("ativo", true\)\s*\.order\("especificacao"\)/,
    );
  });

  it("preserva os joins historicos de materiais ja vinculados", () => {
    expect(analiseSource).toMatch(
      /\.from\("insumo_analise"\)[\s\S]*insumos\(especificacao, nome_item, unidade, custo_unitario,[\s\S]*\.eq\("codigo_analise", codigo\)/,
    );
  });

  it("marca insumos inativos e mantem disponivel apenas o valor atual", () => {
    expect(cadastroSource).toContain(
      'const FONTES_COM_ATIVO = new Set(["fornecedores", "clientes", "tipo_insumos", "insumos"]);',
    );
    expect(cadastroSource).toContain(
      "...(comAtivo && r.ativo === false ? { inativo: true } : {}),",
    );
    expect(crudSource).toContain(
      "const opcoes = (campo.opcoes ?? []).filter((o) => !o.inativo || String(o.value) === v);",
    );
  });
});
