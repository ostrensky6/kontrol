import { createClient } from "@/lib/supabase/server";
import { registrarErro } from "@/lib/monitoramento/erros";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TAMANHO_MAXIMO = 16_000;

/**
 * Recebe os erros das telas (error.tsx e global-error.tsx) e grava em
 * `erros_app` (0141). Só de quem está logado: sem sessão, a rota não grava,
 * para ninguém de fora encher o registro.
 */
export async function POST(request: Request) {
  const corpo = await request.text();
  if (corpo.length > TAMANHO_MAXIMO) return new Response(null, { status: 413 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 204 });

  let dados: Record<string, unknown>;
  try {
    const lido: unknown = JSON.parse(corpo);
    if (!lido || typeof lido !== "object") return new Response(null, { status: 400 });
    dados = lido as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400 });
  }

  const texto = (valor: unknown) => (typeof valor === "string" ? valor : null);
  await registrarErro({
    origem: "navegador",
    mensagem: texto(dados.mensagem) ?? "Erro na tela sem mensagem",
    rota: texto(dados.rota),
    digest: texto(dados.digest),
    detalhe: texto(dados.detalhe),
    usuarioId: user.id,
  });
  return new Response(null, { status: 204 });
}
