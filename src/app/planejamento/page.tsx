import { createClientUntyped } from "@/lib/supabase/server";
import { criarPlano } from "@/lib/actions/planejamento";
import { PlanosTable, type PlanoRow } from "@/components/planejamento/PlanosTable";
import { pode } from "@/lib/auth/permissao-efetiva";
import { HelpLegend, HelpTip } from "@/components/common/HelpTip";
import { CriarPorBotao } from "@/components/common/CriarPorBotao";
import { Campo } from "@/components/common/Campo";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { avaliarGestaoPlano } from "@/lib/planejamento/gestao";
import { formatDate, formatPeriodo } from "@/lib/formatters";

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
      dataAlvo: formatDate(p.data_alvo),
      periodo: formatPeriodo(p.data_inicio_prevista, p.data_fim_prevista),
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
        {/* a lista vem primeiro; o formulário de novo plano abre pelo botão (L14) */}
        <CriarPorBotao
          rotulo="Novo plano"
          cabecalho={
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
          }
        >
          <form
            action={criarPlano}
            aria-label="Novo plano"
            className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
          >
            <Campo rotulo="Nome do plano" htmlFor="novo-plano-nome" className="sm:col-span-2 lg:col-span-3 xl:col-span-2">
              <Input id="novo-plano-nome" name="nome" placeholder="Ex.: Lote junho, sequenciamento" />
            </Campo>
            <Campo rotulo="Início previsto" htmlFor="novo-plano-inicio">
              <Input id="novo-plano-inicio" name="data_inicio_prevista" type="date" />
            </Campo>
            <Campo rotulo="Fim previsto" htmlFor="novo-plano-fim">
              <Input id="novo-plano-fim" name="data_fim_prevista" type="date" />
            </Campo>
            <Campo rotulo="Projeto" htmlFor="novo-plano-projeto">
              <Select id="novo-plano-projeto" name="projeto_id" defaultValue="">
                <option value="">—</option>
                {(projetos ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Prioridade" htmlFor="novo-plano-prioridade">
              <Select id="novo-plano-prioridade" name="prioridade" defaultValue="normal">
                <option value="baixa">Baixa</option>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </Select>
            </Campo>
            <Campo rotulo="Responsável operacional" htmlFor="novo-plano-responsavel" className="sm:col-span-2 xl:col-span-5">
              <Input id="novo-plano-responsavel" name="responsavel" placeholder="Pessoa ou equipe que executa" />
            </Campo>
            <div className="flex items-end justify-start">
              <button className="app-action-compact bg-brand-600 text-white hover:bg-brand-500">
                Criar plano
              </button>
            </div>
          </form>
        </CriarPorBotao>
        {planoExcluido && (
          <p role="status" className="mt-3 rounded-lg border border-brand-300 bg-brand-50 px-4 py-2 text-sm text-brand-800 dark:border-brand-800 dark:bg-brand-950/30 dark:text-brand-300">
            Plano #{planoExcluido} excluído. O motivo ficou registrado na trilha de auditoria.
          </p>
        )}


        <div className="mt-6">
          <PlanosTable rows={linhas} />
        </div>
      </main>
    </div>
  );
}
