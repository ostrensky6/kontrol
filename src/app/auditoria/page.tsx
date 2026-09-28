import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { pode, podeVerSalario } from "@/lib/auth/permissao-efetiva";
import { mascararAuditoriaSigilosa } from "@/lib/cadastros/salario";
import { AuditoriaTable, type AuditoriaRow } from "@/components/auditoria/AuditoriaTable";
import { formatDateTime } from "@/lib/formatters";
import { HelpTip } from "@/components/common/HelpTip";

export const dynamic = "force-dynamic";

const TABELAS = ["", "lotes_estoque", "insumos", "reservas_estoque", "pedidos_compra", "tecnicos"];
const LABEL: Record<string, string> = {
  lotes_estoque: "Lotes",
  insumos: "Insumos",
  reservas_estoque: "Reservas",
  pedidos_compra: "Pedidos",
  tecnicos: "Técnicos",
  tecnicos_remuneracao: "Salário (técnicos)",
};
const ACAO: Record<string, { label: string; cls: string }> = {
  insert: { label: "Criou", cls: "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300" },
  update: { label: "Alterou", cls: "bg-info-soft text-info-strong" },
  delete: { label: "Removeu", cls: "bg-danger-soft text-danger-strong" },
};

const IGNORAR = new Set(["criado_em", "atualizado_em"]);

function resumoDiff(acao: string, ant: Record<string, unknown> | null, novo: Record<string, unknown> | null): string {
  if (acao === "insert") return "registro criado";
  if (acao === "delete") return "registro removido";
  if (!ant || !novo) return "—";
  const mudancas: string[] = [];
  for (const k of Object.keys(novo)) {
    if (IGNORAR.has(k)) continue;
    if (JSON.stringify(ant[k]) !== JSON.stringify(novo[k])) {
      mudancas.push(`${k}: ${fmtVal(ant[k])} → ${fmtVal(novo[k])}`);
    }
  }
  return mudancas.slice(0, 4).join(" · ") || "sem mudanças relevantes";
}
function fmtVal(v: unknown) {
  if (v == null) return "∅";
  const s = String(v);
  return s.length > 28 ? s.slice(0, 28) + "…" : s;
}

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ tabela?: string }>;
}) {
  if (!(await pode("auditoria.visualizar"))) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 text-center font-sans">
        <p className="text-muted-foreground">
          Acesso restrito — a trilha de auditoria é visível para papel gestor ou admin.
        </p>
      </main>
    );
  }

  const { tabela } = await searchParams;
  const supabase = await createClient();
  let q = supabase
    .from("auditoria")
    .select("id, tabela, registro_id, acao, usuario, valor_anterior, valor_novo, criado_em")
    .order("id", { ascending: false })
    .limit(200);
  if (tabela) q = q.eq("tabela", tabela);
  const [{ data: registros }, podeVerSalarios] = await Promise.all([q, podeVerSalario()]);
  const linhas: AuditoriaRow[] = (registros ?? []).map((original) => {
    // Defesa em profundidade: a policy da 0112 já esconde o salário; aqui ele
    // nunca é serializado para o cliente sem a permissão.
    const r = mascararAuditoriaSigilosa(
      {
        ...original,
        valor_anterior: original.valor_anterior as Record<string, unknown> | null,
        valor_novo: original.valor_novo as Record<string, unknown> | null,
      },
      podeVerSalarios,
    );
    const a = ACAO[r.acao] ?? { label: r.acao, cls: "" };
    return {
      id: r.id as number,
      quando: formatDateTime(r.criado_em as string),
      usuario: r.usuario ?? "—",
      tabela: r.tabela,
      tabelaLabel: LABEL[r.tabela] ?? r.tabela,
      registro: `#${r.registro_id}`,
      acao: r.acao,
      acaoLabel: a.label,
      alteracao: resumoDiff(r.acao, r.valor_anterior, r.valor_novo),
    };
  });

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex items-center gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Auditoria</h1>
          <HelpTip title="Trilha de auditoria">
            <p>Quem alterou o quê, e quando.</p>
            <p>
              Cada alteração é registrada <b>automaticamente</b>, com o valor anterior e o novo.
              Ninguém pode editar nem apagar esses registros.
            </p>
            <p>Use os filtros para ver só um tipo de cadastro.</p>
          </HelpTip>
        </div>

        <nav className="mt-5 flex flex-wrap gap-2 text-xs">
          {TABELAS.map((t) => (
            <Link
              key={t || "todas"}
              href={t ? `/auditoria?tabela=${t}` : "/auditoria"}
              className={`rounded-full px-3 py-1 ${
                (tabela ?? "") === t
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground hover:bg-muted/80"
              }`}
            >
              {t ? LABEL[t] : "Todas"}
            </Link>
          ))}
        </nav>

        <div className="mt-4">
          <AuditoriaTable rows={linhas} />
        </div>
      </main>
    </div>
  );
}
