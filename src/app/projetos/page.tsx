import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { HelpTip } from "@/components/common/HelpTip";
import { formatDate } from "@/lib/formatters";
import { STATUS_PROJETO } from "./_lib/status";
import { responsavelDoProjeto } from "./_lib/responsavel";

export const dynamic = "force-dynamic";

const thCls =
  "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const tdCls = "px-3 py-2 text-sm text-foreground";

export default async function ProjetosPage() {
  const supabase = await createClient();
  const [{ data: projetos }, { data: clientes }] = await Promise.all([
    supabase
      .from("projetos")
      .select("id, nome, cliente_id, responsavel, coordenador, coordenador_nome, status, data_inicio, data_fim")
      .order("criado_em", { ascending: false }),
    supabase.from("clientes").select("id, nome"),
  ]);

  const clienteNome = new Map((clientes ?? []).map((c) => [c.id, c.nome]));

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <h1 className="text-xl font-semibold tracking-tight">Projetos</h1>
            <HelpTip title="Projetos">
              <p>Orçamentos, planejamentos e compras de cada projeto num só lugar.</p>
            </HelpTip>
          </div>
          <Link
            href="/cadastros/projetos"
            className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-400"
          >
            Cadastrar / editar projetos
          </Link>
        </div>

        <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          {(projetos ?? []).length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground/80">
              Nenhum projeto cadastrado.{" "}
              <Link href="/cadastros/projetos" className="text-brand-700 hover:underline dark:text-brand-400">
                Cadastrar o primeiro
              </Link>
              .
            </p>
          ) : (
            <table className="min-w-full">
              <thead className="border-b border-border/70">
                <tr>
                  <th className={thCls}>Projeto</th>
                  <th className={thCls}>Cliente</th>
                  <th className={thCls}>Responsável</th>
                  <th className={thCls}>Período</th>
                  <th className={thCls}>Status</th>
                </tr>
              </thead>
              <tbody>
                {(projetos ?? []).map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-border/50 last:border-b-0 hover:bg-muted/50"
                  >
                    <td className={tdCls}>
                      <Link href={`/projetos/${p.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-400">
                        {p.nome}
                      </Link>
                    </td>
                    <td className={tdCls}>{p.cliente_id != null ? clienteNome.get(p.cliente_id) ?? "—" : "—"}</td>
                    <td className={tdCls}>{responsavelDoProjeto(p) ?? "—"}</td>
                    <td className={tdCls}>
                      {p.data_inicio || p.data_fim
                        ? `${formatDate(p.data_inicio)} → ${formatDate(p.data_fim)}`
                        : "—"}
                    </td>
                    <td className={tdCls}>
                      {(() => {
                        const s = STATUS_PROJETO[p.status] ?? { label: p.status, cls: "bg-muted text-muted-foreground" };
                        return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
