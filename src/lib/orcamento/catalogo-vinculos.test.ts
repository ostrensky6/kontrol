import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  avisoSemCusto,
  avisoValorAlterado,
  cadastroDaRubrica,
  descreverVinculo,
  lerVinculo,
  mapaVinculos,
  mensagemVinculo,
  palavrasDoNome,
  seloCadastro,
  sugerirCadastro,
  type VinculoCatalogo,
} from "./catalogo-vinculos";

function formulario(campos: Record<string, string>) {
  const formData = new FormData();
  for (const [chave, valor] of Object.entries(campos)) formData.set(chave, valor);
  return formData;
}

const insumo: VinculoCatalogo = {
  catalogo_item_id: "MC-30",
  insumo_id: 7,
  insumo_nome: "Luva nitrílica M",
  insumo_unidade: "cx",
  tecnico_id: null,
  tecnico_nome: null,
  vinculo_base: "embalagem",
  cadastro_sem_custo: false,
  vinculo_em: "2026-11-11T20:00:00Z",
};

const tecnico: VinculoCatalogo = {
  ...insumo,
  catalogo_item_id: "PE-3",
  insumo_id: null,
  insumo_nome: null,
  insumo_unidade: null,
  tecnico_id: 2,
  tecnico_nome: "Paula",
  vinculo_base: "mes",
  cadastro_sem_custo: null,
};

describe("catálogo ligado aos cadastros (0179)", () => {
  it("só MC tem par em Insumos e só PE em Técnicos", () => {
    expect(cadastroDaRubrica("MC")).toBe("insumo");
    expect(cadastroDaRubrica("PE")).toBe("tecnico");
    for (const rubrica of ["MP", "ST", "VD", "OU", null]) expect(cadastroDaRubrica(rubrica)).toBeNull();
  });

  it("lê os vínculos do banco e ignora linhas sem cadastro", () => {
    const mapa = mapaVinculos([
      { ...insumo, insumo_id: "7" },
      tecnico,
      { catalogo_item_id: "MC-1", insumo_id: null, tecnico_id: null },
      { catalogo_item_id: "", insumo_id: 3 },
      null,
    ]);
    expect([...mapa.keys()]).toEqual(["MC-30", "PE-3"]);
    expect(mapa.get("MC-30")?.insumo_id).toBe(7);
    expect(mapa.get("PE-3")?.cadastro_sem_custo).toBeNull();
    expect(mapaVinculos(null).size).toBe(0);
  });

  it("selo, descrição e avisos dizem de onde vem o valor, sem valor nenhum", () => {
    expect(seloCadastro(insumo)).toBe("Do cadastro de Insumos");
    expect(seloCadastro(tecnico)).toBe("Do cadastro de Técnicos");
    expect(seloCadastro(undefined)).toBeNull();
    expect(descreverVinculo(insumo)).toBe("Insumo Luva nitrílica M · por embalagem");
    expect(descreverVinculo(tecnico)).toBe("Técnico Paula · por mês");
    expect(avisoSemCusto(insumo)).toBeNull();
    expect(avisoSemCusto({ ...insumo, cadastro_sem_custo: true })).toBe("Insumo sem custo no cadastro: vale o valor do catálogo.");
    // pessoal sem permissão: o banco não diz se há valor, a tela não avisa nada
    expect(avisoSemCusto(tecnico)).toBeNull();
    expect(avisoValorAlterado(insumo)).toContain("vale só para este orçamento");
    expect(avisoValorAlterado(insumo)).toContain("cadastro de Insumos");
    expect(avisoValorAlterado(null)).toContain("atualiza o catálogo");
  });

  it("sugere pelo nome, sem acento, plural nem maiúscula", () => {
    const candidatos = [
      { id: 1, nome: "Luva nitrílica M" },
      { id: 2, nome: "Papel toalha" },
      { id: 3, nome: "Microtubos 1,5 mL" },
      { id: 4, nome: "Luva de látex" },
    ];
    expect(palavrasDoNome("Luvas NITRÍLICAS (caixa)")).toEqual(["luva", "nitrilica", "caixa"]);
    expect(sugerirCadastro("Luvas nitrílicas cx", candidatos).map((c) => c.id)).toEqual([1, 4]);
    expect(sugerirCadastro("Microtubo", candidatos).map((c) => c.id)).toEqual([3]);
    expect(sugerirCadastro("Reagentes diversos", candidatos)).toEqual([]);
    expect(sugerirCadastro("Luva", candidatos, 1)).toHaveLength(1);
  });

  it("lê o formulário de ligar e de desfazer", () => {
    expect(lerVinculo(formulario({ id: "MC-30", cadastro: "insumo:7", base: "embalagem" }))).toEqual({
      ok: true,
      vinculo: { id: "MC-30", insumoId: 7, tecnicoId: null, base: "embalagem" },
    });
    expect(lerVinculo(formulario({ id: "PE-3", cadastro: "tecnico:2", base: "hora" }))).toEqual({
      ok: true,
      vinculo: { id: "PE-3", insumoId: null, tecnicoId: 2, base: "hora" },
    });
    expect(lerVinculo(formulario({ id: "MC-30", acao: "desfazer" }))).toEqual({
      ok: true,
      vinculo: { id: "MC-30", insumoId: null, tecnicoId: null, base: null },
    });
    expect(lerVinculo(formulario({ cadastro: "insumo:7", base: "embalagem" })).ok).toBe(false);
    expect(lerVinculo(formulario({ id: "MC-30", base: "embalagem" }))).toEqual({ ok: false, message: "Escolha o insumo ou o técnico." });
    expect(lerVinculo(formulario({ id: "MC-30", cadastro: "insumo:7", base: "mes" }))).toEqual({
      ok: false,
      message: "Diga se o valor é por embalagem ou por unidade.",
    });
    expect(lerVinculo(formulario({ id: "PE-3", cadastro: "tecnico:2", base: "unidade" })).ok).toBe(false);
    expect(lerVinculo(formulario({ id: "MC-30", cadastro: "insumo:abc", base: "unidade" })).ok).toBe(false);
  });

  it("o aviso conta o que aconteceu com o valor", () => {
    const ligar = { id: "MC-30", insumoId: 7, tecnicoId: null, base: "embalagem" as const };
    expect(mensagemVinculo({ ligado: true, aplicado: true, sem_custo: false }, ligar)).toContain("passou a ser o do cadastro");
    expect(mensagemVinculo({ ligado: true, aplicado: false, sem_custo: true }, ligar)).toContain("mantém o valor atual");
    expect(mensagemVinculo({ ligado: true, aplicado: false, sem_custo: false }, ligar)).toContain("já era o do cadastro");
    expect(mensagemVinculo({ ligado: false }, { id: "MC-30", insumoId: null, tecnicoId: null, base: null })).toContain(
      "vínculo desfeito",
    );
  });

  it("a migration mantém as regras combinadas com Antonio", () => {
    const sql = readFileSync("supabase/migrations/0179_catalogo_vinculo_cadastros.sql", "utf8");
    // cadastro sem custo não substitui o catálogo
    expect(sql).toMatch(/v_valor is null or v_valor <= 0/);
    // item ligado não aprende o valor digitado (nunca "atualizar")
    expect(sql).toMatch(/item ligado ao cadastro: o valor digitado vale só nesta proposta/);
    // pessoal só com "Ver salário dos técnicos"
    expect(sql).toMatch(/exige a permissão "Ver salário dos técnicos"/);
    // aditiva: nada de apagar tabela, coluna, RLS ou auditoria
    expect(sql).not.toMatch(/drop table|truncate|drop column|disable row level security|drop trigger if exists aud_/i);
  });
});
