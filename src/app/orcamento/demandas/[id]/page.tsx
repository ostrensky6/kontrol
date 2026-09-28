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
import { OPCOES_INSTITUICAO, opcaoInstituicao, resolverIdentidadeComAviso } from "@/lib/orcamento/identidade-institucional";
import { HelpTip } from "@/components/common/HelpTip";
import { PainelParametrosEconomicos } from "@/components/orcamento/PainelParametrosEconomicos";
import { SalvarDemandaForm } from "@/components/orcamento/SalvarDemandaForm";
import { ClienteCadastradoSelect, type ClienteCadastro } from "@/components/orcamento/elaboracao/ClienteCadastradoSelect";
import { EditorCustosProjeto } from "@/components/orcamento/projeto/EditorCustosProjeto";
import { EditorParametrosProposta } from "@/components/orcamento/EditorParametrosProposta";
import { DocumentoProposta } from "@/components/orcamento/documento/DocumentoProposta";
import { PainelInterno } from "@/components/orcamento/interno/PainelInterno";
import { salvarParametrosEconomicosDaDemanda } from "@/lib/actions/demandas";
import { salvarTextosDemanda } from "@/lib/actions/orcamento-textos";
import { carregarComplementosDocumento } from "@/lib/orcamento/complementos-documento";
import { montarDocumentoProposta } from "@/lib/orcamento/documento-proposta";
import { resolverTextosDemanda } from "@/lib/orcamento/textos-proposta";
import { mascararPessoalVisao, montarFundos, montarVisaoInterna } from "@/lib/orcamento/visao-interna";
import { temPermissao } from "@/lib/auth/permissao-efetiva";
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

const ROTULO_PRIORIDADE: Record<string, string> = { baixa: "baixa", normal: "normal", alta: "alta", urgente: "urgente" };

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
  reformulacao_de_versao_id?: number | null;
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
  orcamento_projeto_analises?: { id: number; codigo_analise: string | null; n_amostras: number; custo_unitario: number; preco_unitario: number }[] | null;
  orcamento_projeto_custos?: {
    id: number;
    rubrica: string | null;
    descricao: string | null;
    unidade: string | null;
    categoria: string | null;
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
    aba?: string;
    sub?: string;
  }>;
}) {
  const { id } = await params;
  const {
    erro_emissao: erroEmissao,
    etapa: etapaParam,
    erro_integridade: erroIntegridade,
    erro_parametros: erroParametros,
    parametros_salvos: parametrosSalvos,
    aba: abaParam,
    sub: subParam,
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
      supabase.from("clientes").select("id, nome, cnpj, contato, email, telefone, endereco").eq("ativo", true).order("nome"),
      supabase.from("projetos").select("id, nome").order("nome"),
      supabase
        .from("orcamentos")
        .select("id, status, data_orcamento, orcamento_itens(id, codigo_analise, n_amostras, custo_unitario, preco_unitario)")
        .eq("demanda_id", demandaId)
        .order("id"),
      supabase
        .from("orcamento_projetos")
        .select("id, status, reformulacao_de_versao_id, data_orcamento, titulo, projeto_sem_custo_justificativa, impostos, margem_lucro, impostos_legacy, incubacao, reserva, investimentos, lucro, orcamento_projeto_analises(id, codigo_analise, n_amostras, custo_unitario, preco_unitario), orcamento_projeto_custos(id, rubrica, descricao, unidade, categoria, quantidade, custo_unitario, preco_unitario, meses_selecionados)")
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
  // O tipo do orçamento decide (dono, 28/09); ligação com projeto não cria etapa de custos.
  const exigeProjeto = modalidadeExigeProjeto(demanda.modalidade);
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
  // Reformulação (0139): a revisão foi reaberta com a proposta aprovada.
  const reformulacaoDeId = orcamentosProjeto.find((o) => o.reformulacao_de_versao_id)?.reformulacao_de_versao_id ?? null;
  const versaoReformulada = reformulacaoDeId ? (versoesFinais ?? []).find((v) => v.id === reformulacaoDeId) ?? null : null;
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
  const [autorizadoEmitir, autorizadoParametros, podePessoalOrcamento, podeSalarioTecnicos] = await Promise.all([
    podeOrcamento("emitir_final"),
    podeOrcamento("editar_parametros"),
    temPermissao("orcamentos.pessoal"),
    temPermissao("tecnicos.salario.ver"),
  ]);
  // DC8: sem a permissão de pessoal, os valores de PE da visão interna aparecem como XXX.
  const podeVerPessoal = podePessoalOrcamento || podeSalarioTecnicos;
  const podeEmitir = orcamentoFinal.pronto && !temCustoZeroSemJustificativa;
  // Σ% = 0 (ex.: "Apenas análises", sem módulo de projeto para guardar parâmetros).
  const semParametros = orcamentoFinal.somaPercentual <= 0;
  const versaoEmitidaVigente = (versoesFinais ?? []).find((v) => v.status === "emitido");

  // --- Idempotência/UI dos módulos (Fase 5) ---
  const planoModulosUi = planejarModulosProposta({
    modalidade: demanda.modalidade,
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
  // formulário Dados do orçamento: campos de 32 px, grupos aos pares (28/09)
  const campo = `rounded-md border border-input bg-card px-2.5 text-sm font-medium ${TOM_ENTRADA} mt-0.5 h-8 w-full`;
  const areaTexto = `rounded-md border border-input bg-card px-2.5 py-1.5 text-sm font-medium ${TOM_ENTRADA} mt-0.5 block min-h-14 w-full`;
  // Caixas bem delimitadas (28/09): borda mais forte, fundo cinza atrás dos campos brancos e
  // título da caixa com linha embaixo, para Identificação, Cliente e Amostras não se misturarem.
  const grupo = "min-w-0 rounded-lg border border-foreground/20 bg-muted px-2.5 pb-2.5 pt-2 shadow-sm dark:bg-muted/40";
  const legenda =
    "float-left mb-2 w-full border-b border-foreground/15 pb-1 text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300";
  const grade = "clear-both grid grid-cols-6 gap-x-2 gap-y-1.5";
  const hydrationSafe = { suppressHydrationWarning: true } as const;
  const operacaoEmissaoId = randomUUID();

  // --- Etapa Proposta (28/09): as mesmas abas da proposta emitida, com valores vivos ---
  const abaProposta = abaParam === "documento" ? "documento" : "interno";
  const autorizadoTextos = await podeOrcamento("criar_demanda");
  const complementosProposta = etapaAtiva === "final"
    ? await carregarComplementosDocumento(supabase, {
        identidade: resolverIdentidadeComAviso(demanda.instituicao).identidade,
        codigosAnalises: [...itensLaboratorioFlat.map((i) => i.codigo_analise), ...analisesProjetoFlat.map((i) => i.codigo_analise)],
        comSecoes: true,
      })
    : null;
  const visaoViva = montarVisaoInterna({
    itensLaboratorio: itensLaboratorioFlat,
    custosProjeto: custosProjetoFlat,
    analisesProjeto: analisesProjetoFlat,
    parametros: orcamentoFinal.parametros,
    total: orcamentoFinal.totalFinal,
    legado: false,
    nomesAnalises: complementosProposta?.nomesAnalises,
  });
  const textosVivos = resolverTextosDemanda({
    salvos: demanda.textos_proposta,
    padroes: complementosProposta?.secoesPadrao ?? [],
    escopoLegado: demanda.escopo_preliminar || demanda.descricao || null,
  });
  const documentoPrevia = montarDocumentoProposta({
    versao: { numero: "Prévia", versao: 0, status: "rascunho", validade_dias: 30, total_final: orcamentoFinal.totalFinal },
    demanda,
    visao: visaoViva,
    textos: textosVivos,
    empresa: complementosProposta?.empresa ?? null,
    rascunho: true,
  });

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <Breadcrumbs
          items={[
            { label: "Orçamentos", href: "/orcamento/demandas" },
            { label: demanda.titulo },
          ]}
        />

        {/* Cabeçalho compacto (28/09): os dados completos ficam no formulário da etapa 1. */}
        <section className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">
              <span className="text-muted-foreground">Nº {demanda.id} · </span>
              {demanda.titulo}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[
                demanda.cliente_nome || "Cliente não informado",
                MODALIDADES[modalidadeCanonica] ?? MODALIDADES[demanda.modalidade] ?? demanda.modalidade,
                demanda.data_solicitacao ? `solicitado em ${formatDate(demanda.data_solicitacao)}` : null,
                demanda.prazo_esperado ? `prazo ${formatDate(demanda.prazo_esperado)}` : null,
                demanda.responsavel_interno ? `resp. ${demanda.responsavel_interno}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
            <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300">
              {rotuloStatusOrcamento(demanda.status)}
            </span>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-muted-foreground">
              Prioridade {ROTULO_PRIORIDADE[demanda.prioridade ?? "normal"] ?? demanda.prioridade}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 ${
                completudeDemanda.completa ? "bg-success-soft text-success-strong" : "bg-warning-soft text-warning-strong"
              }`}
            >
              {completudeDemanda.completa ? "Dados completos" : `${completudeDemanda.faltante}% faltante`}
              <HelpTip title="Completude dos dados" align="end">
                <p>Parte dos <b>dados obrigatórios</b> do orçamento que ainda falta preencher (título, cliente, escopo e, conforme a modalidade, projeto e amostras).</p>
                <p>Os módulos de custo só são liberados com <b>0% faltante</b>.</p>
                <p className="text-xs">Atualizado em {formatDateTime(demanda.completude_atualizada_em)}.</p>
              </HelpTip>
            </span>
          </div>
        </section>

        <nav className="sticky top-[57px] z-10 mt-3 overflow-x-auto md:top-0 border-y border-border bg-card/95 py-1.5 shadow-sm backdrop-blur">
          <div className="flex min-w-max gap-1.5 px-2">
            {etapas.map((etapa, indice) => {
              const ativa = etapa.id === etapaAtiva;
              const desabilitada = !etapa.aplicavel;
              return (
                <a
                  key={etapa.id}
                  href={etapa.href}
                  aria-current={ativa ? "step" : undefined}
                  aria-disabled={desabilitada || undefined}
                  className={`rounded-md border px-3 py-1.5 text-left text-xs transition hover:bg-muted ${
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

        <section id="demanda" className={`mt-3 scroll-mt-20 rounded-lg border border-border bg-card px-4 pb-4 pt-3 shadow-sm ${passo("demanda")}`}>
          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
            <h2 className="text-sm font-semibold">Dados do orçamento</h2>
            <HelpTip title="Dados do orçamento">
              <p>Com tudo preenchido, as etapas de custo são liberadas.</p>
            </HelpTip>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${completudeDemanda.completa ? "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300" : "bg-warning-soft text-warning-strong"}`}>
              {completudeDemanda.completa ? "Completa" : `${completudeDemanda.faltante}% faltante`}
            </span>
          </div>
          <SalvarDemandaForm>
            <input {...hydrationSafe} type="hidden" name="demanda_id" value={demandaId} />
            {/* Grupos lado a lado em telas largas (3 colunas), campos aos pares. */}
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-[1fr_1fr_0.8fr]">
              <fieldset className={grupo}>
                <legend className={legenda}>Identificação</legend>
                <div className={grade}>
                  <div className="col-span-6">
                    <label htmlFor="d-titulo" className={lbl}>Título</label>
                    <input {...hydrationSafe} id="d-titulo" name="titulo" defaultValue={demanda.titulo ?? ""} className={campo} />
                  </div>
                  <div className="col-span-4">
                    <label htmlFor="d-modalidade" className={lbl}>Modalidade</label>
                    <select {...hydrationSafe} id="d-modalidade" name="modalidade" defaultValue={demanda.modalidade ?? "analises"} className={campo}>
                      {opcoesModalidade.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label htmlFor="d-prioridade" className={lbl}>Prioridade</label>
                    <select {...hydrationSafe} id="d-prioridade" name="prioridade" defaultValue={demanda.prioridade ?? "normal"} className={campo}>
                      <option value="baixa">Baixa</option>
                      <option value="normal">Normal</option>
                      <option value="alta">Alta</option>
                      <option value="urgente">Urgente</option>
                    </select>
                  </div>
                  <div className="col-span-3">
                    <label htmlFor="orcamento-instituicao" className={lbl}>Empresa emissora</label>
                    <select {...hydrationSafe} id="orcamento-instituicao" name="instituicao" defaultValue={opcaoInstituicao(demanda.instituicao)} className={campo}>
                      <option value="">Escolha…</option>
                      {OPCOES_INSTITUICAO.map((opcao) => <option key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</option>)}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <label htmlFor="d-projeto" className={lbl}>Projeto</label>
                    <select {...hydrationSafe} id="d-projeto" name="projeto_id" defaultValue={demanda.projeto_id ?? ""} className={campo}>
                      <option value="">—</option>
                      {(projetos ?? []).map((p) => (
                        <option key={p.id} value={p.id}>{p.nome}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <label htmlFor="d-responsavel" className={lbl}>Responsável interno</label>
                    <input {...hydrationSafe} id="d-responsavel" name="responsavel_interno" defaultValue={demanda.responsavel_interno ?? ""} className={campo} />
                  </div>
                  <div className="col-span-3">
                    <label htmlFor="d-origem" className={lbl}>Origem</label>
                    <input {...hydrationSafe} id="d-origem" name="origem" defaultValue={demanda.origem ?? ""} className={campo} />
                  </div>
                </div>
              </fieldset>

              <fieldset className={grupo}>
                <legend className={legenda}>Cliente</legend>
                <div className={grade}>
                  <div className="col-span-6">
                    <label htmlFor="d-cliente" className={lbl}>Cliente cadastrado <span className="font-normal">(preenche os dados abaixo)</span></label>
                    <ClienteCadastradoSelect
                      id="d-cliente"
                      name="cliente_id"
                      clientes={(clientes ?? []) as ClienteCadastro[]}
                      valorInicial={demanda.cliente_id ?? null}
                      className={campo}
                    />
                  </div>
                  <div className="col-span-4">
                    <label htmlFor="d-cliente-nome" className={lbl}>Razão social / nome</label>
                    <input {...hydrationSafe} id="d-cliente-nome" name="cliente_nome" defaultValue={demanda.cliente_nome ?? ""} className={campo} />
                  </div>
                  <div className="col-span-2">
                    <label htmlFor="d-cliente-cnpj" className={lbl}>CNPJ/CPF</label>
                    <input {...hydrationSafe} id="d-cliente-cnpj" name="cliente_cnpj" defaultValue={demanda.cliente_cnpj ?? ""} className={campo} />
                  </div>
                  <div className="col-span-3">
                    <label htmlFor="d-cliente-contato" className={lbl}>Contato</label>
                    <input {...hydrationSafe} id="d-cliente-contato" name="cliente_contato" defaultValue={demanda.cliente_contato ?? ""} className={campo} />
                  </div>
                  <div className="col-span-3">
                    <label htmlFor="d-cliente-telefone" className={lbl}>Telefone</label>
                    <input {...hydrationSafe} id="d-cliente-telefone" name="cliente_telefone" defaultValue={demanda.cliente_telefone ?? ""} className={campo} />
                  </div>
                  <div className="col-span-3">
                    <label htmlFor="d-cliente-email" className={lbl}>E-mail</label>
                    <input {...hydrationSafe} id="d-cliente-email" name="cliente_email" type="email" defaultValue={demanda.cliente_email ?? ""} className={campo} />
                  </div>
                  <div className="col-span-3">
                    <label htmlFor="d-cliente-endereco" className={lbl}>Endereço</label>
                    <input {...hydrationSafe} id="d-cliente-endereco" name="cliente_endereco" defaultValue={demanda.cliente_endereco ?? ""} placeholder="Rua, nº · cidade/UF" className={campo} />
                  </div>
                </div>
              </fieldset>

              <fieldset className={`${grupo} lg:col-span-2 2xl:col-span-1`}>
                <legend className={legenda}>Amostras e prazos</legend>
                <div className={`${grade} lg:grid-cols-12 2xl:grid-cols-6`}>
                  <div className="col-span-6 lg:col-span-4 2xl:col-span-6">
                    <label htmlFor="d-matriz" className={lbl}>Matriz ou tipo de amostra</label>
                    <input {...hydrationSafe} id="d-matriz" name="matriz_amostra" defaultValue={demanda.matriz_amostra ?? ""} className={campo} />
                  </div>
                  <div className="col-span-3 lg:col-span-2 2xl:col-span-3">
                    <label htmlFor="d-qtd" className={lbl}>Qtd. de amostras</label>
                    <input {...hydrationSafe} id="d-qtd" name="quantidade_amostras_estimada" type="number" min="1" step="1" defaultValue={demanda.quantidade_amostras_estimada ?? ""} className={`${campo} text-right tabular-nums`} />
                  </div>
                  <div className="col-span-3 lg:col-span-2 2xl:col-span-3">
                    <label htmlFor="d-prazo-tecnico" className={lbl}>Prazo técnico (dias)</label>
                    <input {...hydrationSafe} id="d-prazo-tecnico" name="prazo_tecnico_dias" type="number" min="1" step="1" defaultValue={demanda.prazo_tecnico_dias ?? ""} className={`${campo} text-right tabular-nums`} />
                  </div>
                  <div className="col-span-3 lg:col-span-2 2xl:col-span-3">
                    <label htmlFor="d-solicitacao" className={lbl}>Solicitado em</label>
                    <input {...hydrationSafe} id="d-solicitacao" name="data_solicitacao" type="date" defaultValue={demanda.data_solicitacao ?? ""} className={campo} />
                  </div>
                  <div className="col-span-3 lg:col-span-2 2xl:col-span-3">
                    <label htmlFor="d-prazo" className={lbl}>Prazo esperado</label>
                    <input {...hydrationSafe} id="d-prazo" name="prazo_esperado" type="date" defaultValue={demanda.prazo_esperado ?? ""} className={campo} />
                  </div>
                </div>
              </fieldset>

              <fieldset className={`${grupo} lg:col-span-2 2xl:col-span-3`}>
                <legend className={legenda}>Textos</legend>
                <div className="clear-both grid gap-x-2.5 gap-y-1.5 md:grid-cols-3">
                  <div>
                    <label htmlFor="d-descricao" className={lbl}>Descrição</label>
                    <textarea {...hydrationSafe} id="d-descricao" name="descricao" rows={2} defaultValue={demanda.descricao ?? ""} className={areaTexto} />
                  </div>
                  <div>
                    <label htmlFor="d-escopo" className={lbl}>
                      Escopo preliminar <span className="font-normal">(texto inicial da proposta)</span>
                    </label>
                    <textarea {...hydrationSafe} id="d-escopo" name="escopo_preliminar" rows={2} defaultValue={demanda.escopo_preliminar ?? ""} className={areaTexto} />
                  </div>
                  <div>
                    <label htmlFor="d-observacoes" className={lbl}>Observações internas</label>
                    <textarea {...hydrationSafe} id="d-observacoes" name="observacoes" rows={2} defaultValue={demanda.observacoes ?? ""} className={areaTexto} />
                  </div>
                </div>
              </fieldset>
            </div>
          </SalvarDemandaForm>
        </section>

        <section id="acoes" className={`mt-3 scroll-mt-20 grid gap-3 lg:grid-cols-3 ${passo("demanda")}`}>
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-1">
              <h2 className="text-sm font-semibold">Próximos módulos</h2>
              <HelpTip title="Próximos módulos">
                <p>A modalidade do orçamento controla quais módulos podem ser preenchidos.</p>
              </HelpTip>
            </div>
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

        <section id="laboratorio" className={`mt-3 scroll-mt-20 rounded-lg border border-border bg-card p-4 shadow-sm ${passo("laboratorio")}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-1">
                <h2 className="text-sm font-semibold">Orçamento laboratorial</h2>
                <HelpTip title="Custo × preço recebidos">
                  <p>Custos das análises gerados a partir deste orçamento.</p>
                  <p>O <b>custo</b> das análises é o que entra na proposta. O <b>preço</b> é o de tabela, mostrado só como referência.</p>
                </HelpTip>
              </div>
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
              {/* Resumo numa linha (28/09): os cartões repetiam a tabela logo abaixo. */}
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                <span><span className="text-muted-foreground">Orçamentos</span> <b className="font-semibold">{todosOrcamentosAnalises.length}</b></span>
                <span><span className="text-muted-foreground">Itens</span> <b className="font-semibold">{itensAnalises}</b></span>
                <span><span className="text-muted-foreground">Custo recebido</span> <b className="font-semibold">{brl(totalAnalisesCusto)}</b></span>
                <span><span className="text-muted-foreground">Preço de tabela</span> <b className="font-semibold">{brl(totalAnalisesPreco)}</b> <span className="text-xs text-muted-foreground">(referência)</span></span>
              </p>
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

        <section id="projeto" className={`mt-3 scroll-mt-20 rounded-lg border border-border bg-card p-4 shadow-sm ${passo("projeto")}`}>
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

        <section id="parametros" className={`mt-3 scroll-mt-20 rounded-lg border border-border bg-card p-4 shadow-sm ${passo("parametros")}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-1">
                <h2 className="text-sm font-semibold">Parâmetros econômicos</h2>
                <HelpTip title="Parâmetros econômicos">
                  <p>Custos recebidos e percentuais usados na consolidação final. Também dá para alterá-los na etapa Proposta, aba Interno.</p>
                </HelpTip>
              </div>
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

        <section id="final" className={`mt-3 scroll-mt-20 space-y-4 ${passo("final")}`}>
          {/* A — Cabeçalho da proposta + ações */}
          <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
            {/* Total e emissão numa faixa só; título e cliente já estão no cabeçalho. */}
            <div className="flex flex-wrap items-end justify-between gap-4 rounded-md border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-900 dark:bg-brand-950/30">
              <div>
                <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-brand-700 dark:text-brand-300">
                  Total da proposta
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal ${STATUS_FINAL_CLS[statusFinal]}`}>
                    {LABEL_STATUS_FINAL[statusFinal]}
                  </span>
                </p>
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
            {versaoReformulada && (
              <p role="note" className="mt-2 rounded-md bg-warning-soft px-3 py-1.5 text-xs text-warning-strong">
                Reformulação da proposta {versaoReformulada.numero}: a versão emitida agora, quando aprovada, substitui a{" "}
                {versaoReformulada.numero}, que fica no histórico.
              </p>
            )}
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

          {/* D — Mesmas abas da proposta emitida, com os valores atuais (28/09) */}
          <div className="space-y-3">
            <nav aria-label="Prévia da proposta" className="flex gap-1 border-b border-border">
              {[
                { id: "interno", rotulo: "Interno", href: `/orcamento/demandas/${demandaId}?etapa=final` },
                { id: "documento", rotulo: "Documento do cliente (prévia)", href: `/orcamento/demandas/${demandaId}?etapa=final&aba=documento` },
              ].map((t) => (
                <Link
                  key={t.id}
                  href={t.href}
                  aria-current={abaProposta === t.id ? "page" : undefined}
                  className={`border-b-2 px-4 py-2 text-sm ${
                    abaProposta === t.id
                      ? "border-brand-600 font-semibold text-brand-800 dark:border-brand-400 dark:text-brand-200"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.rotulo}
                </Link>
              ))}
            </nav>
            {abaProposta === "interno" ? (
              <>
                {erroParametros && (
                  <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">{erroParametros}</p>
                )}
                {parametrosSalvos === "1" && !erroParametros && (
                  <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success-strong">Percentuais salvos.</p>
                )}
                <PainelInterno
                  visao={podeVerPessoal ? visaoViva : mascararPessoalVisao(visaoViva)}
                  fundos={{ ...montarFundos(visaoViva, null), hrefFundos: "/orcamento/fundos" }}
                  subInicial={subParam}
                  motivoSemPercentuais={autorizadoParametros ? null : "Alterar os percentuais exige o perfil de gestor do orçamento."}
                  percentuais={
                    autorizadoParametros
                      ? {
                          valores: parametrosProposta.rates,
                          custoLaboratorio: orcamentoFinal.totalLaboratorioCusto,
                          custoProjeto: orcamentoFinal.totalProjetoCusto,
                          action: salvarParametrosEconomicosDaDemanda,
                          campos: { demanda_id: demandaId, retorno: "final" },
                          rotuloSalvar: "Salvar percentuais",
                          aviso: "Os percentuais valem para este orçamento e entram na próxima emissão.",
                        }
                      : null
                  }
                />
              </>
            ) : (
              <>
                {documentoPrevia.avisos.length > 0 && (
                  <ul className="space-y-1 text-xs text-warning-strong">
                    {documentoPrevia.avisos.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                )}
                <DocumentoProposta
                  modelo={documentoPrevia}
                  edicao={
                    autorizadoTextos
                      ? {
                          action: salvarTextosDemanda,
                          campos: { demanda_id: demandaId },
                          textos: textosVivos,
                          aviso: "Salvo neste orçamento. Entra no documento na próxima emissão.",
                        }
                      : null
                  }
                />
              </>
            )}
          </div>

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


        <section id="historico" className={`mt-3 scroll-mt-20 rounded-lg border border-border bg-card p-4 shadow-sm ${passo("historico")}`}>
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
