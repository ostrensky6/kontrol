import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { planejarModulosProposta } from "@/lib/orcamento/garantir-modulos";
import { totalLaboratorioCusto, totalLaboratorioPreco } from "@/lib/orcamento/bases-custo";
import { avaliarCompletudeDemanda } from "@/lib/orcamento/demanda-completude";
import { avaliarModuloOperacional } from "@/lib/orcamento/modulo-status";
import { consolidarOrcamentoFinal } from "@/lib/orcamento/orcamento-final";
import { resolverIdentidadeComAviso } from "@/lib/orcamento/identidade-institucional";
import { carregarComplementosDocumento } from "@/lib/orcamento/complementos-documento";
import { montarDocumentoProposta } from "@/lib/orcamento/documento-proposta";
import { resolverTextosDemanda } from "@/lib/orcamento/textos-proposta";
import { montarVisaoInterna } from "@/lib/orcamento/visao-interna";
import { temPermissao } from "@/lib/auth/permissao-efetiva";
import { podeOrcamento } from "@/lib/orcamento/governanca";
import { padroesDeParametrosGlobais, resolverParametrosProposta } from "@/lib/orcamento/parametros-proposta";
import {
  montarEtapasProposta,
  ORDEM_ETAPAS,
  vizinhasEtapa,
  type EtapaId,
} from "@/lib/orcamento/etapas-proposta";
import { NavegacaoEtapas } from "@/components/orcamento/NavegacaoEtapas";
import {
  detectarCustosZero,
  montarComponentesTecnicos,
  reconciliarComposicao,
  statusPropostaFinal,
  type StatusPropostaFinal,
} from "@/lib/orcamento/proposta-final";
import {
  modalidadeExigeLaboratorio,
  modalidadeExigeProjeto,
  normalizarModalidadeOrcamento,
} from "@/lib/orcamento/orcamento-economico";
import { AvisoLeitura } from "@/components/common/AvisoLeitura";
import { novaLeitura, semRegistro } from "@/lib/supabase/leitura";
import {
  MODALIDADES,
  MODALIDADES_SELECIONAVEIS,
  type OrcamentoAnalisesResumo,
  type OrcamentoProjetoResumo,
} from "@/lib/orcamento/demanda-detalhe";
import { TabelaSimples } from "@/components/orcamento/demanda/TabelaSimples";
import { DemandaCabecalho } from "@/components/orcamento/demanda/DemandaCabecalho";
import { DemandaAbasEtapas } from "@/components/orcamento/demanda/DemandaAbasEtapas";
import { DemandaDados } from "@/components/orcamento/demanda/DemandaDados";
import { DemandaProximosModulos } from "@/components/orcamento/demanda/DemandaProximosModulos";
import { DemandaLaboratorio } from "@/components/orcamento/demanda/DemandaLaboratorio";
import { DemandaProjeto } from "@/components/orcamento/demanda/DemandaProjeto";
import { DemandaParametros } from "@/components/orcamento/demanda/DemandaParametros";
import { DemandaPropostaFinal } from "@/components/orcamento/demanda/DemandaPropostaFinal";
import { DemandaHistorico } from "@/components/orcamento/demanda/DemandaHistorico";

export const dynamic = "force-dynamic";

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
  const leitura = novaLeitura("/orcamento/demandas/[id]");
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

  const { data: demanda } = await leitura.de("demandas", supabase
    .from("demandas_propostas")
    .select("*")
    .eq("id", demandaId)
    .single());
  if (!demanda) semRegistro(leitura);

  const [{ data: clientes }, { data: projetos }, { data: orcamentos }, { data: orcProjetos }, { data: versoesFinais }] =
    await Promise.all([
      leitura.de("clientes", supabase.from("clientes").select("id, nome, cnpj, contato, email, telefone, endereco").eq("ativo", true).order("nome")),
      leitura.de("projetos", supabase.from("projetos").select("id, nome").order("nome")),
      leitura.de("orçamentos de laboratório", supabase
        .from("orcamentos")
        .select("id, status, data_orcamento, orcamento_itens(id, codigo_analise, n_amostras, custo_unitario, preco_unitario)")
        .eq("demanda_id", demandaId)
        .order("id")),
      leitura.de("orçamentos de projeto", supabase
        .from("orcamento_projetos")
        .select("id, status, reformulacao_de_versao_id, data_orcamento, titulo, projeto_sem_custo_justificativa, impostos, margem_lucro, impostos_legacy, incubacao, reserva, investimentos, lucro, orcamento_projeto_analises(id, codigo_analise, n_amostras, custo_unitario, preco_unitario), orcamento_projeto_custos(id, rubrica, descricao, unidade, categoria, quantidade, custo_unitario, preco_unitario, meses_selecionados)")
        .eq("demanda_id", demandaId)
        .order("id")),
      leitura.de("versões da proposta", supabase
        .from("orcamento_final_versoes")
        .select("id, versao, numero, status, total_final, valido_ate, criado_em")
        .eq("demanda_id", demandaId)
        .order("versao", { ascending: false })),
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
  const { data: parametrosGlobais } = await leitura.de("parâmetros", supabase.from("parametros").select("chave, valor"));
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
    orcamentoFinalPronto: orcamentoFinal.pronto && completudeDemanda.completa, // dados completos só contam aqui (emissão)
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
  // Dados completos só são cobrados aqui, na emissão (dono, 28/09).
  const podeEmitir = orcamentoFinal.pronto && !temCustoZeroSemJustificativa && completudeDemanda.completa;
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
  // Fluxo contínuo (28/09): "Salvar e ir para …" nos Dados e barra "← anterior · próxima →" nas demais.
  const proximaDosDados = vizinhasEtapa(demanda.modalidade, "demanda").proxima;
  const hrefDados = `/orcamento/demandas/${demandaId}?etapa=demanda`;
  const proximaDaEtapa = vizinhasEtapa(demanda.modalidade, etapaAtiva).proxima;
  const avisoNavegacao =
    proximaDaEtapa === "parametros" && !podeConsolidar
      ? `Para liberar os parâmetros, falta: ${modulosPendentes.join("; ")}.`
      : null;
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
        <AvisoLeitura falhas={leitura.falhas} />
        <Breadcrumbs
          items={[
            { label: "Orçamentos", href: "/orcamento/demandas" },
            { label: demanda.titulo },
          ]}
        />

        {/* Cabeçalho compacto (28/09): os dados completos ficam no formulário da etapa 1. */}
        <DemandaCabecalho demanda={demanda} modalidadeCanonica={modalidadeCanonica} completudeDemanda={completudeDemanda} />

        <DemandaAbasEtapas etapas={etapas} etapaAtiva={etapaAtiva} />

        <DemandaDados
          classePasso={passo("demanda")}
          completudeDemanda={completudeDemanda}
          proximaDosDados={proximaDosDados}
          demandaId={demandaId}
          demanda={demanda}
          opcoesModalidade={opcoesModalidade}
          projetos={projetos}
          clientes={clientes}
          exigeAnalises={exigeAnalises}
        />

        <DemandaProximosModulos
          classePasso={passo("demanda")}
          completudeDemanda={completudeDemanda}
          planoModulosUi={planoModulosUi}
          erroIntegridade={erroIntegridade}
          demandaId={demandaId}
          todosOrcamentosAnalises={todosOrcamentosAnalises}
          todosOrcamentosProjeto={todosOrcamentosProjeto}
        />

        <DemandaLaboratorio
          classePasso={passo("laboratorio")}
          moduloAnalises={moduloAnalises}
          exigeAnalises={exigeAnalises}
          planoModulosUi={planoModulosUi}
          todosOrcamentosAnalises={todosOrcamentosAnalises}
          demandaId={demandaId}
          itensAnalises={itensAnalises}
          totalAnalisesCusto={totalAnalisesCusto}
          totalAnalisesPreco={totalAnalisesPreco}
        />

        <DemandaProjeto
          classePasso={passo("projeto")}
          moduloProjeto={moduloProjeto}
          exigeProjeto={exigeProjeto}
          planoModulosUi={planoModulosUi}
          etapaAtiva={etapaAtiva}
          demandaId={demandaId}
        />

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

        <DemandaParametros
          classePasso={passo("parametros")}
          podeConsolidar={podeConsolidar}
          orcamentoFinal={orcamentoFinal}
          parametrosProposta={parametrosProposta}
          demandaId={demandaId}
          erroParametros={erroParametros}
          parametrosSalvos={parametrosSalvos}
          autorizadoParametros={autorizadoParametros}
        />

        <DemandaPropostaFinal
          classePasso={passo("final")}
          statusFinal={statusFinal}
          orcamentoFinal={orcamentoFinal}
          versaoEmitidaVigente={versaoEmitidaVigente}
          autorizadoEmitir={autorizadoEmitir}
          demandaId={demandaId}
          operacaoEmissaoId={operacaoEmissaoId}
          podeEmitir={podeEmitir}
          semParametros={semParametros}
          demanda={demanda}
          versaoReformulada={versaoReformulada}
          temCustoZeroSemJustificativa={temCustoZeroSemJustificativa}
          completudeDemanda={completudeDemanda}
          erroEmissao={erroEmissao}
          composicaoFinal={composicaoFinal}
          hrefDados={hrefDados}
          custosZero={custosZero}
          abaProposta={abaProposta}
          erroParametros={erroParametros}
          parametrosSalvos={parametrosSalvos}
          podeVerPessoal={podeVerPessoal}
          visaoViva={visaoViva}
          subParam={subParam}
          autorizadoParametros={autorizadoParametros}
          parametrosProposta={parametrosProposta}
          documentoPrevia={documentoPrevia}
          autorizadoTextos={autorizadoTextos}
          textosVivos={textosVivos}
          versoesFinais={versoesFinais}
        />

        <DemandaHistorico
          classePasso={passo("historico")}
          versoesFinais={versoesFinais}
          todosOrcamentosAnalises={todosOrcamentosAnalises}
          todosOrcamentosProjeto={todosOrcamentosProjeto}
          demanda={demanda}
          completudeDemanda={completudeDemanda}
        />
        {etapaAtiva !== "demanda" && (
          <NavegacaoEtapas demandaId={demandaId} modalidade={demanda.modalidade} atual={etapaAtiva} aviso={avisoNavegacao} />
        )}
      </main>
    </div>
  );
}
