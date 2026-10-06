import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MateriaisEditTable.tsx", import.meta.url), "utf8");

describe("MateriaisEditTable: insumo inativo ja vinculado", () => {
  it("preserva o id atual como unica opcao inativa quando ele saiu do catalogo ativo", () => {
    expect(source).toContain(
      "const atualAusente = value != null && !options.some((option) => option.id === value);",
    );
    expect(source).toContain(
      "{atualAusente && <option value={value}>{label} (inativo)</option>}",
    );
  });

  it("nao recoloca inativos no formulario de novo material", () => {
    const adicionar = source.slice(source.indexOf("function AdicionarMaterialForm"));

    expect(adicionar).toContain("{insumos.map((insumo) => (");
    expect(adicionar).not.toContain("atualAusente");
    expect(adicionar).not.toContain("(inativo)");
  });
});
