import { buildCadastrosWorkbook, safeFileName } from "@/lib/cadastros/xlsx";
import { hojeIso } from "@/lib/formatters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const workbook = await buildCadastrosWorkbook();
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `${safeFileName("todos-os-cadastros")}-${hojeIso()}.xlsx`;

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao exportar cadastros.";
    return new Response(message, { status: 500 });
  }
}
