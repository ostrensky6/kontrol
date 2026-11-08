import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/alternativas", () => ({ validarAlternativaInsumo: vi.fn() }));
vi.mock("@/components/common/SubmitButton", () => ({ SubmitButton: ({ children }: { children: string }) => createElement("button", null, children) }));
vi.mock("@/components/common/MensagemAcao", () => ({ MensagemAcao: () => null }));

import { AlternativasValidacao, type AlternativaLinha } from "./AlternativasValidacao";

const linhas: AlternativaLinha[] = [
  { id: 1, grupo_escolha: "kit", especificacao_insumo: "Kit A", custo_por_amostra: 9, alternativa_situacao: "invalida", alternativa_observacao: "Não amplifica", alternativa_validada_em: "2026-11-08T12:00:00Z" },
  { id: 2, grupo_escolha: "kit", especificacao_insumo: "Kit B", custo_por_amostra: 5, alternativa_situacao: null, alternativa_observacao: null, alternativa_validada_em: null },
];

describe("AlternativasValidacao", () => {
  it("mostra situação, a alternativa orçada e o formulário para quem pode", () => {
    const html = renderToStaticMarkup(createElement(AlternativasValidacao, { codigo: "PCR", linhas, orcadas: [2], podeValidar: true }));
    expect(html).toContain("Grupo kit");
    expect(html).toContain("Não serve (fora do orçamento)");
    expect(html).toContain("Ainda não avaliada");
    expect(html.match(/Entra no orçamento/g)).toHaveLength(1);
    expect(html).toContain("Não amplifica");
    expect(html).toContain('name="decisao"');
  });

  it("sem permissão só consulta; sem alternativas não mostra nada", () => {
    const html = renderToStaticMarkup(createElement(AlternativasValidacao, { codigo: "PCR", linhas, orcadas: [2], podeValidar: false }));
    expect(html).not.toContain('name="decisao"');
    expect(renderToStaticMarkup(createElement(AlternativasValidacao, { codigo: "PCR", linhas: [], orcadas: [], podeValidar: true }))).toBe("");
  });
});
