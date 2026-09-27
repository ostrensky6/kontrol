import Link from "next/link";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import {
  DemandaForm,
  type AnaliseCatalogoDemanda,
  type GrupoAmostraDemanda,
} from "@/components/orcamento/DemandaForm";
import { calcularTodas } from "@/lib/costing/loader";
import { createClient } from "@/lib/supabase/server";
import { calcularPrevisaoOperacionalDemanda } from "@/lib/orcamento/previsao-operacional";

export const dynamic = "force-dynamic";

export default async function NovaDemandaPage() {
  const supabase = await createClient();
  const [
    { data: clientes },
    { data: projetos },
    { data: analisesCatalogo },
    { data: etapasAnalises },
    { data: insumosAnalises },
    { data: saldoEstoque },
    { breakdowns },
    { data: matrizes },
  ] = await Promise.all([
    supabase.from("clientes").select("id, nome").eq("ativo", true).order("nome"),
    supabase.from("projetos").select("id, nome").order("nome"),
    supabase
      .from("analises")
      .select("codigo, nome, nome_simplificado, descricao, status, ativo")
      .eq("ativo", true)
      .eq("ofertavel", true)
      .order("codigo"),
    supabase
      .from("etapas")
      .select("codigo_analise, nome_etapa, nome_atividade, execucoes_por_dia, amostras_por_execucao"),
    (supabase as never as { from: (table: string) => { select: (columns: string) => Promise<{ data: Array<{
      codigo_analise: string;
      especificacao_insumo: string | null;
      nome_etapa: string | null;
      nome_atividade: string | null;
      grupo_escolha: string | null;
      unidade: string | null;
      quantidade_por_amostra: number | null;
      modo_cobranca: string | null;
      status_vinculo_insumo: string | null;
      insumo_id: number | null;
      insumos: { custo_unitario?: number | null } | null;
    }> | null }> } })
      .from("insumo_analise")
      .select("codigo_analise, nome_etapa, nome_atividade, especificacao_insumo, grupo_escolha, unidade, quantidade_por_amostra, modo_cobranca, status_vinculo_insumo, insumo_id, insumos(custo_unitario)"),
    (supabase as never as { from: (table: string) => { select: (columns: string) => Promise<{ data: Array<{ insumo_id: number; disponivel?: number | null }> | null }> } })
      .from("v_estoque_saldo")
      .select("insumo_id, disponivel"),
    calcularTodas(),
    // A matriz do grupo referencia o cadastro (FK): só códigos cadastrados.
    supabase.from("matrizes_amostras").select("codigo, nome").eq("ativo", true).order("nome"),
  ]);

  const quantidadeBase = 1;
  const analisesFormulario: AnaliseCatalogoDemanda[] = (analisesCatalogo ?? []).map((analise) => {
    const etapasDaAnalise = (etapasAnalises ?? []).filter((etapa) => etapa.codigo_analise === analise.codigo);
    const capacidades = etapasDaAnalise
      .map((etapa) => Number(etapa.execucoes_por_dia ?? 0) * Number(etapa.amostras_por_execucao ?? 0))
      .filter((capacidade) => capacidade > 0);
    const metodo = etapasDaAnalise[0]?.nome_etapa ?? etapasDaAnalise[0]?.nome_atividade ?? null;
    const unidade = (insumosAnalises ?? []).find((item) => item.codigo_analise === analise.codigo)?.unidade ?? "amostra";
    const previsaoBase = calcularPrevisaoOperacionalDemanda({
      analises: [{ codigo_analise: analise.codigo, quantidade_amostras: quantidadeBase }],
      etapas: etapasAnalises ?? [],
      insumos: insumosAnalises ?? [],
    })[0];
    return {
      codigo: analise.codigo,
      nome: analise.nome,
      nome_simplificado: analise.nome_simplificado,
      descricao: analise.descricao,
      status: analise.status ?? "Ativa",
      metodo,
      unidade,
      prazo_tecnico_dias: capacidades.length > 0 ? Math.max(1, Math.ceil(quantidadeBase / Math.min(...capacidades))) : null,
      matriz: null,
      custeio_disponivel: breakdowns.some((breakdown) => breakdown.codigo === analise.codigo && Number(breakdown.custoTotal) > 0),
      lote_padrao: previsaoBase?.lote_padrao ?? null,
      capacidade_dia: previsaoBase?.capacidade_dia ?? null,
      reagentes: (insumosAnalises ?? [])
        .filter((item) => item.codigo_analise === analise.codigo)
        .map((item) => {
          const saldo = (saldoEstoque ?? []).find((saldoItem) => Number(saldoItem.insumo_id) === Number(item.insumo_id));
          const disponivel = Number(saldo?.disponivel ?? 0);
          const custoUnitario = Number((item.insumos as { custo_unitario?: number | null } | null)?.custo_unitario ?? 0);
          return {
            especificacao: item.especificacao_insumo ?? "Insumo sem especificação",
            unidade: item.unidade ?? "un",
            quantidade_por_amostra: Number(item.quantidade_por_amostra ?? 0),
            custo_unitario: Number.isFinite(custoUnitario) ? custoUnitario : null,
            status_vinculo_insumo: item.status_vinculo_insumo,
            estoque_status: item.insumo_id == null ? "insumo não encontrado" : disponivel > 0 ? "suficiente" : "sem cadastro de saldo",
            modo_cobranca: item.modo_cobranca === "por_execucao" ? "por_execucao" as const : "por_amostra" as const,
          };
        })
        .filter((item) => item.quantidade_por_amostra > 0),
    };
  });

  const demandaNova = {
    id: 0,
    titulo: null,
    cliente_id: null,
    projeto_id: null,
    cliente_nome: null,
    cliente_cnpj: null,
    cliente_contato: null,
    instituicao: null,
    responsavel_interno: null,
    origem: null,
    data_solicitacao: null,
    prazo_esperado: null,
    matriz_amostra: null,
    quantidade_amostras_estimada: 1,
    prazo_tecnico_dias: null,
    modalidade: "analises",
    status: "nova",
    prioridade: "normal",
    descricao: null,
    escopo_preliminar: null,
    observacoes: null,
  };

  const gruposAmostras: GrupoAmostraDemanda[] = [{
    identificacao: "Grupo A",
    tipo_matriz: null,
    quantidade_amostras: 1,
    unidade: "amostras",
    observacao: null,
  }];

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Breadcrumbs
              items={[
                { label: "Orçamentos", href: "/orcamento/demandas" },
                { label: "Novo orçamento" },
              ]}
            />
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-400">
              Entrada comercial
            </p>
            <div className="mt-1 flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Novo orçamento</h1>
            </div>
          </div>
          <Link
            href="/orcamento/demandas"
            className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Voltar à lista
          </Link>
        </div>

        <section className="mt-6 rounded-lg border border-border bg-card p-4 shadow-sm">
          <DemandaForm
            demanda={demandaNova}
            clientes={(clientes ?? []) as { id: number; nome: string }[]}
            projetos={(projetos ?? []) as { id: number; nome: string }[]}
            analises={analisesFormulario}
            gruposAmostras={gruposAmostras}
            analisesSelecionadas={[]}
            matrizes={(matrizes ?? []) as { codigo: string; nome: string }[]}
            modo="completo"
          />
        </section>
      </main>
    </div>
  );
}
