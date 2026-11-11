import { carregarAvisosDoSino } from "@/lib/pendencias/carregar";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Dados do sino (Aguardando você e avisos não lidos) para a pessoa logada.
 * A barra do topo relê este endereço a cada troca de tela, porque o layout
 * não é refeito na navegação.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ erro: "sem sessão" }, { status: 401, headers: { "cache-control": "no-store" } });
  return Response.json(await carregarAvisosDoSino(), { headers: { "cache-control": "no-store" } });
}
