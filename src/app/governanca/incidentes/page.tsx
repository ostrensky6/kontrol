import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { HelpTip } from "@/components/common/HelpTip";
import { AtualizarIncidenteForm, DESTINO_INCIDENTE, NovoIncidenteForm } from "@/components/incidentes/IncidentesForms";
import { temPapel } from "@/lib/auth/roles";
import { formatDateTime } from "@/lib/formatters";
import {
  CAMPOS_INCIDENTE,
  CAUSA_DESCONHECIDA,
  ROTULO_SITUACAO_INCIDENTE,
  ordenarIncidentes,
  type Incidente,
  type IncidenteAtualizacao,
} from "@/lib/incidentes";
import { createClientUntyped } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COR: Record<Incidente["situacao"], string> = {
  aberto: "border-danger-strong/40 bg-danger-soft text-danger-strong",
  em_andamento: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100",
  resolvido: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100",
};

export default async function IncidentesPage() {
  const podeRegistrar = await temPapel("coordenador");
  const supabase = await createClientUntyped();
  const [{ data, error }, { data: passos }] = await Promise.all([
    supabase.from("incidentes").select(CAMPOS_INCIDENTE).order("registrado_em", { ascending: false }).limit(100),
    supabase.from("incidentes_atualizacoes").select("id, incidente_id, situacao, nota, criado_em").order("criado_em", { ascending: true }).limit(1000),
  ]);
  const incidentes = ordenarIncidentes((data ?? []) as Incidente[]);
  const porIncidente = new Map<number, IncidenteAtualizacao[]>();
  for (const p of (passos ?? []) as IncidenteAtualizacao[]) {
    const id = Number(p.incidente_id);
    if (!porIncidente.has(id)) porIncidente.set(id, []);
    porIncidente.get(id)!.push(p);
  }
  const abertos = incidentes.filter((i) => i.situacao !== "resolvido").length;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <Breadcrumbs items={[{ label: "Governança", href: "/governanca" }, { label: "Incidentes" }]} />
      <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight">
        Incidentes
        <HelpTip title="Como funciona">
          <p>Um incidente é algo que atrapalha o trabalho: sistema fora do ar, dado errado, equipamento parado, falta de energia.</p>
          <p>Quem registra diz o que aconteceu, quem foi afetado e o que fazer enquanto isso. O aviso chega no sino de quem foi escolhido.</p>
          <p>Se a causa ainda não foi confirmada, deixe em branco: a tela mostra “{CAUSA_DESCONHECIDA}”.</p>
        </HelpTip>
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {abertos === 0 ? "Nenhum incidente em aberto." : `${abertos} ${abertos === 1 ? "incidente em aberto" : "incidentes em aberto"}.`}{" "}
        Coordenador, Gestor, Supervisor e Administrador registram e acompanham; todos veem.
      </p>
      {error && <p className="mt-3 text-sm text-danger-strong">Não foi possível ler os incidentes agora. Recarregue a página.</p>}

      {podeRegistrar && (
        <section className="mt-6 rounded-lg border border-border bg-card p-4 shadow-sm" aria-labelledby="novo-incidente-titulo">
          <h2 id="novo-incidente-titulo" className="mb-3 text-lg font-semibold tracking-tight">Registrar incidente</h2>
          <NovoIncidenteForm />
        </section>
      )}

      <section className="mt-6 space-y-3" aria-label="Lista de incidentes">
        {incidentes.length === 0 && !error && (
          <p className="rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">Nenhum incidente registrado.</p>
        )}
        {incidentes.map((i) => (
          <article key={i.id} id={`incidente-${i.id}`} className="rounded-lg border border-border bg-card p-4 shadow-sm" data-testid="incidente">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{i.titulo}</h2>
              <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${COR[i.situacao]}`}>{ROTULO_SITUACAO_INCIDENTE[i.situacao]}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Registrado em {formatDateTime(i.registrado_em)}
              {i.resolvido_em && ` · resolvido em ${formatDateTime(i.resolvido_em)}`} · aviso para {DESTINO_INCIDENTE[i.papel_destino] ?? i.papel_destino}
            </p>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[11rem_1fr]">
              <dt className="font-medium">O que aconteceu</dt><dd className="whitespace-pre-line">{i.descricao}</dd>
              <dt className="font-medium">Afetados</dt><dd>{i.afetados}</dd>
              <dt className="font-medium">O que fazer</dt><dd className="whitespace-pre-line">{i.orientacao}</dd>
              <dt className="font-medium">Causa</dt>
              <dd className={i.causa ? "whitespace-pre-line" : "italic text-muted-foreground"}>{i.causa ?? CAUSA_DESCONHECIDA}</dd>
            </dl>
            {(porIncidente.get(i.id) ?? []).length > 0 && (
              <ol className="mt-3 space-y-1 border-l border-border pl-3 text-xs" aria-label={`Acompanhamento de ${i.titulo}`}>
                {(porIncidente.get(i.id) ?? []).map((p) => (
                  <li key={p.id}>
                    <span className="text-muted-foreground">{formatDateTime(p.criado_em)} · {ROTULO_SITUACAO_INCIDENTE[p.situacao]}:</span> {p.nota}
                  </li>
                ))}
              </ol>
            )}
            {podeRegistrar && <AtualizarIncidenteForm id={i.id} titulo={i.titulo} situacao={i.situacao} />}
          </article>
        ))}
      </section>
    </main>
  );
}
