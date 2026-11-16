import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { novaLeitura, semRegistro } from "@/lib/supabase/leitura";

export const dynamic = "force-dynamic";

export default async function OrcamentoProjetoLegacyRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const leitura = novaLeitura("/orcamento/projetos/[id]");
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await leitura.de("orçamentos de projeto", supabase
    .from("orcamento_projetos")
    .select("demanda_id")
    .eq("id", Number(id))
    .single());
  // leitura que falhou não vira "orçamento sem demanda": a tela de erro oferece tentar de novo
  if (leitura.falhas.length > 0) semRegistro(leitura);
  if (data?.demanda_id) {
    redirect(`/orcamento/demandas/${data.demanda_id}?etapa=projeto`);
  }
  redirect("/orcamento/demandas");
}
