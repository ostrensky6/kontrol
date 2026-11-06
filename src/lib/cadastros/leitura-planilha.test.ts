import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { carregarPlanilha, lerValoresXlsx } from "./leitura-planilha";

async function xlsxComDesenhoQuebrado() {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Instruções").addRow(["texto"]);
  const ws = wb.addWorksheet("Planilha1");
  ws.addRow(["Lista do laboratório"]);
  ws.addRow([]);
  ws.addRow(["Insumo", "Unidade da embalagem", "Valor da embalagem (R$)", "Quantidade na embalagem", "Ativo"]);
  ws.addRow(["Etanol & <absoluto>", "frasco", 120.5, 1, true]);
  ws.getCell("A5").value = { richText: [{ text: "Kit " }, { text: "PCR", font: { bold: true } }] };
  ws.getCell("C5").value = { formula: "2*10", result: 20 };
  const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
  const caminho = "xl/worksheets/sheet2.xml";
  const sheet = await zip.file(caminho)!.async("string");
  // Referência a um desenho que não existe: o ExcelJS quebra ao abrir.
  zip.file(caminho, sheet.replace("</worksheet>", '<drawing r:id="rId99"/></worksheet>'));
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("carregarPlanilha", () => {
  it("usa o ExcelJS quando ele abre o arquivo", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Insumos").addRow(["Item específico / SKU"]);
    const resultado = await carregarPlanilha((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    expect(resultado.leitor).toBe("exceljs");
  });

  it("cai no leitor de valores quando o ExcelJS recusa o arquivo", async () => {
    const conteudo = await xlsxComDesenhoQuebrado();
    await expect(new ExcelJS.Workbook().xlsx.load(conteudo)).rejects.toThrow();

    const resultado = await carregarPlanilha(conteudo);
    expect(resultado.leitor).toBe("reserva");
    expect(resultado.falhaPrincipal).toBeTruthy();
    const aba = resultado.workbook.getWorksheet("Planilha1")!;
    expect(resultado.workbook.worksheets.map((w) => w.name)).toEqual(["Instruções", "Planilha1"]);
    expect(aba.getCell("A3").value).toBe("Insumo");
    expect(aba.getCell("A4").value).toBe("Etanol & <absoluto>");
    expect(aba.getCell("C4").value).toBe(120.5);
    expect(aba.getCell("E4").value).toBe(true);
    expect(aba.getCell("A5").value).toBe("Kit PCR");
    expect(aba.getCell("C5").value).toBe(20);
  });

  it("recusa o que não é planilha com uma mensagem", async () => {
    const zip = new JSZip();
    zip.file("qualquer.txt", "oi");
    await expect(lerValoresXlsx(await zip.generateAsync({ type: "arraybuffer" }))).rejects.toThrow(/workbook/);
  });
});
