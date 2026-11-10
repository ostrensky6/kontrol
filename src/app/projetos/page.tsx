import Link from "next/link";
import { createClient, createClientUntyped } from "@/lib/supabase/server";
import { HelpTip } from "@/components/common/HelpTip";
import { formatDate } from "@/lib/formatters";
import { STATUS_PROJETO } from "./_lib/status";
import { coordenadorDoProjeto, type UsuarioCoordenador } from "./_lib/responsavel";

export const dynamic = "force-dynamic";

const thCls =
  "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const tdCls = "px-3 py-2 text-sm text-foreground";

export default async function ProjetosPage() {
  const supabase = await createClient();
  const [{ data: projetos }, { data: clientes }, { data: usuarios }] = await Promise.all([
    supabase
      .from("projetos")
      .select("id, nome, cliente_id, responsavel, coordenador, coordenador_nome, status, data_inicio, data_fim")
      .order("criado_em", { ascending: false }),
    supabase.from("clientes").select("id, nome"),
    // quem aprova os pedidos do projeto é o usuário indicado como coordenador (0136/0169)
    supabase.from("perfis").select("id, nome, email, suspenso"),
  ]);
  const perfis = (usuarios ?? []) as UsuarioCoordenador[];
  // coordenador_id ainda não está nos tipos gerados: lido à parte
  const { data: coordenadores } = await (await createClientUntyped()).from("projetos").select("id, coordenador_id");
  const coordenadorPorProjeto = new Map(
    ((coordenadores ?? []) as { id: number; coordenador_id: string | null }[]).map((c) => [c.id, c.coordenador_id]),
  );
  const coordenadorDe = (p: { id: number; responsavel?: string | null; coordenador_nome?: string | null; coordenador?: string | null }) =>
    coordenadorDoProjeto({ ...p, coordenador_id: coordenadorPorProjeto.get(p.id) ?? null }, perfis);
  const semCoordenador = (projetos ?? []).filter(
    (p) => !["concluido", "cancelado"].includes(p.status) && coordenadorDe(p).situacao !== "ok",
  ).length;

  const clienteNome = new Map((clientes ?? []).map((c) => [c.id, c.nome]));

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <h1 className="text-xl font-semibold tracking-tight">Projetos</h1>
            <HelpTip title="Projetos">
              <p>Orçamentos, planejamentos e compras de cada projeto num só lugar.</p>
              <p>
                O <b>coordenador</b> é o usuário que aprova os pedidos de compra do projeto. Projeto sem
                coordenador não consegue enviar pedido para aprovação. O nome escrito no campo
                “Responsável técnico” é só informativo.
              </p>
            </HelpTip>
          </div>
          <Link
            href="/cadastros/projetos"
            className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
          >
            Cadastrar / editar projetos
          </Link>
        </div>

        {semCoordenador > 0 && (
          <div
            data-testid="projetos-sem-coordenador"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning-strong/40 bg-warning-soft px-4 py-3 text-sm text-warning-strong"
          >
            <p>
              <b>
                {semCoordenador} {semCoordenador === 1 ? "projeto em aberto está" : "projetos em aberto estão"} sem coordenador.
              </b>{" "}
              Os pedidos de compra {semCoordenador === 1 ? "dele" : "deles"} não seguem para aprovação.
            </p>
            <Link href="/cadastros/projetos" className="font-semibold underline">
              Indicar coordenador
            </Link>
          </div>
        )}

        <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          {(projetos ?? []).length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground/80">
              Nenhum projeto cadastrado.{" "}
              <Link href="/cadastros/projetos" className="text-brand-700 hover:underline dark:text-brand-300">
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
                  <th className={thCls}>Coordenador</th>
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
                      <Link href={`/projetos/${p.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">
                        {p.nome}
                      </Link>
                    </td>
                    <td className={tdCls}>{p.cliente_id != null ? clienteNome.get(p.cliente_id) ?? "—" : "—"}</td>
                    <td className={tdCls}>
                      {(() => {
                        const c = coordenadorDe(p);
                        if (c.situacao === "ok") return c.nome;
                        return (
                          <Link
                            href={`/cadastros/projetos?focus=${p.id}`}
                            className="inline-flex flex-col items-start"
                            title="Abrir o cadastro para indicar o coordenador"
                          >
                            <span className="inline-flex rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning-strong">
                              {c.situacao === "suspenso" ? "Coordenador suspenso" : "Sem coordenador"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {c.situacao === "suspenso" ? c.nome : c.escrito ? `escrito: ${c.escrito}` : "indicar"}
                            </span>
                          </Link>
                        );
                      })()}
                    </td>
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
