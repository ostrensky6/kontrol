import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

/**
 * Diz qual prazo a previsão de reposição está usando (0130): tramitação da
 * compra na universidade (parâmetro) + entrega de cada fornecedor. Enquanto a
 * tramitação não for informada, avisa que a sugestão pode chegar tarde.
 */
export async function PrazoReposicao({ className = "" }: { className?: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("parametros")
    .select("valor")
    .eq("chave", "prazo_tramitacao_compra_dias")
    .maybeSingle();
  const tramitacao = Number(data?.valor ?? 0);

  if (tramitacao > 0) {
    return (
      <p className={`text-xs text-muted-foreground ${className}`}>
        Prazo considerado: {tramitacao} dias de tramitação na universidade + a entrega de cada fornecedor.
      </p>
    );
  }
  return (
    <p role="note" className={`text-xs text-warning-strong ${className}`}>
      A tramitação da compra na universidade ainda não foi informada: a previsão conta só a entrega do
      fornecedor e pode avisar tarde.{" "}
      <Link href="/parametros" className="font-medium underline">
        Informar em Parâmetros
      </Link>
      .
    </p>
  );
}
