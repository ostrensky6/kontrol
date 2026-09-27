import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockSupabaseClient,
  getMockSupabaseStore,
  resetMockSupabaseStore,
  type SessaoMock,
} from "@/lib/testing/mock-supabase";

const sessao: SessaoMock = {};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClientUntyped: vi.fn(async () => createMockSupabaseClient(sessao)),
  createClient: vi.fn(async () => createMockSupabaseClient(sessao)),
}));

function tecnicoNoBanco() {
  return getMockSupabaseStore().tecnicos.find((t) => t.id === 1)!;
}

function formTecnico(campos: Record<string, string>) {
  const formData = new FormData();
  formData.set("_slug", "tecnicos");
  for (const [k, v] of Object.entries(campos)) formData.set(k, v);
  return formData;
}

async function exportarTecnicos() {
  const { buildCadastrosWorkbook } = await import("@/lib/cadastros/xlsx");
  const workbook = await buildCadastrosWorkbook("tecnicos");
  const sheet = workbook.getWorksheet("Técnicos")!;
  const headers = (sheet.getRow(1).values as unknown[]).map((v) => String(v ?? ""));
  const colSalario = headers.indexOf("Valor mensal (R$)");
  return { workbook, sheet, colSalario };
}

async function importar(workbook: ExcelJS.Workbook) {
  const { importarCadastrosWorkbook } = await import("./cadastros");
  const buffer = await workbook.xlsx.writeBuffer();
  const formData = new FormData();
  formData.set("arquivo", new File([buffer], "cadastros.xlsx"));
  const resultado = await importarCadastrosWorkbook({ ok: false }, formData);
  return resultado.resumo?.find((r) => r.aba === "Técnicos");
}

describe("salário dos técnicos nas ações de cadastro", () => {
  beforeEach(() => {
    resetMockSupabaseStore();
    getMockSupabaseStore().tecnicos = [
      { id: 1, nome: "Ana", processo: "Laboratório", valor_mes: 8000, horas_mes_base: 160, percentual_dedicado: 50, ativo: true },
    ];
  });
  afterEach(() => {
    delete sessao.papel;
  });

  it("sem permissão, salvar preserva o salário mesmo se o valor for forjado no form", async () => {
    sessao.papel = "coordenador";
    const { salvarRegistro } = await import("./cadastros");
    const r = await salvarRegistro(
      { ok: false },
      formTecnico({ _id: "1", nome: "Ana Paula", horas_mes_base: "160", percentual_dedicado: "40", valor_mes: "1" }),
    );
    expect(r).toMatchObject({ ok: true });
    expect(tecnicoNoBanco()).toMatchObject({ nome: "Ana Paula", percentual_dedicado: 40, valor_mes: 8000 });
  });

  it("sem permissão, cria técnico sem enviar salário (banco usa o padrão 0)", async () => {
    sessao.papel = "coordenador";
    const { salvarRegistro } = await import("./cadastros");
    const r = await salvarRegistro(
      { ok: false },
      formTecnico({ nome: "Novo", horas_mes_base: "170", percentual_dedicado: "0" }),
    );
    expect(r).toMatchObject({ ok: true });
    const novo = getMockSupabaseStore().tecnicos.find((t) => t.nome === "Novo");
    expect(novo).toBeDefined();
    expect(novo).not.toHaveProperty("valor_mes");
  });

  it("com permissão (admin), altera o salário", async () => {
    const { salvarRegistro } = await import("./cadastros");
    const r = await salvarRegistro(
      { ok: false },
      formTecnico({ _id: "1", nome: "Ana", horas_mes_base: "160", percentual_dedicado: "50", valor_mes: "9000" }),
    );
    expect(r).toMatchObject({ ok: true });
    expect(tecnicoNoBanco().valor_mes).toBe(9000);
  });

  it("exporta XXX sem permissão e a reimportação mantém o salário", async () => {
    sessao.papel = "gestor";
    const { workbook, sheet, colSalario } = await exportarTecnicos();
    expect(colSalario).toBeGreaterThan(0);
    expect(sheet.getRow(2).getCell(colSalario).value).toBe("XXX");
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    expect(buffer.includes(Buffer.from("8000"))).toBe(false);

    sheet.getRow(2).getCell(colSalario).value = 1; // tentativa de alterar sem permissão
    const resumo = await importar(workbook);
    expect(resumo).toMatchObject({ atualizados: 0, inalterados: 1, erros: [] });
    expect(tecnicoNoBanco().valor_mes).toBe(8000);
  });

  it("com permissão, exporta o valor real; XXX na planilha mantém e número altera", async () => {
    const { workbook, sheet, colSalario } = await exportarTecnicos();
    expect(sheet.getRow(2).getCell(colSalario).value).toBe(8000);

    sheet.getRow(2).getCell(colSalario).value = "XXX";
    expect(await importar(workbook)).toMatchObject({ atualizados: 0, inalterados: 1, erros: [] });
    expect(tecnicoNoBanco().valor_mes).toBe(8000);

    sheet.getRow(2).getCell(colSalario).value = 8500;
    expect(await importar(workbook)).toMatchObject({ atualizados: 1, erros: [] });
    expect(tecnicoNoBanco().valor_mes).toBe(8500);
  });
});
