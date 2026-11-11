import { PageHeader } from "@/components/app/PageHeader";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { hrefFichaInsumo } from "@/lib/estoque/ficha-insumo-rota";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

type CustoEstoque = {
  insumo_id: number;
  especificacao: string | null;
  unidade: string | null;
  custo_padrao: number | null;
  custo_medio_ponderado: number | null;
  divergencia_percentual: number | null;
  situacao: string;
};

/**
 * Relatório de custo do estoque (L10 da revisão de 11/11): antes era um dos
 * botões dentro de Saldo e lotes. Lista só os insumos em que o custo padrão
 * do cadastro e o custo médio dos lotes liberados divergem.
 */
export default async function CustoDoEstoquePage() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("v_custo_estoque_vigente").select("*").order("especificacao");
  const divergentes = ((data ?? []) as CustoEstoque[])
    .filter((custo) => custo.situacao === "divergente" || custo.situacao === "sem_custo_padrao")
    .sort((a, b) => Math.abs(Number(b.divergencia_percentual ?? 0)) - Math.abs(Number(a.divergencia_percentual ?? 0)));

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container space-y-4">
        <PageHeader
          breadcrumbs={[
            { label: "Suprimentos", href: "/suprimentos" },
            { label: "Estoque", href: "/estoque" },
            { label: "Custo do estoque" },
          ]}
          title="Custo do estoque"
          description="Insumos em que o custo do cadastro e o dos lotes liberados não batem."
          meta={
            error ? (
              <span className="text-sm text-muted-foreground">sem dado</span>
            ) : (
              <span className="text-sm tabular-nums text-warning-strong" data-testid="custos-divergencias">
                {divergentes.length} {divergentes.length === 1 ? "divergência" : "divergências"}
              </span>
            )
          }
          help={
            <HelpTip title="Custo padrão × custo médio">
              <p>
                O <b>custo padrão</b> vem do cadastro e é usado nas simulações. O <b>custo médio</b> é o preço
                real dos lotes liberados. A lista mostra só os insumos em que os dois divergem.
              </p>
              <HelpExample>Padrão R$ 100, lotes a R$ 120 → variação de +20%: revise o custo padrão.</HelpExample>
            </HelpTip>
          }
        />

        {error ? (
          <p role="alert" className="rounded-md border border-warning-strong/30 bg-warning-soft px-3 py-2 text-sm text-warning-strong">
            Sem dado: não foi possível ler o custo do estoque ({error.message}).
          </p>
        ) : (
          <section aria-labelledby="custos-titulo" className="rounded-lg border border-border bg-card p-4">
            <h2 id="custos-titulo" className="sr-only">
              Custo de estoque vigente
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Insumo</TableHead>
                  <TableHead className="text-right">Padrão</TableHead>
                  <TableHead className="text-right">Médio vigente</TableHead>
                  <TableHead className="text-right">Variação</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {divergentes.map((custo) => (
                  <TableRow key={custo.insumo_id}>
                    <TableCell className="font-medium">
                      <Link href={hrefFichaInsumo(custo.insumo_id) ?? "/estoque"} className="hover:underline">
                        {custo.especificacao ?? "—"}
                      </Link>{" "}
                      <span className="text-xs text-muted-foreground">{custo.unidade ?? ""}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(custo.custo_padrao)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(custo.custo_medio_ponderado)}</TableCell>
                    <TableCell className="text-right tabular-nums text-warning-strong">
                      {custo.divergencia_percentual == null ? "—" : formatPercent(custo.divergencia_percentual)}
                    </TableCell>
                    <TableCell className="text-xs text-warning-strong">
                      {custo.situacao === "sem_custo_padrao" ? "Sem custo padrão" : "Divergente"}
                    </TableCell>
                  </TableRow>
                ))}
                {divergentes.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-5 text-center text-muted-foreground">
                      Custos vigentes alinhados ou sem lotes liberados.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </section>
        )}
      </main>
    </div>
  );
}
