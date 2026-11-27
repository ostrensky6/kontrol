import { NextResponse, type NextRequest } from "next/server";
import { createClientUntyped } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Relatório de 27/11/2026, bug 2: "Abrir arquivo" abria um link assinado
 * gerado quando a página do pedido foi montada, válido por uma hora. Depois
 * disso o Supabase respondia "InvalidJWT: exp claim timestamp check failed".
 * Agora o link é gerado no clique, por esta rota, e vale só o tempo de abrir.
 * A leitura do anexo passa pela permissão de quem clica (RLS).
 */
const VALIDADE_SEGUNDOS = 120;

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; anexoId: string }> },
) {
  const { id, anexoId } = await ctx.params;
  const pedidoId = Number(id);
  const anexoNumero = Number(anexoId);
  if (!Number.isInteger(pedidoId) || pedidoId <= 0 || !Number.isInteger(anexoNumero) || anexoNumero <= 0) {
    return textoSimples("Documento não encontrado.", 404);
  }

  const supabase = await createClientUntyped();
  const { data: anexo } = await supabase
    .from("pedidos_internos_anexos")
    .select("storage_bucket, storage_path, arquivo_nome")
    .eq("id", anexoNumero)
    .eq("pedido_interno_id", pedidoId)
    .maybeSingle();
  const linha = anexo as { storage_bucket: string | null; storage_path: string | null; arquivo_nome: string | null } | null;
  if (!linha?.storage_bucket || !linha.storage_path) {
    return textoSimples("Documento não encontrado, ou seu perfil não pode abri-lo.", 404);
  }

  const baixar = request.nextUrl.searchParams.get("baixar") === "1";
  const { data, error } = await supabase.storage
    .from(linha.storage_bucket)
    .createSignedUrl(linha.storage_path, VALIDADE_SEGUNDOS, baixar ? { download: linha.arquivo_nome ?? true } : undefined);
  if (error || !data?.signedUrl) {
    return textoSimples("Não foi possível abrir o arquivo agora. Volte ao pedido e tente de novo.", 502);
  }
  const destino = new URL(data.signedUrl, request.nextUrl.origin);
  const resposta = NextResponse.redirect(destino, 303);
  resposta.headers.set("Cache-Control", "no-store");
  return resposta;
}

function textoSimples(mensagem: string, status: number) {
  return new Response(mensagem, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
