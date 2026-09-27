import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { ExportOrcamentoFinalButtons } from "@/components/orcamento/ExportOrcamentoFinalButtons";
import { PrintButton } from "@/components/orcamento/PrintButton";
import {
  cancelarVersaoFinal,
  duplicarVersaoFinal,
  gerarPlanejamentoDaProposta,
} from "@/lib/actions/orcamento-historico";
import { criarLinkPublico, revogarLinkPublico } from "@/lib/actions/orcamento-projetos";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency as brl, formatDate, formatDateTime } from "@/lib/formatters";
import { resolverIdentidadeComAviso } from "@/lib/orcamento/identidade-institucional";
import { rotuloModalidade } from "@/lib/orcamento/orcamento-economico";
import { HelpTip, HelpExample } from "@/components/common/HelpTip";
import { SubmitButton } from "@/components/common/SubmitButton";
import { CancelarComMotivo } from "@/components/orcamento/CancelarComMotivo";
import { FormEstado } from "@/components/orcamento/FormEstado";
import { LinkPublicoPainel, type LinkPublicoResumo } from "@/components/orcamento/LinkPublicoPainel";
import { montarPropostaFinalExport } from "@/lib/orcamento/proposta-final-export";
import { explicarOrigem } from "@/lib/orcamento/orcamento-final";
import {
  hojeCalendario,
  rotuloStatusModulo,
  rotuloStatusVersaoFinal,
  statusEfetivoVersaoFinal,
} from "@/lib/orcamento/rotulos-status";
import { STATUS_APROVADOS, STATUS_VIVOS, estaVencida } from "@/lib/orcamento/transicoes-versao";
import type { Json } from "@/lib/supabase/database.types";
import { podeOrcamento } from "@/lib/orcamento/governanca";
import { temPermissao } from "@/lib/auth/permissao-efetiva";

export const dynamic = "force-dynamic";

type SnapshotParametro = {
  key?: string;
  label?: string;
  nominalRate?: number;
  amount?: number;
};

type SnapshotConsolidado = {
  totalLaboratorioCusto?: number;
  totalLaboratorioPreco?: number;
  totalProjetoCusto?: number;
  totalProjetoFinal?: number;
  totalFinal?: number;
  parametrosProjeto?: SnapshotParametro[];
  markupProjeto?: number;
  pendencias?: string[];
  origens?: SnapshotOrigem[];
};

type SnapshotOrigem = {
  campo?: string;
  titulo?: string;
  origem?: string;
  regra?: string;
  valor?: number;
};

type SnapshotFinal = {
  demanda?: {
    id?: number;
    titulo?: string | null;
    cliente_nome?: string | null;
    instituicao?: string | null;
    cliente_cnpj?: string | null;
    cliente_contato?: string | null;
    modalidade?: string | null;
    escopo_preliminar?: string | null;
    descricao?: string | null;
  };
  orcamentos_analises?: SnapshotOrcamentoAnalises[];
  orcamentos_projeto?: SnapshotOrcamentoProjeto[];
  consolidado?: SnapshotConsolidado;
};

type SnapshotOrcamentoAnalises = {
  id?: number;
  status?: string | null;
  orcamento_itens?: SnapshotItemAnalise[];
};

type SnapshotItemAnalise = {
  id?: number;
  codigo_analise?: string | null;
  n_amostras?: number | null;
  custo_unitario?: number | null;
  preco_unitario?: number | null;
};

type SnapshotOrcamentoProjeto = {
  id?: number;
  status?: string | null;
  titulo?: string | null;
  orcamento_projeto_analises?: SnapshotItemAnalise[];
  orcamento_projeto_custos?: SnapshotItemProjeto[];
};

type SnapshotItemProjeto = {
  id?: number;
  rubrica?: string | null;
  categoria?: string | null;
  descricao?: string | null;
  quantidade?: number | null;
  unidade?: string | null;
  custo_unitario?: number | null;
  preco_unitario?: number | null;
  meses_selecionados?: number[] | null;
};

export default async function OrcamentoFinalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const [{ id }, { erro }] = await Promise.all([params, searchParams]);
  const versaoId = Number(id);
  const operacaoDuplicacaoId = randomUUID();
  const [podeDuplicar, podeCancelar, podeEmitir, podePlanejar] = await Promise.all([
    podeOrcamento("duplicar_final"),
    podeOrcamento("cancelar_documento"),
    podeOrcamento("emitir_final"),
    temPermissao("planejamento.editar"),
  ]);
  const supabase = await createClient();
  // Proposta aprovada gera o plano sozinha (0122); cancelado não conta (0126).
  const { data: planoGerado } = await supabase
    .from("planejamento")
    .select("id, status_operacional")
    .eq("orcamento_final_versao_id", versaoId)
    .neq("status_operacional", "cancelado")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: versao } = await supabase
    .from("orcamento_final_versoes")
    .select("*")
    .eq("id", versaoId)
    .single();
  if (!versao) notFound();

  const [{ data: linksRaw }, { data: outrasVersoes }] = await Promise.all([
    supabase
      .from("orcamento_projeto_links")
      .select("id, criado_em, revogado, aprovado_em, aprovado_por")
      .eq("orcamento_final_versao_id", versaoId)
      .order("id", { ascending: false }),
    supabase
      .from("orcamento_final_versoes")
      .select("id, numero, versao, status")
      .eq("demanda_id", versao.demanda_id)
      .neq("id", versaoId),
  ]);
  const links = (linksRaw ?? []) as LinkPublicoResumo[];
  const hoje = hojeCalendario();
  const vencida = estaVencida(versao.valido_ate, hoje);
  const aprovada = (STATUS_APROVADOS as readonly string[]).includes(versao.status);
  const viva = (STATUS_VIVOS as readonly string[]).includes(versao.status);
  const outraAprovada = (outrasVersoes ?? []).find((v) => (STATUS_APROVADOS as readonly string[]).includes(v.status));
  const versaoMaisNova = (outrasVersoes ?? []).find((v) => v.versao > versao.versao && (STATUS_VIVOS as readonly string[]).includes(v.status));
  const motivoSemLink = !viva
    ? "Link de aprovação só existe para proposta emitida ou enviada, ainda não aprovada."
    : vencida
      ? "Proposta vencida: emita uma nova versão antes de enviar o link."
      : !podeEmitir
        ? "Criar ou revogar o link exige a permissão “Orçamentos: Emitir proposta”."
        : null;

  const snapshot = normalizarSnapshot(versao.snapshot);
  const { data: demandaAtual } = await supabase
    .from("demandas_propostas")
    .select("id, titulo, instituicao, cliente_nome, cliente_cnpj, cliente_contato, modalidade, escopo_preliminar, descricao")
    .eq("id", versao.demanda_id)
    .single();

  const demanda = snapshot.demanda ?? demandaAtual;
  // Não lança: versões antigas sem instituição ainda abrem, com aviso.
  const { identidade, aviso: avisoIdentidade } = resolverIdentidadeComAviso(demanda?.instituicao);
  const consolidado = snapshot.consolidado ?? {};
  const origens = normalizarOrigens(consolidado, versao);
  const itensLaboratorio = (snapshot.orcamentos_analises ?? []).flatMap((orcamento) =>
    (orcamento.orcamento_itens ?? []).map((item) => ({
      ...item,
      origem: `Laboratório #${orcamento.id ?? "—"}`,
      status: orcamento.status ? rotuloStatusModulo(orcamento.status) : "—",
    })),
  );
  const custosProjeto = (snapshot.orcamentos_projeto ?? []).flatMap((orcamento) =>
    (orcamento.orcamento_projeto_custos ?? []).map((item) => ({
      ...item,
      origem: `Projeto #${orcamento.id ?? "—"}`,
      status: orcamento.status ? rotuloStatusModulo(orcamento.status) : "—",
    })),
  );
  const analisesProjeto = (snapshot.orcamentos_projeto ?? []).flatMap((orcamento) =>
    (orcamento.orcamento_projeto_analises ?? []).map((item) => ({
      ...item,
      origem: `Projeto #${orcamento.id ?? "—"}`,
      status: orcamento.status ? rotuloStatusModulo(orcamento.status) : "—",
    })),
  );
  // Estrutura única de exportação/apresentação (reusa proposta-final-export).
  const dadosExport = montarPropostaFinalExport({
    versao,
    snapshot: versao.snapshot,
    demanda: demanda ?? null,
    responsavel: identidade.responsavel,
  });
  const composicaoCliente = dadosExport.composicaoComercial;
  const statusLabel = rotuloStatusVersaoFinal(statusEfetivoVersaoFinal(versao));
  const modoInternoHref = "#modo-interno";

  return (
    <div className="min-h-dvh bg-transparent font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="print-area app-page-container">
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <Breadcrumbs
            items={[
              { label: "Orçamentos", href: "/orcamento/demandas" },
              { label: demanda?.titulo ?? `Orçamento #${versao.demanda_id}`, href: `/orcamento/demandas/${versao.demanda_id}` },
              { label: versao.numero },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={modoInternoHref}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Modo interno
            </a>
            <ExportOrcamentoFinalButtons dados={dadosExport} />
            <Link
              href={`/orcamento/demandas/${versao.demanda_id}`}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Voltar ao orçamento
            </Link>
            <PrintButton />
          </div>
        </div>
        {erro && (
          <p role="alert" className="no-print mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">
            {erro}
          </p>
        )}
        {versaoMaisNova && (
          <p className="no-print mt-3 rounded-md border border-warning-strong/30 bg-warning-soft px-3 py-2 text-sm text-warning-strong">
            Existe uma versão mais nova desta proposta ({versaoMaisNova.numero}).{" "}
            <Link href={`/orcamento/final/${versaoMaisNova.id}`} className="font-medium underline">Abrir a versão em vigor</Link>
          </p>
        )}
        {viva && vencida && (
          <p className="no-print mt-3 rounded-md border border-warning-strong/30 bg-warning-soft px-3 py-2 text-sm text-warning-strong">
            Proposta vencida em {formatDate(versao.valido_ate)}: não pode mais ser aprovada. Emita uma nova versão.
          </p>
        )}
        {avisoIdentidade && (
          <p role="alert" className="no-print mt-3 rounded-md border border-warning-strong/30 bg-warning-soft px-3 py-2 text-sm text-warning-strong">
            {avisoIdentidade}
          </p>
        )}

        <section className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 print:border-0 print:shadow-none">
          <div className="border-b border-zinc-200 px-6 py-5 text-white dark:border-zinc-800" style={{ backgroundColor: identidade.id === "ATGC" ? "#09090B" : identidade.corPrincipal }}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="rounded-md bg-white p-2">
                  {/* Mantem <img> no documento imprimivel/PDF para preservar a renderizacao do logo institucional. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={identidade.logoSrc} alt={identidade.logoAlt} className="h-12 w-auto" />
                </div>
                <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-white/75">
                  {identidade.nomeCurto}
                </p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight">Proposta comercial</h1>
                <p className="mt-1 text-sm text-zinc-300">{demanda?.titulo ?? `Orçamento #${versao.demanda_id}`}</p>
                </div>
              </div>
              <div className="text-right text-sm">
                <p className="text-xs uppercase tracking-wide text-zinc-400">Número</p>
                <p className="mt-1 text-lg font-semibold">{versao.numero}</p>
                <p className="mt-1 text-zinc-300">v{versao.versao} · {statusLabel}</p>
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
              <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Dados do cliente</h2>
                <dl className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                  <Campo titulo="Cliente" valor={demanda?.cliente_nome ?? "—"} />
                  <Campo titulo="CNPJ/CPF" valor={demanda?.cliente_cnpj ?? "—"} />
                  <Campo titulo="Contato" valor={demanda?.cliente_contato ?? "—"} />
                  <Campo titulo="Modalidade" valor={rotuloModalidade(demanda?.modalidade)} />
                  <Campo titulo="Emitido em" valor={formatDateTime(versao.criado_em)} />
                  <Campo titulo="Válido até" valor={formatDate(versao.valido_ate)} />
                </dl>
              </section>

              <aside className="rounded-lg border border-brand-200 bg-brand-50 p-4 dark:border-brand-900 dark:bg-brand-950/30">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">Total da proposta</p>
                <p className="mt-3 text-3xl font-semibold tabular-nums text-brand-800 dark:text-brand-200">
                  {brl(Number(versao.total_final ?? 0))}
                </p>
                <p className="mt-2 text-sm text-brand-700 dark:text-brand-300">
                  Validade de {Number(versao.validade_dias ?? 0)} dias a partir da emissão.
                </p>
              </aside>
            </div>

            <section className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Escopo resumido</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                {demanda?.escopo_preliminar || demanda?.descricao || "—"}
              </p>
            </section>

            <section className="mt-6 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <div className="flex items-center gap-1">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Composição comercial</h2>
                  <span className="no-print">
                    <HelpTip title="Composição comercial">
                      <p>O total da proposta é dividido entre os itens na <b>proporção do custo técnico</b> de cada um. A soma das linhas sempre fecha com o total.</p>
                      <HelpExample>Custos de R$ 300 e R$ 700, total de R$ 1.500 → linhas de R$ 450 (30%) e R$ 1.050 (70%).</HelpExample>
                    </HelpTip>
                  </span>
                </div>
                {dadosExport.avisoLegado && (
                  <p className="mt-1 text-xs text-zinc-500">{dadosExport.avisoLegado}</p>
                )}
              </div>
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">Componente</th>
                    <th className="px-4 py-3">Descrição</th>
                    <th className="px-4 py-3 text-right">Qtd.</th>
                    <th className="px-4 py-3 text-right">Participação</th>
                    <th className="px-4 py-3 text-right">Valor comercial</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {composicaoCliente.map((item) => (
                    <tr key={`${item.componente}-${item.descricao}`}>
                      <td className="px-4 py-3 font-medium">{item.componente}</td>
                      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{item.descricao}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{item.quantidade}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{(item.participacao * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{brl(item.valorComercial)}</td>
                    </tr>
                  ))}
                  {composicaoCliente.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-5 text-center text-sm text-zinc-400">
                        Nenhum item registrado nesta versão.
                      </td>
                    </tr>
                  )}
                  <tr className="bg-zinc-50 font-semibold dark:bg-zinc-950/50">
                    <td colSpan={4} className="px-4 py-3 text-right">Total final</td>
                    <td className="px-4 py-3 text-right tabular-nums">{brl(Number(versao.total_final ?? 0))}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section className="mt-6 grid gap-4 md:grid-cols-3">
              <BlocoDocumento titulo="Condições comerciais">
                {condicoesComerciais(versao)}
              </BlocoDocumento>
              <BlocoDocumento titulo="Prazos e validade">
                Emitido em {formatDateTime(versao.criado_em)} e válido até {formatDate(versao.valido_ate)}.
              </BlocoDocumento>
              <BlocoDocumento titulo="Responsável">
                {identidade.responsavel}.
              </BlocoDocumento>
            </section>
          </div>
        </section>

        <section id="modo-interno" className="mt-5 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 print:hidden">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-400">
                Modo interno
              </p>
              <div className="mt-1 flex items-center gap-1">
                <h2 className="text-xl font-semibold tracking-tight">Custos, parâmetros e auditoria</h2>
                <HelpTip title="Modo interno">
                  <p>Custos, parâmetros e auditoria desta versão, <b>congelados na emissão</b>, para conferência da equipe.</p>
                  <p>Esta área <b>não é impressa</b> nem enviada ao cliente.</p>
                </HelpTip>
              </div>
            </div>
            <div className="no-print flex flex-wrap gap-2">
              {planoGerado && (
                <Link
                  href={`/planejamento/${planoGerado.id}`}
                  className="rounded-md border border-brand-300 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 dark:border-brand-800 dark:text-brand-300 dark:hover:bg-brand-950/30"
                >
                  Planejamento #{planoGerado.id}
                </Link>
              )}
              {podeDuplicar && !aprovada && !outraAprovada && (
              <form action={duplicarVersaoFinal}>
                <input type="hidden" name="versao_id" value={versao.id} />
                <input type="hidden" name="operacao_id" value={operacaoDuplicacaoId} />
                <input type="hidden" name="validade_dias" value={versao.validade_dias ?? 30} />
                <button
                  title="Cria nova versão com os mesmos itens e valores; a versão em vigor passa a substituída."
                  className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Duplicar versão
                </button>
              </form>
              )}
              {podeCancelar && ["emitido", "enviado", "alterado_reenviado", "recusado", "rejeitado", "aprovado"].includes(versao.status) && (
                <CancelarComMotivo
                  action={cancelarVersaoFinal}
                  fields={{ versao_id: versao.id }}
                  trigger="Cancelar proposta"
                  titulo="Cancelar esta proposta?"
                  mensagem={
                    aprovada
                      ? `A versão ${versao.numero} deixa de valer. O planejamento dela em rascunho ou reservado também é cancelado, com as reservas liberadas; se já estiver em execução, continua e o coordenador é avisado.`
                      : `A versão ${versao.numero} deixa de valer para o cliente e o link de aprovação dela é revogado. O registro continua no histórico.`
                  }
                  confirmLabel="Cancelar proposta"
                  triggerClassName="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"
                />
              )}
            </div>
          </div>

          {aprovada && !planoGerado && (
            <div className="no-print mt-4 rounded-md border border-brand-200 bg-brand-50 p-3 text-sm dark:border-brand-900 dark:bg-brand-950/30">
              {itensLaboratorio.length + analisesProjeto.length === 0 ? (
                <p>Proposta aprovada sem análises laboratoriais: não há planejamento a gerar. Organize a execução pelo projeto.</p>
              ) : podePlanejar ? (
                <FormEstado action={gerarPlanejamentoDaProposta} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="versao_id" value={versao.id} />
                  <p>Esta proposta aprovada está sem planejamento ativo.</p>
                  <SubmitButton size="sm" pendingLabel="Gerando…">Gerar planejamento desta proposta</SubmitButton>
                </FormEstado>
              ) : (
                <p>Esta proposta aprovada está sem planejamento ativo. Gerar o plano exige a permissão “Montar planejamento”.</p>
              )}
            </div>
          )}

          <section className="no-print mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center gap-1">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Link de aprovação do cliente</h2>
              <HelpTip title="Link de aprovação">
                <p>Endereço para o cliente ver a proposta e aprovar <b>sem login</b>. Vale só para esta versão.</p>
                <p>Nova versão, cancelamento ou vencimento encerram o link. Aprovar pelo link cria o planejamento, como a aprovação pela equipe.</p>
              </HelpTip>
            </div>
            <div className="mt-3">
              <LinkPublicoPainel
                versaoId={versao.id}
                links={links}
                podeCriar={viva && !vencida && podeEmitir && !outraAprovada && !versaoMaisNova}
                motivoSemLink={motivoSemLink}
                criar={criarLinkPublico}
                revogar={revogarLinkPublico}
              />
            </div>
          </section>

          <dl className="mt-6 grid gap-3 text-sm md:grid-cols-3">
            <Campo titulo="Cliente" valor={demanda?.cliente_nome ?? "—"} />
            <Campo titulo="CNPJ/CPF" valor={demanda?.cliente_cnpj ?? "—"} />
            <Campo titulo="Contato" valor={demanda?.cliente_contato ?? "—"} />
            <Campo titulo="Orçamento" valor={demanda?.titulo ?? `#${versao.demanda_id}`} />
            <Campo titulo="Modalidade" valor={rotuloModalidade(demanda?.modalidade)} />
            <Campo titulo="Validade" valor={versao.validade_dias != null ? `${versao.validade_dias} dias` : "—"} />
          </dl>

          <div className="mt-6 grid gap-3 md:grid-cols-5">
            <Resumo titulo="Custo laboratório" valor={versao.total_laboratorio_custo} />
            <Resumo titulo="Preço laboratório" valor={versao.total_laboratorio_preco} />
            <Resumo titulo="Custo projeto" valor={versao.total_projeto_custo} />
            <Resumo titulo="Projeto final" valor={versao.total_projeto_final} />
            <Resumo titulo="Total final" valor={versao.total_final} destaque />
          </div>

          <section className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Parâmetros econômicos
              </h2>
              <span className="text-xs text-zinc-500">
                Σ parâmetros: {Number(consolidado.markupProjeto ?? 0).toLocaleString("pt-BR")}%
              </span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {(consolidado.parametrosProjeto ?? []).map((parametro) => (
                <div key={parametro.key ?? parametro.label} className="rounded-md bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-950/50">
                  <div className="flex items-center justify-between gap-2">
                    <span>{parametro.label ?? parametro.key}</span>
                    <span className="font-medium">{Number(parametro.nominalRate ?? 0).toLocaleString("pt-BR")}%</span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{brl(Number(parametro.amount ?? 0))}</p>
                </div>
              ))}
              {(consolidado.parametrosProjeto ?? []).length === 0 && (
                <p className="text-sm text-zinc-400">Sem parâmetros registrados nesta versão.</p>
              )}
            </div>
          </section>

          <section className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Composição detalhada</h2>
            <div className="mt-4 space-y-5">
              <TabelaAnalisesSnapshot titulo="Análises laboratoriais" itens={itensLaboratorio} tipo="laboratorio" />
              <TabelaCustosSnapshot titulo="Custos próprios do projeto" itens={custosProjeto} />
              <TabelaAnalisesSnapshot titulo="Análises dentro de projeto" itens={analisesProjeto} tipo="projeto" />
            </div>
          </section>

          <section className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Origem e auditoria</h2>
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
              <Campo titulo="Valores" valor="Congelados na emissão" />
              <Campo titulo="Status da versão" valor={statusLabel} />
              <Campo titulo="Orçamento de origem" valor={`#${versao.demanda_id}`} />
            </div>
            <div className="mt-4 divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {origens.map((origem) => (
                <div key={origem.campo ?? origem.titulo} className="grid gap-2 px-3 py-3 text-sm md:grid-cols-[1fr_2fr_auto]">
                  <p className="font-medium">{origem.titulo ?? origem.campo}</p>
                  <p className="text-zinc-600 dark:text-zinc-300">
                    {dadosExport.legado ? origem.regra ?? "Valor registrado na emissão." : explicarOrigem(origem)}
                  </p>
                  <p className="font-semibold tabular-nums md:text-right">{brl(Number(origem.valor ?? 0))}</p>
                </div>
              ))}
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}

function condicoesComerciais(versao: { valido_ate: string | null; validade_dias: number | null }) {
  return `Valores válidos até ${formatDate(versao.valido_ate)}. Alterações de escopo, quantidade de amostras, premissas técnicas ou cronograma podem exigir nova versão da proposta.`;
}

function TabelaAnalisesSnapshot({
  titulo,
  itens,
  tipo,
}: {
  titulo: string;
  itens: Array<SnapshotItemAnalise & { origem: string; status: string }>;
  tipo: "laboratorio" | "projeto";
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">{titulo}</h3>
      <div className="mt-2 overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-right text-sm">
          <thead className="text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left">Origem</th>
              <th className="px-3 py-2 text-left">Análise</th>
              <th className="px-3 py-2">Amostras</th>
              <th className="px-3 py-2">{tipo === "laboratorio" ? "Custo unit." : "Custo/amostra"}</th>
              <th className="px-3 py-2">{tipo === "laboratorio" ? "Preço unit." : "Preço registrado"}</th>
              <th className="px-3 py-2">Subtotal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {itens.map((item, index) => (
              <tr key={`${item.origem}-${item.id ?? index}`}>
                <td className="px-3 py-2 text-left text-zinc-500">{item.origem} · {item.status}</td>
                <td className="px-3 py-2 text-left font-medium">{item.codigo_analise ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{Number(item.n_amostras ?? 0)}</td>
                <td className="px-3 py-2 tabular-nums">{brl(Number(item.custo_unitario ?? 0))}</td>
                <td className="px-3 py-2 tabular-nums">{brl(Number(item.preco_unitario ?? 0))}</td>
                <td className="px-3 py-2 font-semibold tabular-nums">
                  {brl(Number(item.n_amostras ?? 0) * Number((tipo === "laboratorio" ? item.preco_unitario : item.custo_unitario) ?? 0))}
                </td>
              </tr>
            ))}
            {itens.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-5 text-center text-xs text-zinc-400">
                  Nenhum item registrado nesta versão.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabelaCustosSnapshot({
  titulo,
  itens,
}: {
  titulo: string;
  itens: Array<SnapshotItemProjeto & { origem: string; status: string }>;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">{titulo}</h3>
      <div className="mt-2 overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-right text-sm">
          <thead className="text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left">Origem</th>
              <th className="px-3 py-2 text-left">Rubrica</th>
              <th className="px-3 py-2 text-left">Descrição</th>
              <th className="px-3 py-2">Qtd.</th>
              <th className="px-3 py-2">Custo unit.</th>
              <th className="px-3 py-2">Subtotal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {itens.map((item, index) => (
              <tr key={`${item.origem}-${item.id ?? index}`}>
                <td className="px-3 py-2 text-left text-zinc-500">{item.origem} · {item.status}</td>
                <td className="px-3 py-2 text-left">{item.rubrica ?? "OU"}</td>
                <td className="px-3 py-2 text-left font-medium">{item.descricao ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{Number(item.quantidade ?? 0)}</td>
                <td className="px-3 py-2 tabular-nums">{brl(Number(item.custo_unitario ?? item.preco_unitario ?? 0))}</td>
                <td className="px-3 py-2 font-semibold tabular-nums">
                  {brl(Number(item.quantidade ?? 0) * Number(item.custo_unitario ?? item.preco_unitario ?? 0))}
                </td>
              </tr>
            ))}
            {itens.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-5 text-center text-xs text-zinc-400">
                  Nenhum item registrado nesta versão.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function normalizarOrigens(
  consolidado: SnapshotConsolidado,
  versao: {
    total_laboratorio_custo: number;
    total_laboratorio_preco: number;
    total_projeto_custo: number;
    total_projeto_final: number;
    total_final: number;
  },
) {
  if (consolidado.origens?.length) return consolidado.origens;
  return [
    {
      campo: "totalLaboratorioCusto",
      titulo: "Custo laboratório",
      origem: "Registro da emissão",
      regra: "Total preservado na versão final.",
      valor: Number(versao.total_laboratorio_custo ?? 0),
    },
    {
      campo: "totalLaboratorioPreco",
      titulo: "Preço laboratório",
      origem: "Registro da emissão",
      regra: "Total preservado na versão final.",
      valor: Number(versao.total_laboratorio_preco ?? 0),
    },
    {
      campo: "totalProjetoCusto",
      titulo: "Custo projeto",
      origem: "Registro da emissão",
      regra: "Total preservado na versão final.",
      valor: Number(versao.total_projeto_custo ?? 0),
    },
    {
      campo: "totalProjetoFinal",
      titulo: "Projeto final",
      origem: "Registro da emissão",
      regra: "Total preservado na versão final.",
      valor: Number(versao.total_projeto_final ?? 0),
    },
    {
      campo: "totalFinal",
      titulo: "Total final",
      origem: "Registro da emissão",
      regra: "Total preservado na versão final.",
      valor: Number(versao.total_final ?? 0),
    },
  ];
}

function normalizarSnapshot(snapshot: Json): SnapshotFinal {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return {};
  return snapshot as SnapshotFinal;
}

function Campo({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-950/50">
      <dt className="text-xs font-medium text-zinc-500">{titulo}</dt>
      <dd className="mt-1 font-medium">{valor}</dd>
    </div>
  );
}

function BlocoDocumento({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{titulo}</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-700 dark:text-zinc-300">{children}</p>
    </div>
  );
}

function Resumo({ titulo, valor, destaque = false }: { titulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${destaque ? "border-brand-200 bg-brand-50 dark:border-brand-900 dark:bg-brand-950/30" : "border-zinc-200 dark:border-zinc-800"}`}>
      <p className="text-xs font-medium text-zinc-500">{titulo}</p>
      <p className={`mt-1 text-base font-semibold tabular-nums ${destaque ? "text-brand-700 dark:text-brand-300" : ""}`}>
        {brl(Number(valor ?? 0))}
      </p>
    </div>
  );
}
