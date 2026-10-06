import Link from "next/link";
import { HelpTip } from "@/components/common/HelpTip";
import {
  TriagemResolucaoCard,
  type TriagemPendenteView,
} from "@/components/scanner/TriagemResolucaoCard";
import { createClientUntyped } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = {
  status?: string;
};

function statusMessage(status?: string) {
  switch (status) {
    case "resolvido":
      return "Triagem resolvida e código vinculado.";
    case "insumo_criado":
      return "Insumo criado e código vinculado.";
    case "arquivado":
      return "Triagem arquivada.";
    default:
      return null;
  }
}

export default async function ScannerTriagemPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { status } = await searchParams;
  const supabase = await createClientUntyped();
  const [
    { data: triagensRaw },
    { data: insumosRaw },
    { data: lotesRaw },
    { data: locaisRaw },
  ] = await Promise.all([
    supabase
      .from("cadastros_triagem")
      .select("id, codigo, formato, tipo_sugerido, criado_em")
      .in("status", ["pendente", "em_analise"])
      .order("criado_em", { ascending: true }),
    supabase.from("insumos").select("id, especificacao").eq("ativo", true).order("especificacao").limit(200),
    supabase
      .from("lotes_estoque")
      .select("id, codigo_lote, insumos(especificacao)")
      .order("id", { ascending: false })
      .limit(200),
    supabase.from("locais").select("id, nome").order("nome").limit(200),
  ]);

  const triagens = (triagensRaw ?? []) as TriagemPendenteView[];
  const insumos = (insumosRaw ?? []).map((insumo: { id: number; especificacao: string | null }) => ({
    id: insumo.id,
    label: insumo.especificacao ?? `Insumo #${insumo.id}`,
  }));
  const lotes = ((lotesRaw ?? []) as unknown as {
    id: number;
    codigo_lote: string | null;
    insumos: { especificacao: string | null } | null;
  }[]).map((lote) => ({
    id: lote.id,
    label: `${lote.codigo_lote ?? `Lote #${lote.id}`} · ${lote.insumos?.especificacao ?? "sem insumo"}`,
  }));
  const locais = (locaisRaw ?? []).map((local: { id: number; nome: string | null }) => ({
    id: local.id,
    label: local.nome ?? `Local #${local.id}`,
  }));
  const mensagem = statusMessage(status);

  return (
    <main className="app-page-container">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Triagem de códigos desconhecidos</h1>
            <HelpTip title="Triagem de códigos">
              <p>
                Códigos lidos que o Kontrol não reconheceu. Para cada um: <b>vincule</b> a um insumo,
                lote ou local já cadastrado, crie um insumo básico ou arquive.
              </p>
              <p>Nada aqui dá entrada no estoque nem recebe lote.</p>
            </HelpTip>
          </div>
        </div>
        <Link
          href="/scanner/desconhecido"
          className="rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50"
        >
          Digitar código
        </Link>
      </div>

      {mensagem && (
        <p className="mt-6 rounded-md border border-success-strong/30 bg-success-soft px-3 py-2 text-sm text-success-strong">
          {mensagem}
        </p>
      )}

      <div className="mt-6 grid gap-4">
        {triagens.map((triagem) => (
          <TriagemResolucaoCard
            key={triagem.id}
            triagem={triagem}
            insumos={insumos}
            lotes={lotes}
            locais={locais}
          />
        ))}
        {triagens.length === 0 && (
          <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhuma triagem pendente.
          </p>
        )}
      </div>
    </main>
  );
}
