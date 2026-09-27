import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/formatters";
import { HelpTip } from "@/components/common/HelpTip";
import { DemandasTable, type DemandaRow } from "@/components/orcamento/DemandasTable";
import { avaliarCompletudeDemanda } from "@/lib/orcamento/demanda-completude";
import { carregarLinhasOrcamentos } from "@/lib/orcamento/orcamentos-listagem";
import { resumirFunilPropostas } from "@/lib/orcamento/funil-propostas";
import { PageShell } from "@/components/app/PageShell";
import { PageHeader } from "@/components/app/PageHeader";
import { StatCard } from "@/components/app/StatCard";

export const dynamic = "force-dynamic";

// Rótulos de exibição (inclui legados para leitura de dados antigos).
const MODALIDADES: Record<string, string> = {
  analises: "Apenas análises",
  projeto: "Apenas projeto",
  projeto_com_analises: "Projeto com análises",
  analises_projeto: "Análises dentro de projeto",
  projeto_analises_custos: "Projeto com análises e custos próprios",
};

const STATUS: Record<string, string> = {
  nova: "Nova",
  em_analise: "Em análise",
  orcada: "Orçada",
  aprovada: "Aprovada",
  recusada: "Recusada",
  cancelada: "Cancelada",
};

export default async function DemandasPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusFiltro } = await searchParams;
  const supabase = await createClient();
  const [{ data: demandas }, { data: projetos }, linhasFunil] =
    await Promise.all([
      supabase
        .from("demandas_propostas")
        .select("id, titulo, cliente_id, cliente_nome, modalidade, status, prioridade, data_solicitacao, prazo_esperado, projeto_id, descricao, escopo_preliminar, matriz_amostra, quantidade_amostras_estimada, prazo_tecnico_dias, criado_em")
        .order("criado_em", { ascending: false }),
      supabase.from("projetos").select("id, nome").order("nome"),
      carregarLinhasOrcamentos(),
    ]);
  const resumoFunil = resumirFunilPropostas(linhasFunil);
  const projetoNome = new Map((projetos ?? []).map((p) => [p.id, p.nome]));
  const linhas: DemandaRow[] = (demandas ?? []).map((d) => {
    const completude = avaliarCompletudeDemanda(d);
    return {
      id: d.id as number,
      titulo: d.titulo ?? "Orçamento sem título",
      cliente: d.cliente_nome ?? "—",
      modalidade: d.modalidade,
      modalidadeLabel: MODALIDADES[d.modalidade] ?? d.modalidade,
      projeto: d.projeto_id ? projetoNome.get(d.projeto_id) ?? "—" : "—",
      prazo: formatDate(d.prazo_esperado),
      prioridade: d.prioridade ?? "—",
      dataSolicitacao: formatDate(d.data_solicitacao),
      status: d.status,
      statusLabel: STATUS[d.status] ?? d.status,
      completudeLabel: completude.completa ? "Pronta" : `${completude.faltante}% faltante`,
      completa: completude.completa,
    };
  });
  const linhasFiltradas = statusFiltro
    ? linhas.filter((linha) => linha.status === statusFiltro)
    : linhas;

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: "Orçamento" }, { label: "Orçamentos" }]}
        title="Orçamentos"
        description="Orçamentos em andamento."
        help={
          <HelpTip title="Orçamentos">
            <p>O orçamento é o processo; a <b>proposta</b> é o documento emitido ao final para o cliente.</p>
            <p>Cada orçamento segue um caminho conforme a <b>modalidade</b>: só análises laboratoriais, só projeto, ou projeto com análises.</p>
          </HelpTip>
        }
      />

      <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6" aria-label="Funil de propostas">
        {[
          { label: "Em elaboração", valor: resumoFunil.emElaboracao },
          { label: "Em revisão", valor: resumoFunil.revisao },
          { label: "Emitidas", valor: resumoFunil.emitidas },
          { label: "Aprovadas", valor: resumoFunil.aprovadas },
          { label: "Recusadas", valor: resumoFunil.recusadas },
          { label: "Concluídas", valor: resumoFunil.concluidas },
        ].map((item) => (
          <StatCard key={item.label} label={item.label} value={item.valor.toLocaleString("pt-BR")} />
        ))}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Para começar, crie um orçamento com os dados do cliente, as amostras e as análises.
        </p>
        <Link
          href="/orcamento/demandas/nova"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Novo orçamento
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/orcamento/demandas"
          className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            !statusFiltro
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          Todas
        </Link>
        {Object.entries(STATUS).map(([value, label]) => (
          <Link
            key={value}
            href={`/orcamento/demandas?status=${value}`}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFiltro === value
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <DemandasTable rows={linhasFiltradas} />
    </PageShell>
  );
}
