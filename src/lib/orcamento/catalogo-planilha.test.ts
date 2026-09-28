import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  ABAS_CATALOGO,
  lerPlanilhaCatalogo,
  lerPreviaImportacao,
  mensagemImportacao,
  montarPlanilhaCatalogo,
  payloadImportacao,
  resumirImportacao,
} from "./catalogo-planilha";

async function idaEVolta(workbook: ExcelJS.Workbook) {
  const buffer = await workbook.xlsx.writeBuffer();
  const lido = new ExcelJS.Workbook();
  await lido.xlsx.load(buffer as ArrayBuffer);
  return lido;
}

describe("planilha do catálogo de custos de projeto", () => {
  it("exporta uma aba por rubrica, só itens vigentes, com PE mascarado sem permissão", async () => {
    const workbook = await idaEVolta(
      montarPlanilhaCatalogo([
        { id: "MC-6", rubrica: "MC", descricao: "Papel toalha", unidade: "fardo", categoria: "Limpeza", preco_unitario: 60, valor_atualizado_em: "2026-09-01T10:00:00Z" },
        { id: "MC-7", rubrica: "MC", descricao: "Arquivado", unidade: null, categoria: null, preco_unitario: 1, ativo: false },
        { id: "MC-8", rubrica: "MC", descricao: "Unificado", unidade: null, categoria: null, preco_unitario: 1, substituido_por: "MC-6" },
        { id: "PE-1", rubrica: "PE", descricao: "Bolsista", unidade: "mês", categoria: null, preco_unitario: null, preco_mascarado: true },
      ]),
    );
    expect(workbook.worksheets.map((s) => s.name)).toEqual(["Instruções", ...Object.values(ABAS_CATALOGO)]);
    const mc = workbook.getWorksheet(ABAS_CATALOGO.MC)!;
    expect(mc.rowCount).toBe(2);
    expect(mc.getRow(2).getCell(2).value).toBe("Papel toalha");
    expect(mc.getRow(2).getCell(4).value).toBe(60);
    expect(workbook.getWorksheet(ABAS_CATALOGO.PE)!.getRow(2).getCell(4).value).toBe("XXX");
  });

  it("lê de volta o que exportou; XXX fica de fora e linhas vazias são puladas", async () => {
    const workbook = await idaEVolta(
      montarPlanilhaCatalogo([
        { id: "MC-6", rubrica: "MC", descricao: "Papel toalha", unidade: "fardo", categoria: "Limpeza", preco_unitario: 60 },
        { id: "PE-1", rubrica: "PE", descricao: "Bolsista", unidade: "mês", categoria: null, preco_unitario: null, preco_mascarado: true },
      ]),
    );
    workbook.getWorksheet(ABAS_CATALOGO.MC)!.addRow([]);
    workbook.getWorksheet(ABAS_CATALOGO.MC)!.addRow([null, "Luva nitrílica", "caixa", "45,90", "EPI"]);
    const leitura = lerPlanilhaCatalogo(workbook);
    expect(leitura.abas).toHaveLength(6);
    expect(leitura.linhas).toEqual([
      { origem: "MC - Material de consumo, linha 2", rubrica: "MC", descricao: "Papel toalha", unidade: "fardo", preco: 60, categoria: "Limpeza" },
      { origem: "MC - Material de consumo, linha 4", rubrica: "MC", descricao: "Luva nitrílica", unidade: "caixa", preco: 45.9, categoria: "EPI" },
    ]);
    expect(leitura.ignoradas[0]).toContain("PE - Pessoal, linha 2");
  });

  it("aceita aba com coluna Rubrica e cabeçalhos alternativos; ignora abas sem descrição", () => {
    const workbook = new ExcelJS.Workbook();
    const aba = workbook.addWorksheet("Minha lista");
    aba.addRow(["Rubrica", "Descrição", "Unid", "Preço unitário", "Categoria"]);
    aba.addRow(["st", "Frete", "viagem", "R$ 1.234,50", null]);
    aba.addRow(["VD", "Diária", "dia", "abc", null]);
    workbook.addWorksheet("Resumo").addRow(["Total", 10]);
    const leitura = lerPlanilhaCatalogo(workbook);
    expect(leitura.abas).toEqual(["Minha lista"]);
    expect(leitura.linhas.map((l) => [l.rubrica, l.descricao, l.unidade, l.preco])).toEqual([
      ["ST", "Frete", "viagem", 1234.5],
      ["VD", "Diária", "dia", null],
    ]);
    expect(payloadImportacao(leitura.linhas)[0]).toEqual({ rubrica: "ST", descricao: "Frete", unidade: "viagem", preco: 1234.5, categoria: null });
  });

  it("junta a prévia da RPC com a origem e resume em frase", () => {
    const linhas = [
      { origem: "MC, linha 2", rubrica: "MC", descricao: "A", unidade: null, preco: 1, categoria: null },
      { origem: "MC, linha 3", rubrica: "MC", descricao: "B", unidade: null, preco: 2, categoria: null },
      { origem: "MC, linha 4", rubrica: "MC", descricao: "C", unidade: null, preco: null, categoria: null },
    ];
    const previa = lerPreviaImportacao(linhas, [
      { linha: 1, rubrica: "MC", descricao: "A", unidade: null, preco: 1, acao: "novo", catalogo_item_id: null, preco_atual: null, mensagem: null },
      { linha: 2, rubrica: "MC", descricao: "B", unidade: null, preco: 2, acao: "atualizar", catalogo_item_id: "MC-2", preco_atual: 1.5, mensagem: null },
      { linha: 3, rubrica: "MC", descricao: "C", unidade: null, preco: null, acao: "erro", catalogo_item_id: null, preco_atual: null, mensagem: "Valor ausente ou negativo." },
    ]);
    expect(previa.map((l) => [l.origem, l.acao])).toEqual([
      ["MC, linha 2", "novo"],
      ["MC, linha 3", "atualizar"],
      ["MC, linha 4", "erro"],
    ]);
    const resumo = resumirImportacao(previa);
    expect(resumo).toMatchObject({ novo: 1, atualizar: 1, erro: 1, igual: 0 });
    expect(mensagemImportacao(resumo, false)).toBe(
      "Prévia: 1 item novo, 1 valor a atualizar, 0 sem mudança, 1 linha fica de fora. Nada foi gravado ainda.",
    );
    expect(mensagemImportacao(resumo, true)).toBe(
      "Planilha importada: 1 item novo criado, 1 valor atualizado, 0 sem mudança, 1 linha fica de fora.",
    );
    expect(mensagemImportacao(resumirImportacao([{ acao: "igual" }]), false)).toBe("Prévia: nada a gravar (0 itens novos, 0 valores a atualizar, 1 sem mudança).");
  });
});
