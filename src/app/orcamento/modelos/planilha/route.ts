import { safeFileName } from "@/lib/cadastros/xlsx";
import { temPermissao } from "@/lib/auth/permissao-efetiva";
import { montarPlanilhaCatalogo, type ItemCatalogoExportacao } from "@/lib/orcamento/catalogo-planilha";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Planilha do catálogo de custos de projeto (Fase E) para editar e importar de volta.
 * O valor de pessoal já vem mascarado da RPC para quem não tem a permissão de pessoal (0137).
 */
export async function GET() {
  if (!(await temPermissao("orcamentos.visualizar"))) {
    return new Response("Sem permissão para ver o catálogo.", { status: 403 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("orcamento_projeto_catalogo_listar");
  if (error) return new Response("Não foi possível ler o catálogo.", { status: 500 });

  const workbook = montarPlanilhaCatalogo((data ?? []) as ItemCatalogoExportacao[]);
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${safeFileName("catalogo-custos-projeto")}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
