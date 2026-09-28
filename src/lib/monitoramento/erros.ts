import "server-only";
import { createClient } from "@supabase/supabase-js";

import { normalizarRegistro, type RegistroErro } from "./registro-erro";

/**
 * Grava um erro em `erros_app` (0141) com a chave de serviço e deixa uma linha
 * no log do servidor (log da Vercel). Nunca lança: registrar erro não pode
 * virar um segundo erro. Sem chave (testes, prévia simulada) fica só o log.
 */
export async function registrarErro(registro: RegistroErro): Promise<void> {
  const linha = normalizarRegistro(registro);
  console.error("[kontrol-erro]", JSON.stringify(linha));

  if (process.env.NODE_ENV === "test" || process.env.PLAYWRIGHT_MOCK_SUPABASE === "1") return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_AUTH_ADMIN_KEY;
  if (!url || !chave) return;

  try {
    const supabase = createClient(url, chave, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supabase.from("erros_app").insert(linha);
    // Tabela ausente (0141 ainda não aplicada) ou banco fora: fica o log acima.
    if (error) console.error("[kontrol-erro] não gravado:", error.message);
  } catch (erro) {
    console.error("[kontrol-erro] não gravado:", erro instanceof Error ? erro.message : erro);
  }
}
