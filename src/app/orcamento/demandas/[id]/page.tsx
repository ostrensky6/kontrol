import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import {
  emitirOrcamentoFinalDaDemanda,
  gerarOrcamentoAnalisesDaDemanda,
  gerarOrcamentoProjetoDaDemanda,
} from "@/lib/actions/demandas";
import { planejarModulosProposta, type PlanoModulo } from "@/lib/orcamento/garantir-modulos";
import { totalLaboratorioCusto, totalLaboratorioPreco } from "@/lib/orcamento/bases-custo";
import { avaliarCompletudeDemanda } from "@/lib/orcamento/demanda-completude";
import { avaliarModuloOperacional } from "@/lib/orcamento/modulo-status";
import { consolidarOrcamentoFinal, explicarOrigem } from "@/lib/orcamento/orcamento-final";
import { rotuloStatusModulo, rotuloStatusOrcamento, rotuloStatusVersaoFinal } from "@/lib/orcamento/rotulos-status";
import { OPCOES_INSTITUICAO, opcaoInstituicao } from "@/lib/orcamento/identidade-institucional";
import { HelpExample, HelpFormula, HelpTip } from "@/components/common/HelpTip";
import { PainelParametrosEconomicos } from "@/components/orcamento/PainelParametrosEconomicos";
import { SalvarDemandaForm } from "@/components/orcamento/SalvarDemandaForm";
import { EditorCustosProjeto } from "@/components/orcamento/projeto/EditorCustosProjeto";
import { EditorParametrosProposta } from "@/components/orcamento/EditorParametrosProposta";
import { podeOrcamento } from "@/lib/orcamento/governanca";
import { padroesDeParametrosGlobais, resolverParametrosProposta } from "@/lib/orcamento/parametros-proposta";
import { ConfirmSubmitButton } from "@/components/common/ConfirmSubmitButton";
import { formatCurrency as brl, formatDate, formatDateTime } from "@/lib/formatters";
import { TOM_ENTRADA } from "@/lib/orcamento/tom-valor";
import { montarEtapasProposta, ORDEM_ETAPAS, type EtapaId } from "@/lib/orcamento/etapas-proposta";
import {
  detectarCustosZero,
  montarComponentesTecnicos,
  reconciliarComposicao,
  statusPropostaFinal,
  LABEL_STATUS_FINAL,
  type StatusPropostaFinal,
} from "@/lib/orcamento/proposta-final";
import {
  modalidadeExigeLaboratorio,
  modalidadeExigeProjeto,
  normalizarModalidadeOrcamento,
} from "@/lib/orcamento/orcamento-economico";

export const dynamic = "force-dynamic";

// Rótulos de exibição. As modalidades legadas continuam mapeadas para leitura de
// dados antigos; a forma canônica `projeto_com_analises` é o destino normalizado.
const MODALIDADES: Record<string, string> = {
  analises: "Apenas análises laboratoriais",
  projeto: "Apenas projeto",
  projeto_com_analises: "Projeto com análises laboratoriais",
  analises_projeto: "Análises dentro de projeto",
  projeto_analises_custos: "Projeto com custos próprios e análises laboratoriais",
};

// Opções oferecidas em novos cadastros: apenas as três modalidades canônicas.
const MODALIDADES_SELECIONAVEIS: Array<[string, string]> = [
  ["analises", MODALIDADES.analises],
  ["projeto", MODALIDADES.projeto],
  ["projeto_com_analises", MODALIDADES.projeto_com_analises],
];

const STATUS_FINAL_CLS: Record<StatusPropostaFinal, string> = {
  bloqueada: "bg-danger-soft text-danger-strong",
  em_composicao: "bg-warning-soft text-warning-strong",
  aguardando_revisao: "bg-warning-soft text-warning-strong",
  pronta_para_emitir: "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300",
  emitida: "bg-success-soft text-success-strong",
  substituida: "bg-muted text-muted-foreground",
  cancelada: "bg-muted text-muted-foreground",
};

type OrcamentoAnalisesResumo = {
  id: number;
  status: string;
  data_orcamento: string | null;
  orcamento_itens?: { id: number; codigo_analise: string | null; n_amostras: number; custo_unitario: number; preco_unitario: number }[] | null;
};

type OrcamentoProjetoResumo = {
  id: number;
  status: string;
  data_orcamento: string | null;
  titulo: string | null;
  projeto_sem_custo_justificativa?: string | null;
  impostos: number | null;
  margem_lucro: number | null;
  impostos_legacy: number | null;
  incubacao: number | null;
  reserva: number | null;
  investimentos: number | null;
  lucro: number | null;
  orcamento_projeto_analises?: { id: number; n_amostras: number; custo_unitario: number; preco_unitario: number }[] | null;
  orcamento_projeto_custos?: {
    id: number;
    rubrica: string | null;
    quantidade: number;
    custo_unitario: number;
    preco_unitario: number;
    meses_selecionados: number[] | null;
  }[] | null;
};

export default async function DemandaDetalhe({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    erro_emissao?: string;
    etapa?: string;
    erro_integridade?: string;
    erro_parametros?: string;
    parametros_salvos?: string;
  }>;
}) {
  const { id } = await params;
  const {
    erro_emissao: erroEmissao,
    etapa: etapaParam,
    erro_integridade: erroIntegridade,
    erro_parametros: erroParametros,
    parametros_salvos: parametrosSalvos,
  } = await searchParams;
  const demandaId = Number(id);
  const supabase = await createClient();

  const { data: demanda } = await supabase
    .from("demandas_propostas")
    .select("*")
    .eq("id", demandaId)
    .single();
  if (!demanda) notFound();

  const [{ data: clientes }, { data: projetos }, { data: orcamentos }, { data: orcProjetos }, { data: versoesFinais }] =
    await Promise.all([
      supabase.from("clientes").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("projetos").select("id, nome").order("nome"),
      supabase
        .from("orcamentos")
        .select("id, status, data_orcamento, orcamento_itens(id, codigo_analise, n_amostras, custo_unitario, preco_unitario)")
        .eq("demanda_id", demandaId)
        .order("id"),
      supabase
        .from("orcamento_projetos")
        .select("id, status, data_orcamento, titulo, projeto_sem_custo_justificativa, impostos, margem_lucro, impostos_legacy, incubacao, reserva, investimentos, lucro, orcamento_projeto_analises(id, n_amostras, custo_unitario, preco_unitario), orcamento_projeto_custos(id, rubrica, quantidade, custo_unitario, preco_unitario, meses_selecionados)")
        .eq("demanda_id", demandaId)
        .order("id"),
      supabase
        .from("orcamento_final_versoes")
        .select("id, versao, numero, status, total_final, valido_ate, criado_em")
        .eq("demanda_id", demandaId)
        .order("versao", { ascending: false }),
    ]);

  const modalidadeCanonica = normalizarModalidadeOrcamento(demanda.modalidade);
  const exigeAnalises = modalidadeExigeLaboratorio(demanda.modalidade);
  const exigeProjeto = modalidadeExigeProjeto(demanda.modalidade) || Boolean(demanda.projeto_id);
  const completudeDemanda = avaliarCompletudeDemanda(demanda);
  // Todos os módulos aparecem nas listas; só os ativos (não cancelados) entram nos totais.
  const todosOrcamentosAnalises = ((orcamentos ?? []) as OrcamentoAnalisesResumo[]);
  const todosOrcamentosProjeto = ((orcProjetos ?? []) as OrcamentoProjetoResumo[]);
  const orcamentosAnalises = todosOrcamentosAnalises.filter((o) => o.status !== "cancelado");
  const orcamentosProjeto = todosOrcamentosProjeto.filter((o) => o.status !== "cancelado");
  const itensAnalises = orcamentosAnalises.reduce((total, orcamento) => total + (orcamento.orcamento_itens?.length ?? 0), 0);
  const itensProjeto = orcamentosProjeto.reduce((total, orcamento) => total + (
    (orcamento.orcamento_projeto_custos?.length ?? 0) +
    (orcamento.orcamento_projeto_analises?.length ?? 0) +
    (orcamento.projeto_sem_custo_justificativa ? 1 : 0)
  ), 0);
  const statusAnalises = orcamentosAnalises.some((orcamento) => orcamento.status === "aprovado")
    ? "aprovado"
    : orcamentosAnalises.some((orcamento) => orcamento.status === "enviado")
      ? "enviado"
      : orcamentosAnalises[0]?.status;
  const statusProjeto = orcamentosProjeto.some((orcamento) => orcamento.status === "aprovado")
    ? "aprovado"
    : orcamentosProjeto.some((orcamento) => orcamento.status === "enviado")
      ? "enviado"
      : orcamentosProjeto[0]?.status;
  const moduloAnalises = avaliarModuloOperacional({
    exigido: exigeAnalises,
    quantidadeItens: itensAnalises,
    statusDocumento: statusAnalises,
    pendenciaSemItens: "adicionar ao menos uma análise com custo",
  });
  const moduloProjeto = avaliarModuloOperacional({
    exigido: exigeProjeto,
    quantidadeItens: itensProjeto,
    statusDocumento: statusProjeto,
    pendenciaSemItens: "adicionar ao menos um custo, análise de projeto ou justificativa",
  });
  const projetoReferencia = orcamentosProjeto.at(-1);
  // com projeto: percentuais do projeto; sem projeto: os da proposta ou os padrões (0118)
  const { data: parametrosGlobais } = await supabase.from("parametros").select("chave, valor");
  const parametrosProposta = resolverParametrosProposta({
    projeto: projetoReferencia,
    proposta: demanda as Record<string, unknown>,
    padroes: padroesDeParametrosGlobais(parametrosGlobais),
  });
  const orcamentoFinal = consolidarOrcamentoFinal({
    laboratorioExigido: exigeAnalises,
    projetoExigido: exigeProjeto,
    laboratorioRevisado: moduloAnalises.status === "revisado" || moduloAnalises.status === "nao_exigido",
    projetoRevisado: moduloProjeto.status === "revisado" || moduloProjeto.status === "nao_exigido",
    itensLaboratorio: orcamentosAnalises.flatMap((orcamento) => orcamento.orcamento_itens ?? []),
    itensProjeto: [
      ...orcamentosProjeto.flatMap((orcamento) => (
        orcamento.orcamento_projeto_custos ?? []
      )),
      ...orcamentosProjeto.flatMap((orcamento) => (
        orcamento.orcamento_projeto_analises ?? []
      )).map((item) => ({
        rubrica: "MC",
        quantidade: Number(item.n_amostras),
        custo_unitario: Number(item.custo_unitario),
        preco_unitario: Number(item.preco_unitario),
        meses_selecionados: [],
      })),
    ],
    parametrosProjeto: parametrosProposta.rates,
  });
  const modulosPendentes = [
    moduloAnalises.status === "pendente" ? "preencher custos laboratoriais" : null,
    moduloAnalises.status === "preenchido" ? "revisar custos laboratoriais" : null,
    moduloProjeto.status === "pendente" ? "preencher custos de projeto" : null,
    moduloProjeto.status === "preenchido" ? "revisar custos de projeto" : null,
  ].filter(Boolean) as string[];
  const podeConsolidar = modulosPendentes.length === 0;
  const etapas = montarEtapasProposta({
    demandaId,
    modalidade: demanda.modalidade,
    projetoAssociado: Boolean(demanda.projeto_id),
    demandaCompleta: completudeDemanda.completa,
    demandaFaltante: completudeDemanda.faltante,
    laboratorioStatus: moduloAnalises.status === "nao_exigido" ? "nao_exigido" : moduloAnalises.status,
    laboratorioLabel: moduloAnalises.label,
    projetoStatus: moduloProjeto.status === "nao_exigido" ? "nao_exigido" : moduloProjeto.status,
    projetoLabel: moduloProjeto.label,
    parametrosLiberados: podeConsolidar,
    orcamentoFinalPronto: orcamentoFinal.pronto,
    versoesFinais: versoesFinais?.length ?? 0,
  });
  // §2.7/2.8: a query string ?etapa= controla a etapa exibida, na ordem fixa.
  const etapaSolicitada = ORDEM_ETAPAS.includes(etapaParam as EtapaId) ? (etapaParam as EtapaId) : "demanda";
  const etapaAtiva: EtapaId =
    etapas.find((etapa) => etapa.id === etapaSolicitada && etapa.aplicavel)?.id ?? "demanda";
  // Exibe somente a seção da etapa ativa (Fase 2.7). As demais permanecem no DOM
  // ocultas para preservar âncoras e submissões; o redesenho da etapa final em
  // visão própria é tratado na Fase 10.
  const passo = (id: EtapaId) => (etapaAtiva === id ? "" : "hidden");
  // Oferece as modalidades canônicas; preserva o valor legado atual da demanda
  // como opção selecionável para não forçar reescrita em saves não relacionados.
  const opcoesModalidade: Array<[string, string]> =
    demanda.modalidade && !MODALIDADES_SELECIONAVEIS.some(([value]) => value === demanda.modalidade)
      ? [[demanda.modalidade, MODALIDADES[demanda.modalidade] ?? demanda.modalidade], ...MODALIDADES_SELECIONAVEIS]
      : MODALIDADES_SELECIONAVEIS;

  // --- Proposta final (Fase 10): reconciliação, custo zero e status padronizado ---
  const itensLaboratorioFlat = orcamentosAnalises.flatMap((o) => o.orcamento_itens ?? []);
  const custosProjetoFlat = orcamentosProjeto.flatMap((o) => o.orcamento_projeto_custos ?? []);
  const analisesProjetoFlat = orcamentosProjeto.flatMap((o) => o.orcamento_projeto_analises ?? []);
  const projetoTemJustificativa = orcamentosProjeto.some((o) => Boolean(o.projeto_sem_custo_justificativa));
  const componentesTecnicos = montarComponentesTecnicos({
    itensLaboratorio: itensLaboratorioFlat,
    custosProjeto: custosProjetoFlat,
    analisesProjeto: analisesProjetoFlat,
  });
  const composicaoFinal = reconciliarComposicao({
    componentes: componentesTecnicos,
    totalFinal: orcamentoFinal.totalFinal,
  });
  const custosZero = detectarCustosZero({
    itensLaboratorio: itensLaboratorioFlat,
    custosProjeto: custosProjetoFlat,
    analisesProjeto: analisesProjetoFlat,
    projetoTemJustificativa,
  });
  const temCustoZeroSemJustificativa = custosZero.length > 0;
  const ultimaVersaoFinal = versoesFinais?.[0];
  const statusFinal: StatusPropostaFinal = statusPropostaFinal({
    demandaCompleta: completudeDemanda.completa,
    laboratorioExigido: exigeAnalises,
    projetoExigido: exigeProjeto,
    laboratorioStatus: moduloAnalises.status === "nao_exigido" ? "nao_exigido" : moduloAnalises.status,
    projetoStatus: moduloProjeto.status === "nao_exigido" ? "nao_exigido" : moduloProjeto.status,
    parametrosValidos: orcamentoFinal.economia.valido,
    temCustoZeroSemJustificativa,
    versoesEmitidas: versoesFinais?.length ?? 0,
    ultimaVersaoStatus: ultimaVersaoFinal?.status ?? null,
  });
  const [autorizadoEmitir, autorizadoParametros] = await Promise.all([
    podeOrcamento("emitir_final"),
    podeOrcamento("editar_parametros"),
  ]);
  const podeEmitir = orcamentoFinal.pronto && !temCustoZeroSemJustificativa;
  // Σ% = 0 (ex.: "Apenas análises", sem módulo de projeto para guardar parâmetros).
  const semParametros = orcamentoFinal.somaPercentual <= 0;
  const versaoEmitidaVigente = (versoesFinais ?? []).find((v) => v.status === "emitido");

  // --- Idempotência/UI dos módulos (Fase 5) ---
  const planoModulosUi = planejarModulosProposta({
    modalidade: demanda.modalidade,
    projetoAssociado: Boolean(demanda.projeto_id),
    laboratorioAtivos: orcamentosAnalises.filter((o) => o.status !== "cancelado").map((o) => o.id),
    projetoAtivos: orcamentosProjeto.filter((o) => o.status !== "cancelado").map((o) => o.id),
  });
  const pendenciasTabela = [
    {
      etapa: "Dados",
      obrigatoria: true,
      status: completudeDemanda.completa ? "Completo" : "Pendente",
      pendencia: completudeDemanda.completa ? "Concluída" : completudeDemanda.pendencias.join("; "),
      acao: `/orcamento/demandas/${demandaId}?etapa=demanda`,
    },
    {
      etapa: "Laboratório",
      obrigatoria: exigeAnalises,
      status: moduloAnalises.label,
      pendencia: moduloAnalises.pendencias.join("; "),
      acao: `/orcamento/demandas/${demandaId}?etapa=laboratorio`,
    },
    {
      etapa: "Projeto",
      obrigatoria: exigeProjeto,
      status: moduloProjeto.label,
      pendencia: moduloProjeto.pendencias.join("; "),
      acao: `/orcamento/demandas/${demandaId}?etapa=projeto`,
    },
    {
      etapa: "Parâmetros",
      obrigatoria: exigeProjeto,
      status: podeConsolidar ? "Liberado" : "Bloqueado",
      pendencia: podeConsolidar ? "custos revisados" : modulosPendentes.join("; "),
      acao: `/orcamento/demandas/${demandaId}?etapa=parametros`,
    },
    {
      etapa: "Proposta",
      obrigatoria: true,
      status: orcamentoFinal.pronto ? "Pronto" : "Bloqueado",
      pendencia: orcamentoFinal.pendencias.length > 0 ? orcamentoFinal.pendencias.join("; ") : "Pronto para emissão",
      acao: `/orcamento/demandas/${demandaId}?etapa=final`,
    },
  ];
  const itensLaboratorioRecebidos = orcamentosAnalises.flatMap((orcamento) => orcamento.orcamento_itens ?? []);
  const totalAnalisesCusto = totalLaboratorioCusto(itensLaboratorioRecebidos);
  const totalAnalisesPreco = totalLaboratorioPreco(itensLaboratorioRecebidos);

  // §8.2: valor digitado/escolhido pelo usuário aparece em azul (TOM_ENTRADA).
  const inp =
    `rounded-md border border-input bg-card px-3 py-2 text-sm font-medium ${TOM_ENTRADA}`;
  const lbl = "block text-xs font-medium text-muted-foreground";
  const hydrationSafe = { suppressHydrationWarning: true } as const;
  const operacaoEmissaoId = randomUUID();

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <Breadcrumbs
          items={[
            { label: "Orçamentos", href: "/orcamento/demandas" },
            { label: demanda.titulo },
          ]}
        />

        <section className="mt-4 rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-400">
                Orçamento
              </p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight">{demanda.titulo}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {MODALIDADES[modalidadeCanonica] ?? MODALIDADES[demanda.modalidade] ?? demanda.modalidade}
              </p>
            </div>
            <div className="text-right text-sm">
              <p className="font-medium">Nº {demanda.id}</p>
              <p className="text-muted-foreground">Status: {rotuloStatusOrcamento(demanda.status)}</p>
              <p className="text-muted-foreground">Prioridade: {demanda.prioridade}</p>
              <p className={`flex items-center justify-end gap-1 ${completudeDemanda.completa ? "text-brand-700 dark:text-brand-300" : "text-warning-strong"}`}>
                {completudeDemanda.completa ? "Dados completos" : `${completudeDemanda.faltante}% faltante`}
                <HelpTip title="Completude dos dados" align="end">
                  <p>Parte dos <b>dados obrigatórios</b> do orçamento que ainda falta preencher (título, cliente, escopo e, conforme a modalidade, projeto e amostras).</p>
                  <p>Os módulos de custo só são liberados com <b>0% faltante</b>.</p>
                </HelpTip>
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-4 2xl:grid-cols-6">
            <Info titulo="Cliente" texto={demanda.cliente_nome} />
            <Info titulo="Contato" texto={demanda.cliente_contato} />
            <Info titulo="Solicitação" texto={formatDate(demanda.data_solicitacao)} />
            <Info titulo="Prazo esperado" texto={formatDate(demanda.prazo_esperado)} />
            <Info titulo="Matriz/amostra" texto={demanda.matriz_amostra} />
            <Info titulo="Qtd. estimada" texto={demanda.quantidade_amostras_estimada ? String(demanda.quantidade_amostras_estimada) : null} />
            <Info titulo="Prazo técnico" texto={demanda.prazo_tecnico_dias ? `${demanda.prazo_tecnico_dias} dias` : null} />
            <Info titulo="Completude atualizada" texto={formatDateTime(demanda.completude_atualizada_em)} />
          </div>

          <div className="mt-6 grid gap-4 text-sm md:grid-cols-3">
            <Texto titulo="Descrição" texto={demanda.descricao} />
            <Texto titulo="Escopo preliminar" texto={demanda.escopo_preliminar} />
            <Texto titulo="Observações" texto={demanda.observacoes} />
          </div>
        </section>

        <nav className="sticky top-[57px] z-10 mt-4 overflow-x-auto md:top-0 border-y border-border bg-card/95 py-2 shadow-sm backdrop-blur">
          <div className="flex min-w-max gap-2 px-2">
            {etapas.map((etapa, indice) => {
              const ativa = etapa.id === etapaAtiva;
              const desabilitada = !etapa.aplicavel;
              return (
                <a
                  key={etapa.id}
                  href={etapa.href}
                  aria-current={ativa ? "step" : undefined}
                  aria-disabled={desabilitada || undefined}
                  className={`rounded-md border px-3 py-2 text-left text-xs transition hover:bg-muted ${
                    ativa
                      ? "border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-500 dark:bg-brand-950/40 dark:text-brand-200"
                      : desabilitada
                        ? "border-border text-muted-foreground/80"
                        : "border-input text-foreground"
                  }`}
                >
                  <span className="block font-semibold">
                    {indice + 1}. {etapa.label}
                  </span>
                  <span className="mt-0.5 block text-[10px] uppercase tracking-wide">
                    {etapa.aplicavel ? etapa.status : "Não se aplica"}
                  </span>
                </a>
              );
            })}
          </div>
        </nav>

        <section id="acoes" className={`mt-6 scroll-mt-20 grid gap-4 lg:grid-cols-3 2xl:grid-cols-4 ${passo("demanda")}`}>
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold">Próximos módulos</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              A modalidade do orçamento controla quais módulos podem ser preenchidos.
            </p>
            {!completudeDemanda.completa && (
              <div className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-xs leading-5 text-warning-strong">
                Complete os dados antes de gerar módulos: {completudeDemanda.pendencias.join("; ")}.
              </div>
            )}
            {(planoModulosUi.bloqueadoPorDuplicidade || erroIntegridade) && (
              <div className="mt-3 rounded-md border border-danger-strong/30 bg-danger-soft px-3 py-2 text-xs leading-5 text-danger-strong">
                <p className="font-medium">Integridade comprometida</p>
                {erroIntegridade && <p>{erroIntegridade}</p>}
                {planoModulosUi.erros.map((e) => (
                  <p key={e}>{e}</p>
                ))}
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <ModuloAcao
                plano={planoModulosUi.laboratorio}
                rotulo="laboratorial"
                demandaCompleta={completudeDemanda.completa}
                demandaId={demandaId}
                acaoCriar={gerarOrcamentoAnalisesDaDemanda}
                hrefBase="/orcamento"
              />
              <ModuloAcao
                plano={planoModulosUi.projeto}
                rotulo="de projeto"
                demandaCompleta={completudeDemanda.completa}
                demandaId={demandaId}
                acaoCriar={gerarOrcamentoProjetoDaDemanda}
                hrefBase={`/orcamento/demandas/${demandaId}`}
                hrefAbrir={`/orcamento/demandas/${demandaId}?etapa=projeto`}
                rotuloAbrir="Editar custos do projeto"
              />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold">Custos vinculados</h2>
            <div className="mt-3 space-y-2 text-sm">
              {todosOrcamentosAnalises.map((o) => (
                <Link key={o.id} href={`/orcamento/${o.id}`} className="block rounded-md bg-muted/50 px-3 py-2 hover:bg-muted">
                  Laboratório #{o.id} · {rotuloStatusModulo(o.status)} · {(o.orcamento_itens?.length ?? 0)} item(ns)
                </Link>
              ))}
              {todosOrcamentosProjeto.map((o) => (
                <Link key={o.id} href={`/orcamento/demandas/${demandaId}?etapa=projeto`} className="block rounded-md bg-muted/50 px-3 py-2 hover:bg-muted">
                  Projeto #{o.id} · {rotuloStatusModulo(o.status)} · {(o.orcamento_projeto_custos?.length ?? 0) + (o.orcamento_projeto_analises?.length ?? 0)} item(ns)
                </Link>
              ))}
              {todosOrcamentosAnalises.length === 0 && todosOrcamentosProjeto.length === 0 && (
                <p className="text-xs text-muted-foreground/80">Nenhum custo gerado a partir deste orçamento.</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold">Fluxo recomendado</h2>
            <ol className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
              <li>1. Registrar os dados do orçamento.</li>
              <li>2. Confirmar modalidade e projeto.</li>
              <li>3. Gerar o custo correto.</li>
              <li>4. Planejar a execução e reservar estoque quando aprovado.</li>
            </ol>
          </div>
        </section>

        <section id="laboratorio" className={`mt-6 scroll-mt-20 rounded-lg border border-border bg-card p-4 shadow-sm ${passo("laboratorio")}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-1">
                <h2 className="text-sm font-semibold">Orçamento laboratorial</h2>
                <HelpTip title="Custo × preço recebidos">
                  <p>O <b>custo</b> das análises é o que entra na proposta. O <b>preço</b> é o de tabela, mostrado só como referência.</p>
                </HelpTip>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Custos de análises gerados a partir deste orçamento.
              </p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClasse(moduloAnalises.status)}`}>
              {exigeAnalises ? `${moduloAnalises.label} · ${moduloAnalises.faltante}% faltante` : "Não se aplica"}
            </span>
          </div>

          {!exigeAnalises ? (
            <div className="mt-4 rounded-md bg-muted/50 px-3 py-4 text-sm text-muted-foreground">
              Esta modalidade não exige orçamento laboratorial.
            </div>
          ) : (
            <>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <Info titulo="Orçamentos" texto={String(todosOrcamentosAnalises.length)} />
                <Info titulo="Itens laboratoriais" texto={String(itensAnalises)} />
                <Info titulo="Custo recebido" texto={brl(totalAnalisesCusto)} />
                <Info titulo="Preço recebido" texto={brl(totalAnalisesPreco)} />
              </div>
              <TabelaSimples
                colunas={["Orçamento", "Status", "Data", "Itens", "Custo", "Preço", "Ação"]}
                vazio="Nenhum orçamento laboratorial gerado."
                linhas={todosOrcamentosAnalises.map((orcamento) => {
                  const custo = totalLaboratorioCusto(orcamento.orcamento_itens ?? []);
                  const preco = totalLaboratorioPreco(orcamento.orcamento_itens ?? []);
                  return [
                    `#${orcamento.id}`,
                    rotuloStatusModulo(orcamento.status),
                    formatDate(orcamento.data_orcamento),
                    String(orcamento.orcamento_itens?.length ?? 0),
                    brl(custo),
                    brl(preco),
                    <Link key={orcamento.id} href={`/orcamento/${orcamento.id}`} className="font-medium text-primary hover:underline">
                      Abrir
                    </Link>,
                  ];
                })}
              />
            </>
          )}
        </section>

        <section id="projeto" className={`mt-6 scroll-mt-20 rounded-lg border border-border bg-card p-4 shadow-sm ${passo("projeto")}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-1">
              <h2 className="text-sm font-semibold">Custos do projeto</h2>
              <HelpTip title="Custos do projeto">
                <p>Rubricas, pessoal por mês, viagens e análises do projeto, sempre em <b>custo técnico</b>.</p>
                <p>Impostos, taxas e lucro entram só na etapa seguinte, de <b>parâmetros econômicos</b>.</p>
              </HelpTip>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClasse(moduloProjeto.status)}`}>
              {exigeProjeto ? `${moduloProjeto.label} · ${moduloProjeto.faltante}% faltante` : "Não se aplica"}
            </span>
          </div>

          {!exigeProjeto ? (
            <div className="mt-4 rounded-md bg-muted/50 px-3 py-4 text-sm text-muted-foreground">
              Esta modalidade não exige orçamento de projeto.
            </div>
          ) : planoModulosUi.projeto.acao === "abrir" && planoModulosUi.projeto.moduloId ? (
            // O editor só consulta o banco quando a etapa está aberta.
            etapaAtiva === "projeto" && (
              <EditorCustosProjeto orcamentoProjetoId={planoModulosUi.projeto.moduloId} demandaId={demandaId} />
            )
          ) : planoModulosUi.projeto.acao === "bloqueado" ? (
            <p role="alert" className="mt-4 rounded-md border border-danger-strong/30 bg-danger-soft px-3 py-2 text-xs leading-5 text-danger-strong">
              {planoModulosUi.erros.join(" ")}
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md bg-muted/50 px-3 py-4 text-sm text-muted-foreground">
              <span>Nenhum orçamento de projeto ativo nesta proposta.</span>
              <ModuloAcao
                plano={planoModulosUi.projeto}
                rotulo="de projeto"
                demandaCompleta={completudeDemanda.completa}
                demandaId={demandaId}
                acaoCriar={gerarOrcamentoProjetoDaDemanda}
                hrefBase={`/orcamento/demandas/${demandaId}`}
                hrefAbrir={`/orcamento/demandas/${demandaId}?etapa=projeto`}
              />
            </div>
          )}
        </section>

        <section className={`mt-6 rounded-lg border border-border bg-card p-4 shadow-sm ${passo("demanda")}`}>
          <h2 className="text-sm font-semibold">Pendências por etapa</h2>
          <TabelaSimples
            colunas={["Etapa", "Obrigatório?", "Status", "Pendência", "Ação"]}
            vazio="Sem pendências operacionais."
            linhas={pendenciasTabela.map((item) => [
              item.etapa,
              item.obrigatoria ? "Sim" : "Não",
              item.status,
              item.pendencia,
              <a key={item.etapa} href={item.acao} className="font-medium text-primary hover:underline">
                Ir para etapa
              </a>,
            ])}
          />
        </section>

        <section id="parametros" className={`mt-6 scroll-mt-20 rounded-lg border border-border bg-card p-4 shadow-sm ${passo("parametros")}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Parâmetros econômicos</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Leitura dos custos recebidos e dos percentuais usados na consolidação final.
              </p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${podeConsolidar ? "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300" : "bg-warning-soft text-warning-strong"}`}>
              {podeConsolidar ? "Liberado" : "Aguardando revisão"}
            </span>
          </div>
          <PainelParametrosEconomicos
            custoLaboratorio={orcamentoFinal.totalLaboratorioCusto}
            precoLaboratorio={orcamentoFinal.totalLaboratorioPreco}
            custoProjeto={orcamentoFinal.totalProjetoCusto}
            subtotalTecnico={orcamentoFinal.subtotalTecnico}
            totalParametros={orcamentoFinal.totalParametros}
            totalFinal={orcamentoFinal.totalFinal}
            parametros={orcamentoFinal.parametrosProjeto}
            alertas={orcamentoFinal.alertas}
          />
          <EditorParametrosProposta
            key={JSON.stringify(parametrosProposta.rates)}
            demandaId={demandaId}
            custoLaboratorio={orcamentoFinal.totalLaboratorioCusto}
            custoProjeto={orcamentoFinal.totalProjetoCusto}
            valores={parametrosProposta.rates}
            origem={parametrosProposta.origem}
            erro={erroParametros}
            salvo={parametrosSalvos === "1"}
            podeEditar={autorizadoParametros}
          />
          <TabelaSimples
            colunas={["Campo", "Como é calculado", "Valor"]}
            vazio="Sem fórmulas calculadas."
            linhas={orcamentoFinal.origens.map((origem) => [
              origem.titulo,
              explicarOrigem(origem),
              brl(origem.valor),
            ])}
          />
        </section>

        <section id="final" className={`mt-6 scroll-mt-20 space-y-4 ${passo("final")}`}>
          {/* A — Cabeçalho da proposta + ações */}
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-400">
                  Proposta final · Nº {demanda.id}
                </p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight">{demanda.titulo}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {demanda.cliente_nome || "Cliente livre"} · {MODALIDADES[modalidadeCanonica] ?? demanda.modalidade}
                  {versaoEmitidaVigente?.valido_ate ? ` · válida até ${formatDate(versaoEmitidaVigente.valido_ate)}` : ""}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_FINAL_CLS[statusFinal]}`}>
                {LABEL_STATUS_FINAL[statusFinal]}
              </span>
            </div>

            {/* Total final acima da dobra */}
            <div className="mt-4 flex flex-wrap items-end justify-between gap-4 rounded-md border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-900 dark:bg-brand-950/30">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-brand-700 dark:text-brand-300">Total final</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-brand-800 dark:text-brand-200">{brl(orcamentoFinal.totalFinal)}</p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                {versaoEmitidaVigente && (
                  <Link
                    href={`/orcamento/final/${versaoEmitidaVigente.id}`}
                    className="rounded-md border border-input bg-card px-3 py-2 text-xs font-medium hover:bg-muted"
                  >
                    Abrir versão emitida ({versaoEmitidaVigente.numero})
                  </Link>
                )}
                {!autorizadoEmitir ? (
                  <p className="text-xs text-muted-foreground">
                    A emissão é feita por coordenador ou superior, ou por quem tem a permissão “Orçamentos: Emitir proposta”.
                  </p>
                ) : (
                <form action={emitirOrcamentoFinalDaDemanda} className="flex flex-wrap items-end gap-2">
                  <input {...hydrationSafe} type="hidden" name="demanda_id" value={demandaId} />
                  <input {...hydrationSafe} type="hidden" name="operacao_id" value={operacaoEmissaoId} />
                  {podeEmitir && semParametros && (
                    // Sem parâmetros o total = custo técnico; exige confirmação explícita (validada também no servidor).
                    <label className="flex w-full items-center gap-2 rounded-md border border-warning-strong/30 bg-warning-soft px-3 py-2 text-xs font-medium text-warning-strong">
                      <input {...hydrationSafe} type="checkbox" name="confirmar_sem_parametros" value="sim" required className="h-4 w-4" />
                      Sem impostos, taxas nem lucro: emitir pelo custo técnico.
                    </label>
                  )}
                  <div>
                    <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">Validade (dias)</label>
                    <input {...hydrationSafe} name="validade_dias" type="number" min="1" step="1" defaultValue="30" className={`${inp} mt-1 w-24`} disabled={!podeEmitir} />
                  </div>
                  <ConfirmSubmitButton
                    className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground dark:disabled:bg-muted"
                    disabled={!podeEmitir}
                    titulo="Emitir versão final?"
                    mensagem={`Proposta nº ${demanda.id}, total ${brl(orcamentoFinal.totalFinal)}. A versão emitida recebe um número e não pode ser alterada depois.`}
                    confirmLabel="Emitir"
                  >
                    Emitir versão final
                  </ConfirmSubmitButton>
                </form>
                )}
              </div>
            </div>
            {!podeEmitir && (
              <p className="mt-2 text-right text-xs text-warning-strong">
                Emissão bloqueada:{" "}
                {(() => {
                  const n = orcamentoFinal.pendencias.length + (temCustoZeroSemJustificativa ? 1 : 0);
                  return `${n} ${n === 1 ? "pendência" : "pendências"}`;
                })()}{" "}
                — <a href="#bloqueios-emissao" className="font-medium underline">ver</a>
              </p>
            )}
            {erroEmissao && (
              <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger-strong">{erroEmissao}</p>
            )}
          </div>

          {/* B — Resumo executivo */}
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-1">
              <h3 className="text-sm font-semibold">Resumo executivo</h3>
              <HelpTip title="Resumo executivo">
                <p>O <b>subtotal técnico</b> soma os custos do laboratório e do projeto. O <b>total de parâmetros</b> é o que impostos, taxas e lucro acrescentam.</p>
                <HelpExample>Subtotal de R$ 1.000 + parâmetros de R$ 333,33 = total final de R$ 1.333,33.</HelpExample>
              </HelpTip>
            </div>
            <div className={`mt-3 grid gap-3 ${exigeProjeto ? "md:grid-cols-5" : "md:grid-cols-4"}`}>
              <ResumoFinal titulo="Custo laboratório (técnico)" valor={orcamentoFinal.totalLaboratorioCusto} />
              {exigeProjeto && <ResumoFinal titulo="Custo direto projeto" valor={orcamentoFinal.totalProjetoCusto} />}
              <ResumoFinal titulo="Subtotal técnico" valor={orcamentoFinal.subtotalTecnico} />
              <ResumoFinal titulo="Total de parâmetros" valor={orcamentoFinal.totalParametros} />
              <ResumoFinal titulo="Total final" valor={orcamentoFinal.totalFinal} destaque />
            </div>
          </div>

          {/* C — Resumo econômico */}
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-1">
              <h3 className="text-sm font-semibold">Resumo econômico</h3>
              <HelpTip title="Gross-up">
                <p>Impostos, taxas e lucro são percentuais do <b>preço final</b>, não do custo. Por isso o custo é dividido por 1 menos a soma dos percentuais; o resultado dessa conta é o <b>fator de gross-up</b>.</p>
                <HelpFormula>total = custo ÷ (1 − soma dos %)</HelpFormula>
                <HelpExample>Custo de R$ 1.000 e parâmetros somando 25%: fator 1 ÷ 0,75 = 1,3333 → total de R$ 1.333,33.</HelpExample>
              </HelpTip>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <Info titulo="Subtotal técnico" texto={brl(orcamentoFinal.subtotalTecnico)} />
              <Info titulo="Soma dos parâmetros" texto={`${orcamentoFinal.somaPercentual.toLocaleString("pt-BR")}%`} />
              <Info titulo="Fator de gross-up" texto={orcamentoFinal.fatorGrossUp.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} />
            </div>
            {orcamentoFinal.parametrosProjeto.length > 0 && (
              <TabelaSimples
                colunas={["Parâmetro", "Percentual", "Valor nominal"]}
                vazio="Sem parâmetros."
                linhas={orcamentoFinal.parametrosProjeto.map((p) => [
                  p.label,
                  `${p.nominalRate.toLocaleString("pt-BR")}%`,
                  brl(p.amount),
                ])}
              />
            )}
          </div>

          {/* F — Pendências e bloqueios */}
          {(orcamentoFinal.pendencias.length > 0 || temCustoZeroSemJustificativa || !composicaoFinal.reconciliaOk) && (
            <div id="bloqueios-emissao" className="scroll-mt-24 rounded-lg border border-warning-strong/30 bg-warning-soft p-4">
              <h3 className="text-sm font-semibold text-warning-strong">Pendências e bloqueios</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-warning-strong">
                {orcamentoFinal.pendencias.map((p) => (
                  <li key={p}>{p}</li>
                ))}
                {temCustoZeroSemJustificativa && (
                  <li>
                    Itens com custo técnico zero (sem justificativa de isenção):{" "}
                    {custosZero.map((c) => c.descricao).join(", ")}. Emissão bloqueada.
                  </li>
                )}
                {!composicaoFinal.reconciliaOk && (
                  <li>Divergência de reconciliação entre composição e total final — revisar itens.</li>
                )}
              </ul>
            </div>
          )}

          {/* D — Composição da proposta (reconciliada) */}
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <h3 className="text-sm font-semibold">Composição da proposta</h3>
                <HelpTip title="Valor comercial">
                  <p>O total final é repartido entre os itens conforme a <b>participação</b> de cada um no custo técnico. A soma das linhas sempre fecha com o total.</p>
                  <HelpFormula>valor comercial = total final × participação</HelpFormula>
                  <HelpExample>Item com 30% do custo e total de R$ 1.500 → R$ 450.</HelpExample>
                </HelpTip>
              </div>
              <span className={`text-[11px] ${composicaoFinal.reconciliaOk ? "text-muted-foreground/80" : "font-medium text-warning-strong"}`}>
                {composicaoFinal.reconciliaOk ? "Soma confere" : "Soma divergente"}
              </span>
            </div>
            {composicaoFinal.linhas.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground/80">Nenhum componente com valor positivo para compor a proposta.</p>
            ) : (
              <TabelaSimples
                colunas={["Componente", "Descrição", "Qtd", "Custo unit. téc.", "Subtotal téc.", "Participação", "Valor comercial", "Obs."]}
                vazio="Sem componentes."
                linhas={composicaoFinal.linhas.map((l) => [
                  l.componente,
                  l.descricao,
                  String(l.quantidade),
                  brl(l.custoUnitarioTecnico),
                  brl(l.subtotalTecnico),
                  `${(l.participacao * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
                  brl(l.valorComercial),
                  l.observacao ?? "—",
                ])}
              />
            )}
          </div>

          {/* E — Itens detalhados (custo técnico × preço snapshot), expansível */}
          <details className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <summary className="cursor-pointer text-sm font-semibold">Detalhamento interno (custo técnico × preço de referência)</summary>
            <div className="mt-3 space-y-4">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                Só o custo técnico entra no total.
                <HelpTip title="Custo técnico × preço de referência">
                  <p>O <b>custo técnico</b> (insumos, horas e overhead) é a base da proposta. O <b>preço de referência</b> da tabela de análises aparece só para comparação.</p>
                  <HelpExample>Custo de R$ 80 e preço de tabela de R$ 120: a proposta parte dos R$ 80 e acrescenta os parâmetros.</HelpExample>
                </HelpTip>
              </p>
              {exigeAnalises && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Laboratório</p>
                  <TabelaSimples
                    colunas={["Análise", "Amostras", "Custo unit. (técnico)", "Preço unit. (referência)", "Custo total"]}
                    vazio="Sem itens laboratoriais."
                    linhas={itensLaboratorioFlat.map((item, i) => [
                      item.codigo_analise ?? `Item ${i + 1}`,
                      String(item.n_amostras ?? 0),
                      brl(Number(item.custo_unitario ?? 0)),
                      brl(Number(item.preco_unitario ?? 0)),
                      brl(Number(item.custo_unitario ?? 0) * Number(item.n_amostras ?? 0)),
                    ])}
                  />
                </div>
              )}
              {exigeProjeto && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Projeto</p>
                  <TabelaSimples
                    colunas={["Rubrica", "Quantidade", "Custo unit. (técnico)", "Custo total"]}
                    vazio="Sem custos de projeto."
                    linhas={custosProjetoFlat.map((item, i) => [
                      item.rubrica ?? `Item ${i + 1}`,
                      String(
                        item.rubrica === "PE" && (item.meses_selecionados?.length ?? 0) > 0
                          ? item.meses_selecionados!.length
                          : item.quantidade ?? 0,
                      ),
                      brl(Number(item.custo_unitario ?? 0)),
                      brl(
                        (item.rubrica === "PE" && (item.meses_selecionados?.length ?? 0) > 0
                          ? item.meses_selecionados!.length
                          : Number(item.quantidade ?? 0)) * Number(item.custo_unitario ?? 0),
                      ),
                    ])}
                  />
                </div>
              )}
            </div>
          </details>

          {/* G — Histórico resumido */}
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <h3 className="text-sm font-semibold">Histórico de versões</h3>
                <HelpTip title="Versões emitidas">
                  <p>Cada versão guarda os <b>valores do dia da emissão</b>. Mudanças posteriores em custos ou parâmetros não alteram versões já emitidas.</p>
                </HelpTip>
              </div>
              <span className="text-xs text-muted-foreground/80">{versoesFinais?.length ?? 0} versão(ões)</span>
            </div>
            <div className="mt-3 divide-y divide-border/70 text-sm">
              {(versoesFinais ?? []).map((versao) => (
                <div key={versao.id} className="grid items-center gap-2 px-1 py-2 md:grid-cols-5">
                  <Link href={`/orcamento/final/${versao.id}`} className="font-medium text-primary hover:underline">
                    {versao.numero}
                  </Link>
                  <span>v{versao.versao}</span>
                  <span>{rotuloStatusVersaoFinal(versao.status)}</span>
                  <span>{versao.valido_ate ? `válida até ${formatDate(versao.valido_ate)}` : "sem validade"}</span>
                  <span className="font-semibold tabular-nums md:text-right">{brl(Number(versao.total_final ?? 0))}</span>
                </div>
              ))}
              {(versoesFinais ?? []).length === 0 && (
                <p className="px-1 py-4 text-xs text-muted-foreground/80">Nenhuma versão final emitida.</p>
              )}
            </div>
          </div>
        </section>

        <section id="demanda" className={`mt-6 scroll-mt-20 rounded-lg border border-border bg-card p-4 shadow-sm ${passo("demanda")}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Dados do orçamento</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Identificação, classificação e escopo inicial que liberam os módulos seguintes.
              </p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${completudeDemanda.completa ? "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300" : "bg-warning-soft text-warning-strong"}`}>
              {completudeDemanda.completa ? "Completa" : `${completudeDemanda.faltante}% faltante`}
            </span>
          </div>
          <SalvarDemandaForm>
            <input {...hydrationSafe} type="hidden" name="demanda_id" value={demandaId} />
            <div className="sm:col-span-2">
              <label className={lbl}>Título</label>
              <input {...hydrationSafe} name="titulo" defaultValue={demanda.titulo ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
            <div>
              <label className={lbl}>Cliente cadastrado</label>
              <select {...hydrationSafe} name="cliente_id" defaultValue={demanda.cliente_id ?? ""} className={`${inp} mt-1 w-full`}>
                <option value="">Sem cadastro</option>
                {(clientes ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={lbl}>Projeto</label>
              <select {...hydrationSafe} name="projeto_id" defaultValue={demanda.projeto_id ?? ""} className={`${inp} mt-1 w-full`}>
                <option value="">—</option>
                {(projetos ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={lbl}>Nome do cliente</label>
              <input {...hydrationSafe} name="cliente_nome" defaultValue={demanda.cliente_nome ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
            <div>
              <label className={lbl}>CNPJ/CPF</label>
              <input {...hydrationSafe} name="cliente_cnpj" defaultValue={demanda.cliente_cnpj ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
            <div>
              <label className={lbl}>Contato</label>
              <input {...hydrationSafe} name="cliente_contato" defaultValue={demanda.cliente_contato ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
            <div>
              <label htmlFor="orcamento-instituicao" className={lbl}>Instituição emissora (cabeçalho da proposta)</label>
              <select {...hydrationSafe} id="orcamento-instituicao" name="instituicao" defaultValue={opcaoInstituicao(demanda.instituicao)} className={`${inp} mt-1 w-full`}>
                <option value="">Escolha…</option>
                {OPCOES_INSTITUICAO.map((opcao) => <option key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Responsável interno</label>
              <input {...hydrationSafe} name="responsavel_interno" defaultValue={demanda.responsavel_interno ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
            <div>
              <label className={lbl}>Origem</label>
              <input {...hydrationSafe} name="origem" defaultValue={demanda.origem ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
            <div>
              <label className={lbl}>Data da solicitação</label>
              <input {...hydrationSafe} name="data_solicitacao" type="date" defaultValue={demanda.data_solicitacao ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
            <div>
              <label className={lbl}>Prazo esperado</label>
              <input {...hydrationSafe} name="prazo_esperado" type="date" defaultValue={demanda.prazo_esperado ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
            <div>
              <label className={lbl}>Matriz ou tipo de amostra</label>
              <input {...hydrationSafe} name="matriz_amostra" defaultValue={demanda.matriz_amostra ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
            <div>
              <label className={lbl}>Quantidade estimada de amostras</label>
              <input {...hydrationSafe} name="quantidade_amostras_estimada" type="number" min="1" step="1" defaultValue={demanda.quantidade_amostras_estimada ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
            <div>
              <label className={lbl}>Prazo técnico estimado (dias)</label>
              <input {...hydrationSafe} name="prazo_tecnico_dias" type="number" min="1" step="1" defaultValue={demanda.prazo_tecnico_dias ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
            <div>
              <label className={lbl}>Modalidade</label>
              <select {...hydrationSafe} name="modalidade" defaultValue={demanda.modalidade ?? "analises"} className={`${inp} mt-1 w-full`}>
                {opcoesModalidade.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <p className={lbl}>Situação</p>
              <p className="mt-1 text-sm font-medium">{rotuloStatusOrcamento(demanda.status)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground/80">Muda sozinha: emitir a proposta, aprovar ou cancelar.</p>
            </div>
            <div>
              <label className={lbl}>Prioridade</label>
              <select {...hydrationSafe} name="prioridade" defaultValue={demanda.prioridade ?? "normal"} className={`${inp} mt-1 w-full`}>
                <option value="baixa">Baixa</option>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
            <div>
              <label className={lbl}>Descrição</label>
              <textarea {...hydrationSafe} name="descricao" rows={4} defaultValue={demanda.descricao ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
            <div>
              <label className={lbl}>Escopo preliminar</label>
              <textarea {...hydrationSafe} name="escopo_preliminar" rows={4} defaultValue={demanda.escopo_preliminar ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
            <div className="sm:col-span-2">
              <label className={lbl}>Observações</label>
              <textarea {...hydrationSafe} name="observacoes" rows={3} defaultValue={demanda.observacoes ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
          </SalvarDemandaForm>
        </section>

        <section id="historico" className={`mt-6 scroll-mt-20 rounded-lg border border-border bg-card p-4 shadow-sm ${passo("historico")}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-1">
              <h2 className="text-sm font-semibold">Histórico e auditoria</h2>
              <HelpTip title="Histórico e auditoria">
                <p>Todos os registros ligados a este orçamento: módulos de custo, <b>inclusive os cancelados</b>, e propostas emitidas.</p>
              </HelpTip>
            </div>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {(versoesFinais?.length ?? 0) + todosOrcamentosAnalises.length + todosOrcamentosProjeto.length} registro(s)
            </span>
          </div>

          <TabelaSimples
            colunas={["Registro", "Tipo", "Status", "Quando", "Valor/Itens"]}
            vazio="Nenhum registro operacional vinculado."
            linhas={[
              [
                `Orçamento #${demanda.id}`,
                "Orçamento",
                rotuloStatusOrcamento(demanda.status),
                formatDateTime(demanda.completude_atualizada_em),
                completudeDemanda.completa ? "completa" : `${completudeDemanda.faltante}% faltante`,
              ],
              ...todosOrcamentosAnalises.map((orcamento) => [
                `Laboratório #${orcamento.id}`,
                "Custos laboratoriais",
                rotuloStatusModulo(orcamento.status),
                formatDate(orcamento.data_orcamento),
                `${orcamento.orcamento_itens?.length ?? 0} item(ns)`,
              ]),
              ...todosOrcamentosProjeto.map((orcamento) => [
                orcamento.titulo || `Projeto #${orcamento.id}`,
                "Custos de projeto",
                rotuloStatusModulo(orcamento.status),
                formatDate(orcamento.data_orcamento),
                `${(orcamento.orcamento_projeto_custos?.length ?? 0) + (orcamento.orcamento_projeto_analises?.length ?? 0)} item(ns)`,
              ]),
              ...(versoesFinais ?? []).map((versao) => [
                versao.numero,
                "Orçamento final",
                rotuloStatusVersaoFinal(versao.status),
                formatDateTime(versao.criado_em),
                brl(Number(versao.total_final ?? 0)),
              ]),
            ]}
          />
        </section>
      </main>
    </div>
  );
}

function ModuloAcao({
  plano,
  rotulo,
  demandaCompleta,
  demandaId,
  acaoCriar,
  hrefBase,
  hrefAbrir,
  rotuloAbrir,
}: {
  plano: PlanoModulo;
  rotulo: string;
  demandaCompleta: boolean;
  demandaId: number;
  acaoCriar: (formData: FormData) => void | Promise<void>;
  hrefBase: string;
  /** destino alternativo do botão "Abrir" (ex.: etapa da própria demanda) */
  hrefAbrir?: string;
  rotuloAbrir?: string;
}) {
  if (!plano.aplicavel) {
    return (
      <span className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground/80">
        {rotulo === "laboratorial" ? "Laboratório" : "Projeto"} não se aplica
      </span>
    );
  }
  if (plano.acao === "bloqueado") {
    return (
      <span className="rounded-md border border-danger-strong/30 px-3 py-2 text-xs text-danger-strong">
        Orçamento {rotulo}: saneamento necessário
      </span>
    );
  }
  if (!demandaCompleta) {
    return (
      <span className="rounded-md border border-warning-strong/30 px-3 py-2 text-xs text-warning-strong">
        Complete os dados
      </span>
    );
  }
  if (plano.acao === "abrir" && plano.moduloId) {
    return (
      <Link
        href={hrefAbrir ?? `${hrefBase}/${plano.moduloId}`}
        className="rounded-md border border-input px-3 py-2 text-xs font-medium hover:bg-muted"
      >
        {rotuloAbrir ?? `Abrir orçamento ${rotulo}`}
      </Link>
    );
  }
  return (
    <form action={acaoCriar}>
      <input suppressHydrationWarning type="hidden" name="demanda_id" value={demandaId} />
      <button className="rounded-md bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-500">
        Criar orçamento {rotulo}
      </button>
    </form>
  );
}

function Info({ titulo, texto }: { titulo: string; texto: string | null }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-sm font-medium">{texto || "—"}</p>
    </div>
  );
}

function Texto({ titulo, texto }: { titulo: string; texto: string | null }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      <p className="mt-1 whitespace-pre-wrap leading-6 text-foreground">{texto || "—"}</p>
    </div>
  );
}

function ResumoFinal({ titulo, valor, destaque = false }: { titulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${destaque ? "border-brand-200 bg-brand-50 dark:border-brand-900 dark:bg-brand-950/30" : "border-border"}`}>
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <p className={`mt-1 text-base font-semibold tabular-nums ${destaque ? "text-brand-700 dark:text-brand-300" : ""}`}>
        {brl(valor)}
      </p>
    </div>
  );
}

function TabelaSimples({
  colunas,
  linhas,
  vazio,
}: {
  colunas: string[];
  linhas: ReactNode[][];
  vazio: string;
}) {
  return (
    <div className="mt-4 overflow-x-auto rounded-md border border-border">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <tr>
            {colunas.map((coluna) => (
              <th key={coluna} className="px-3 py-2">
                {coluna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {linhas.length > 0 ? (
            linhas.map((linha, index) => (
              <tr key={index} className="align-top">
                {linha.map((celula, celulaIndex) => (
                  <td key={celulaIndex} className="max-w-sm px-3 py-2 text-foreground">
                    {celula}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={colunas.length} className="px-3 py-4 text-xs text-muted-foreground/80">
                {vazio}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function statusClasse(status: ReturnType<typeof avaliarModuloOperacional>["status"]) {
  if (status === "revisado") {
    return "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300";
  }
  if (status === "preenchido") {
    return "bg-warning-soft text-warning-strong";
  }
  if (status === "pendente") {
    return "bg-danger-soft text-danger-strong";
  }
  return "bg-muted text-muted-foreground";
}
