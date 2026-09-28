import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/formatters";
import { HelpTip } from "@/components/common/HelpTip";
import { DemandasTable, type DemandaRow } from "@/components/orcamento/DemandasTable";
import { avaliarCompletudeDemanda } from "@/lib/orcamento/demanda-completude";
import { carregarLinhasOrcamentos, type OrcamentoFila } from "@/lib/orcamento/orcamentos-listagem";
import { FASES, faseDoOrcamento, resumirFases, valorDoOrcamento } from "@/lib/orcamento/fase-orcamento";
import { PageShell } from "@/components/app/PageShell";
import { PageHeader } from "@/components/app/PageHeader";

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
  // Módulos e propostas de cada orçamento: dão a fase e o valor da linha.
  const linhasPorDemanda = new Map<number, OrcamentoFila[]>();
  for (const linha of linhasFunil) {
    if (linha.demandaId == null) continue;
    linhasPorDemanda.set(linha.demandaId, [...(linhasPorDemanda.get(linha.demandaId) ?? []), linha]);
  }
  const rotuloFase = new Map(FASES.map((f) => [f.id, f.item]));
  const projetoNome = new Map((projetos ?? []).map((p) => [p.id, p.nome]));
  const linhas: DemandaRow[] = (demandas ?? []).map((d) => {
    const completude = avaliarCompletudeDemanda(d);
    const doOrcamento = linhasPorDemanda.get(d.id as number) ?? [];
    const faseLinha = faseDoOrcamento(d.status, doOrcamento);
    const { valor, origem } = valorDoOrcamento(doOrcamento);
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
      fase: faseLinha,
      faseLabel: rotuloFase.get(faseLinha) ?? faseLinha,
      valor,
      valorEstimado: origem === "estimativa",
      completudeLabel: completude.completa ? "Pronta" : `${completude.faltante}% faltante`,
      completa: completude.completa,
    };
  });
  const resumoFases = resumirFases(linhas.map((linha) => linha.fase));
  // ?status= (endereço antigo) continua filtrando pelo status do cadastro.
  const linhasFiltradas = statusFiltro ? linhas.filter((linha) => linha.status === statusFiltro) : linhas;
  // resumo em uma linha: total e as fases que têm orçamento
  const partesResumo = FASES.filter((f) => resumoFases[f.id] > 0).map(
    (f) => `${resumoFases[f.id]} ${resumoFases[f.id] === 1 ? f.item.toLowerCase() : f.rotulo.toLowerCase()}`,
  );

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: "Orçamento" }, { label: "Orçamentos" }]}
        title="Orçamentos"
        description={
          <>
            <b className="font-semibold text-foreground tabular-nums">{linhas.length}</b>{" "}
            {linhas.length === 1 ? "orçamento" : "orçamentos"}
            {partesResumo.length > 0 && ` · ${partesResumo.join(" · ")}`}
          </>
        }
        actions={
          <Link
            href="/orcamento/demandas/nova"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Novo orçamento
          </Link>
        }
        help={
          <HelpTip title="Orçamentos">
            <p>O orçamento é o processo; a <b>proposta</b> é o documento emitido ao final para o cliente.</p>
            <p>Cada orçamento segue um caminho conforme a <b>modalidade</b>: só análises laboratoriais, só projeto, ou projeto com análises.</p>
          </HelpTip>
        }
      />

      <DemandasTable rows={linhasFiltradas} />
    </PageShell>
  );
}
