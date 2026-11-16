import type { NextRequest } from "next/server";
import { CADASTROS } from "@/lib/cadastros/config";
import { buildCadastrosWorkbook, safeFileName } from "@/lib/cadastros/xlsx";
import { hojeIso } from "@/lib/formatters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const cfg = CADASTROS[slug];
  if (!cfg) return new Response("Cadastro não encontrado.", { status: 404 });

  try {
    const workbook = await buildCadastrosWorkbook(slug);
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `${safeFileName(cfg.titulo)}-${hojeIso()}.xlsx`;

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao exportar cadastro.";
    return new Response(message, { status: 500 });
  }
}
