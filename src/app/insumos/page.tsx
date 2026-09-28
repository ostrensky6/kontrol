import Link from "next/link";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { createClient } from "@/lib/supabase/server";
import {
  InsumosAnaliseTable,
  type InsumoAnaliseRow,
} from "@/components/insumos/InsumosAnaliseTable";

export const dynamic = "force-dynamic";

export default async function InsumosPage({
  searchParams,
}: {
  searchParams: Promise<{ analise?: string }>;
}) {
  const { analise } = await searchParams;
  const supabase = await createClient();

  const { data: analises } = await supabase
    .from("analises")
    .select("codigo")
    .order("codigo");

  const atual = analise ?? analises?.[0]?.codigo ?? "";

  const { data: linhas } = await supabase
    .from("insumo_analise")
    .select(
      "id, nome_etapa, nome_atividade, especificacao_insumo, grupo_escolha, quantidade_por_amostra, modo_cobranca, insumos(custo_unitario)",
    )
    .eq("codigo_analise", atual)
    .order("id");

  // grupos de escolha já existentes (em todas as análises) p/ reaproveitar
  const { data: gruposRaw } = await supabase
    .from("insumo_analise")
    .select("grupo_escolha")
    .not("grupo_escolha", "is", null);
  const grupoOptions = [
    { value: "", label: "(nenhum)" },
    ...[
      ...new Set((gruposRaw ?? []).map((g) => g.grupo_escolha).filter(Boolean) as string[]),
    ]
      .sort()
      .map((g) => ({ value: g, label: g })),
  ];
  const rows: InsumoAnaliseRow[] = (linhas ?? []).map((l) => {
    const custo =
      (l.insumos as { custo_unitario: number | null } | null)
        ?.custo_unitario ?? 0;
    const modo = l.modo_cobranca ?? "";
    return {
      id: l.id as number,
      etapa: l.nome_etapa ?? "—",
      atividade: l.nome_atividade ?? "—",
      etapaAtividade: `${l.nome_etapa ?? ""} ${l.nome_atividade ?? ""}`.trim(),
      especificacao: l.especificacao_insumo ?? "",
      semInsumo: l.especificacao_insumo ? "não" : "sim",
      custoUnitario: Number(custo),
      quantidade: Number(l.quantidade_por_amostra ?? 0),
      grupoEscolha: l.grupo_escolha ?? "",
      modoCobranca: modo,
      modoCobrancaLabel: modo === "por_execucao" ? "por execução" : "por amostra",
    };
  });

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex items-center gap-1">
          <h1 className="text-xl font-semibold tracking-tight">
            Insumos por análise
          </h1>
          <HelpTip title="Grupo e cobrança">
            <p>Edite grupo e modo de cobrança dos insumos; as mudanças recalculam o custeio.</p>
            <p>
              <b>Grupo</b>: linhas do mesmo grupo são alternativas; entra só uma, por padrão a mais
              barata.
            </p>
            <p>
              <b>Cobrança</b>: “por amostra” multiplica o consumo pelo número de amostras; “por
              execução” cobra o item uma vez por corrida e divide entre as amostras do lote.
            </p>
            <HelpExample>Controle de R$ 60 por execução e lote de 12: R$ 5 por amostra.</HelpExample>
          </HelpTip>
        </div>

        <nav className="mt-6 flex flex-wrap gap-2">
          {analises?.map((a) => (
            <Link
              key={a.codigo}
              href={`/insumos?analise=${encodeURIComponent(a.codigo)}`}
              className={`rounded-full px-3 py-1 text-xs ${
                a.codigo === atual
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              }`}
            >
              {a.codigo}
            </Link>
          ))}
        </nav>

        <div className="mt-6">
          <InsumosAnaliseTable rows={rows} grupoOptions={grupoOptions} />
        </div>

        <p className="mt-4 text-xs text-muted-foreground/80">
          {rows.length} linhas · análise {atual}
        </p>
      </main>
    </div>
  );
}
