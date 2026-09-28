import { createClientUntyped } from "@/lib/supabase/server";
import { criarPlano } from "@/lib/actions/planejamento";
import { PlanosTable, type PlanoRow } from "@/components/planejamento/PlanosTable";
import { pode } from "@/lib/auth/permissao-efetiva";
import { HelpLegend, HelpTip } from "@/components/common/HelpTip";
import { avaliarGestaoPlano } from "@/lib/planejamento/gestao";

export const dynamic = "force-dynamic";

type Reserva = { status: string; quantidade_consumida?: number | null };
type PlanejamentoListRow = {
  id: number;
  nome: string | null;
  data_alvo: string | null;
  data_inicio_prevista?: string | null;
  data_fim_prevista?: string | null;
  prioridade?: string | null;
  responsavel?: string | null;
  planejado_por?: string | null;
  reservado_por?: string | null;
  projeto_id: number | null;
  status_operacional?: string | null;
  planejamento_itens: { count: number }[] | null;
  reservas_estoque: Reserva[] | null;
};
type PlanejamentoQuery = {
  select: (columns: string) => {
    order: (column: string, options?: { ascending?: boolean }) => PromiseLike<{
      data: PlanejamentoListRow[] | null;
      error: { message?: string; code?: string } | null;
    }>;
  };
};

function erroSchemaCache(error: { message?: string; code?: string } | null | undefined) {
  return Boolean(
    error &&
      (error.code === "PGRST204" ||
        error.message?.includes("schema cache") ||
        error.message?.includes("Could not find the")),
  );
}

function statusPlano(reservas: Reserva[], statusOperacional?: string | null) {
  if (statusOperacional === "concluido") return { status: "concluido", label: "Concluído" };
  if (statusOperacional === "em_execucao") return { status: "iniciado", label: "Em execução" };
  if (statusOperacional === "cancelado") return { status: "liberado", label: "Cancelado" };
  if (statusOperacional === "reservado") return { status: "reservado", label: "Reservado" };
  if (reservas.some((r) => r.status === "consumido"))
    return { status: "iniciado", label: "Iniciado" };
  if (reservas.some((r) => r.status === "reservado"))
    return { status: "reservado", label: "Reservado" };
  if (reservas.length > 0)
    return { status: "liberado", label: "Liberado" };
  return { status: "rascunho", label: "Rascunho" };
}

export default async function PlanejamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ excluido?: string }>;
}) {
  const { excluido } = await searchParams;
  const planoExcluido = Number(excluido) > 0 ? Number(excluido) : null;
  const supabase = await createClientUntyped();
  const planejamentoQuery = supabase.from("planejamento") as unknown as PlanejamentoQuery;
  const [planosResult, { data: projetos }, podeGerir] = await Promise.all([
    planejamentoQuery
      .select("id, nome, data_alvo, data_inicio_prevista, data_fim_prevista, prioridade, responsavel, planejado_por, reservado_por, criado_em, projeto_id, status_operacional, planejamento_itens(count), reservas_estoque(status, quantidade_consumida)")
      .order("criado_em", { ascending: false }),
    supabase.from("projetos").select("id, nome").order("nome"),
    pode("planejamento.editar"),
  ]);
  const { data: planos } = erroSchemaCache(planosResult.error)
    ? await planejamentoQuery
        .select("id, nome, data_alvo, responsavel, criado_em, projeto_id, status_operacional, planejamento_itens(count), reservas_estoque(status, quantidade_consumida)")
        .order("criado_em", { ascending: false })
    : planosResult;
  const projetoNome = new Map((projetos ?? []).map((p) => [p.id, p.nome]));
  const linhas: PlanoRow[] = (planos ?? []).map((p) => {
    const itens = (p.planejamento_itens as { count: number }[])?.[0]?.count ?? 0;
    const statusOperacional = (p as unknown as { status_operacional?: string | null }).status_operacional;
    const reservas = (p.reservas_estoque as Reserva[]) ?? [];
    const st = statusPlano(reservas, statusOperacional);
    const gestao = avaliarGestaoPlano({ status: statusOperacional, reservas, podeGerir });
    return {
      id: p.id as number,
      nome: p.nome ?? "Plano sem nome",
      projeto: p.projeto_id != null ? projetoNome.get(p.projeto_id) ?? "—" : "—",
      dataAlvo: p.data_alvo ?? "—",
      periodo: p.data_inicio_prevista && p.data_fim_prevista
        ? `${p.data_inicio_prevista} → ${p.data_fim_prevista}`
        : p.data_inicio_prevista ?? p.data_fim_prevista ?? "—",
      prioridade: p.prioridade ?? "normal",
      responsavel: p.responsavel ?? "—",
      itens,
      status: st.status,
      statusLabel: st.label,
      editavel: gestao.podeEditar,
      gestao: { acao: gestao.acao, bloqueado: gestao.acaoBloqueada, motivo: gestao.motivoAcao },
    };
  });

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex items-center gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Planejamento</h1>
          <HelpTip title="Planejamento">
            <p>
              Cada plano organiza a execução das análises: projeto, período, <b>reserva de lotes</b>,
              pedidos para o que falta e a baixa no estoque.
            </p>
            <HelpLegend
              items={[
                { tom: "atencao", rotulo: "Rascunho", texto: "ainda sem reserva de insumos." },
                { tom: "info", rotulo: "Reservado", texto: "lotes separados, ainda sem baixa." },
                { tom: "info", rotulo: "Em execução", texto: "iniciado; os lotes reservados já foram baixados." },
                { tom: "ok", rotulo: "Concluído", texto: "execução encerrada." },
                { tom: "neutro", rotulo: "Liberado", texto: "reservas desfeitas ou plano cancelado." },
              ]}
            />
          </HelpTip>
        </div>
        {planoExcluido && (
          <p role="status" className="mt-3 rounded-lg border border-brand-300 bg-brand-50 px-4 py-2 text-sm text-brand-800 dark:border-brand-800 dark:bg-brand-950/30 dark:text-brand-300">
            Plano #{planoExcluido} excluído. O motivo ficou registrado na trilha de auditoria.
          </p>
        )}

        {/* novo plano */}
        <form action={criarPlano} className="mt-6 grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm lg:grid-cols-[minmax(16rem,1.4fr)_minmax(11rem,.8fr)_minmax(11rem,.8fr)_minmax(12rem,.9fr)_minmax(10rem,.7fr)]">
          <div>
            <label className="block text-xs font-medium text-muted-foreground">Nome do plano</label>
            <input name="nome" placeholder="Ex.: Lote junho — sequenciamento" className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground">Início previsto</label>
            <input name="data_inicio_prevista" type="date" className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground">Fim previsto</label>
            <input name="data_fim_prevista" type="date" className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground">Projeto</label>
            <select name="projeto_id" defaultValue="" className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm">
              <option value="">—</option>
              {(projetos ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground">Prioridade</label>
            <select name="prioridade" defaultValue="normal" className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm">
              <option value="baixa">Baixa</option>
              <option value="normal">Normal</option>
              <option value="alta">Alta</option>
              <option value="urgente">Urgente</option>
            </select>
          </div>
          <div className="lg:col-span-4">
            <label className="block text-xs font-medium text-muted-foreground">Responsável operacional</label>
            <input name="responsavel" placeholder="Pessoa/equipe responsável pela execução" className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm" />
          </div>
          <div className="flex items-end justify-start">
            <button className="app-action-compact bg-brand-600 text-white hover:bg-brand-500">
              Novo plano
            </button>
          </div>
        </form>

        <div className="mt-6">
          <PlanosTable rows={linhas} />
        </div>
      </main>
    </div>
  );
}
