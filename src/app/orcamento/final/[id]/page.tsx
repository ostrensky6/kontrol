import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { ExportOrcamentoFinalButtons } from "@/components/orcamento/ExportOrcamentoFinalButtons";
import { PrintButton } from "@/components/orcamento/PrintButton";
import { buttonVariants } from "@/components/ui/button";
import {
  cancelarVersaoFinal,
  duplicarVersaoFinal,
  gerarPlanejamentoDaProposta,
} from "@/lib/actions/orcamento-historico";
import { criarLinkPublico, revogarLinkPublico } from "@/lib/actions/orcamento-projetos";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency as brl, formatDate } from "@/lib/formatters";
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

  const corDocumento = identidade.corPrincipal;
  const nomeCliente = demanda?.cliente_nome?.trim() || "—";
  const totalProposta = Number(versao.total_final ?? 0);
  const diasValidade = Number(versao.validade_dias ?? 0);
  // variante do botão: link com borda + bg-card/bg-muted vira "cartão clicável" (globals.css)
  const botaoSecundario = buttonVariants({ variant: "outline" });

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
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
            <Link href={`/orcamento/demandas/${versao.demanda_id}`} className={botaoSecundario}>
              Voltar ao orçamento
            </Link>
            <a href={modoInternoHref} className={botaoSecundario}>
              Modo interno
            </a>
            <ExportOrcamentoFinalButtons dados={dadosExport} />
            <PrintButton destaque />
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

        {/* Documento do cliente: uma folha clara nos dois temas, igual na tela e no
            papel (globals.css, .folha-documento). Nada de custo, margem ou parâmetro aqui.
            Sem <header>/<aside>: a impressão esconde essas tags. */}
        <article
          aria-label={`Proposta comercial ${versao.numero}`}
          className="folha-documento mt-4 overflow-hidden rounded-lg border border-border shadow-sm"
        >
          <div className="border-t-4 px-6 pb-6 pt-6 sm:px-10" style={{ borderTopColor: corDocumento }}>
            <div className="flex flex-wrap items-start justify-between gap-6 sm:flex-nowrap">
              <div className="flex min-w-0 items-center gap-4">
                {/* Mantem <img> no documento imprimivel/PDF para preservar a renderizacao do logo institucional. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={identidade.logoSrc} alt={identidade.logoAlt} className="h-12 w-auto" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{identidade.nomeLegal}</p>
                  <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">Proposta comercial</h1>
                </div>
              </div>
              <div className="shrink-0 text-sm sm:text-right">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Proposta nº</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums">{versao.numero}</p>
                <p className="text-muted-foreground">
                  Versão {versao.versao} · {statusLabel}
                </p>
              </div>
            </div>
          </div>

          <dl className="grid grid-cols-2 border-y border-border sm:grid-cols-[1.6fr_1fr_1fr]">
            <div className="col-span-2 px-6 py-4 sm:col-span-1 sm:px-10">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Valor total</dt>
              <dd className="mt-1 text-3xl font-semibold tabular-nums" style={{ color: corDocumento }}>
                {brl(totalProposta)}
              </dd>
            </div>
            <div className="border-t border-border px-6 py-4 sm:border-l sm:border-t-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Emissão</dt>
              <dd className="mt-1 text-base font-medium">{formatDate(versao.criado_em)}</dd>
            </div>
            <div className="border-l border-t border-border px-6 py-4 sm:border-t-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Válida até</dt>
              <dd className="mt-1 text-base font-medium">{formatDate(versao.valido_ate)}</dd>
              {diasValidade > 0 && (
                <dd className="text-xs text-muted-foreground">{diasValidade} dias a partir da emissão</dd>
              )}
            </div>
          </dl>

          <div className="grid gap-6 px-6 py-6 sm:grid-cols-2 sm:px-10">
            <ParteDocumento titulo="Proponente" nome={identidade.nomeLegal} />
            <ParteDocumento
              titulo="Cliente"
              nome={nomeCliente}
              detalhes={[
                demanda?.cliente_cnpj ? `CNPJ/CPF: ${demanda.cliente_cnpj}` : null,
                demanda?.cliente_contato ? `Contato: ${demanda.cliente_contato}` : null,
              ]}
            />
          </div>

          <SecaoDocumento titulo="Objeto">
            <p className="font-medium">{demanda?.titulo ?? `Orçamento #${versao.demanda_id}`}</p>
            <p className="text-sm text-muted-foreground">{rotuloModalidade(demanda?.modalidade)}</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
              {demanda?.escopo_preliminar || demanda?.descricao || "—"}
            </p>
          </SecaoDocumento>

          <SecaoDocumento
            titulo="Serviços e valores"
            permiteQuebra
            ajuda={
              <HelpTip title="Serviços e valores">
                <p>O total da proposta é dividido entre os itens na <b>proporção do custo técnico</b> de cada um. A soma das linhas sempre fecha com o total.</p>
                <HelpExample>Custos de R$ 300 e R$ 700, total de R$ 1.500 → linhas de R$ 450 e R$ 1.050.</HelpExample>
              </HelpTip>
            }
          >
            {/* aviso para a equipe: não vai ao papel nem ao DOCX */}
            {dadosExport.avisoLegado && (
              <p className="no-print mb-3 text-xs text-muted-foreground">{dadosExport.avisoLegado}</p>
            )}
            {/* No celular o componente vai acima da descrição: a tabela cabe sem rolar. */}
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b-2 text-xs uppercase tracking-wide text-muted-foreground" style={{ borderBottomColor: corDocumento }}>
                  <th scope="col" className="hidden py-2 pr-3 font-semibold sm:table-cell">Componente</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Descrição</th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">Qtd.</th>
                  <th scope="col" className="py-2 text-right font-semibold">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {composicaoCliente.map((item) => (
                  <tr key={`${item.componente}-${item.descricao}`}>
                    <td className="hidden py-3 pr-3 align-top font-medium sm:table-cell">{item.componente}</td>
                    <td className="py-3 pr-3 align-top text-muted-foreground">
                      <span className="block font-medium text-foreground sm:hidden">{item.componente}</span>
                      {item.descricao}
                    </td>
                    <td className="py-3 pr-3 text-right align-top tabular-nums">{item.quantidade}</td>
                    <td className="whitespace-nowrap py-3 text-right align-top font-medium tabular-nums">{brl(item.valorComercial)}</td>
                  </tr>
                ))}
                {composicaoCliente.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-5 text-center text-sm text-muted-foreground">
                      Nenhum item registrado nesta versão.
                    </td>
                  </tr>
                )}
              </tbody>
              <tbody>
                <tr className="border-t-2 border-foreground/70">
                  <td className="hidden sm:table-cell" />
                  <th scope="row" colSpan={2} className="py-3 pr-3 text-right font-semibold">
                    Total
                  </th>
                  <td className="whitespace-nowrap py-3 text-right text-base font-semibold tabular-nums">{brl(totalProposta)}</td>
                </tr>
              </tbody>
            </table>
          </SecaoDocumento>

          <SecaoDocumento titulo="Condições comerciais">
            <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
              <li>
                {diasValidade > 0
                  ? `Valores válidos por ${diasValidade} dias a partir da emissão.`
                  : `Valores válidos até ${formatDate(versao.valido_ate)}.`}
              </li>
              <li>Alterações de escopo, quantidade de amostras, premissas técnicas ou cronograma podem exigir nova versão da proposta.</li>
            </ul>
          </SecaoDocumento>

          <div className="manter-junto grid gap-10 border-t border-border px-6 pb-10 pt-8 sm:grid-cols-2 sm:px-10">
            <LinhaAssinatura titulo="Pela proponente" nome={identidade.nomeLegal} />
            <LinhaAssinatura titulo="De acordo, pelo cliente" nome={nomeCliente === "—" ? "Nome e cargo" : nomeCliente} />
          </div>

          <footer className="proposal-footer flex flex-wrap justify-between gap-2 border-t border-border px-6 py-3 text-xs text-muted-foreground sm:px-10">
            <span>{identidade.nomeLegal}</span>
            <span>
              Proposta {versao.numero} · versão {versao.versao}
            </span>
          </footer>
        </article>

        <section id="modo-interno" className="mt-5 rounded-lg border border-border bg-card p-5 shadow-sm print:hidden">
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
                <SubmitButton
                  variant="outline"
                  pendingLabel="Duplicando…"
                  title="Cria nova versão com os mesmos itens e valores; a versão em vigor passa a substituída."
                >
                  Duplicar versão
                </SubmitButton>
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
                  triggerClassName="rounded-md border border-danger-strong/30 px-3 py-2 text-sm font-medium text-danger-strong hover:bg-danger-soft"
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

          <section className="no-print mt-6 rounded-lg border border-border p-4">
            <div className="flex items-center gap-1">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Link de aprovação do cliente</h2>
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

          <section className="mt-6 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Parâmetros econômicos
              </h2>
              <span className="text-xs text-muted-foreground">
                Σ parâmetros: {Number(consolidado.markupProjeto ?? 0).toLocaleString("pt-BR")}%
              </span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {(consolidado.parametrosProjeto ?? []).map((parametro) => (
                <div key={parametro.key ?? parametro.label} className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span>{parametro.label ?? parametro.key}</span>
                    <span className="font-medium">{Number(parametro.nominalRate ?? 0).toLocaleString("pt-BR")}%</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{brl(Number(parametro.amount ?? 0))}</p>
                </div>
              ))}
              {(consolidado.parametrosProjeto ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground/80">Sem parâmetros registrados nesta versão.</p>
              )}
            </div>
          </section>

          <section className="mt-6 rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Composição detalhada</h2>
            <div className="mt-4 space-y-5">
              <TabelaAnalisesSnapshot titulo="Análises laboratoriais" itens={itensLaboratorio} tipo="laboratorio" />
              <TabelaCustosSnapshot titulo="Custos próprios do projeto" itens={custosProjeto} />
              <TabelaAnalisesSnapshot titulo="Análises dentro de projeto" itens={analisesProjeto} tipo="projeto" />
            </div>
          </section>

          <section className="mt-6 rounded-lg border border-border p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Origem e auditoria</h2>
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
              <Campo titulo="Valores" valor="Congelados na emissão" />
              <Campo titulo="Status da versão" valor={statusLabel} />
              <Campo titulo="Orçamento de origem" valor={`#${versao.demanda_id}`} />
            </div>
            <div className="mt-4 divide-y divide-border rounded-md border border-border">
              {origens.map((origem) => (
                <div key={origem.campo ?? origem.titulo} className="grid gap-2 px-3 py-3 text-sm md:grid-cols-[1fr_2fr_auto]">
                  <p className="font-medium">{origem.titulo ?? origem.campo}</p>
                  <p className="text-muted-foreground">
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
      <h3 className="text-xs font-semibold text-muted-foreground">{titulo}</h3>
      <div className="mt-2 overflow-x-auto rounded-md border border-border">
        <table className="w-full text-right text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Origem</th>
              <th className="px-3 py-2 text-left">Análise</th>
              <th className="px-3 py-2">Amostras</th>
              <th className="px-3 py-2">{tipo === "laboratorio" ? "Custo unit." : "Custo/amostra"}</th>
              <th className="px-3 py-2">{tipo === "laboratorio" ? "Preço unit." : "Preço registrado"}</th>
              <th className="px-3 py-2">Subtotal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {itens.map((item, index) => (
              <tr key={`${item.origem}-${item.id ?? index}`}>
                <td className="px-3 py-2 text-left text-muted-foreground">{item.origem} · {item.status}</td>
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
                <td colSpan={6} className="px-3 py-5 text-center text-xs text-muted-foreground/80">
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
      <h3 className="text-xs font-semibold text-muted-foreground">{titulo}</h3>
      <div className="mt-2 overflow-x-auto rounded-md border border-border">
        <table className="w-full text-right text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Origem</th>
              <th className="px-3 py-2 text-left">Rubrica</th>
              <th className="px-3 py-2 text-left">Descrição</th>
              <th className="px-3 py-2">Qtd.</th>
              <th className="px-3 py-2">Custo unit.</th>
              <th className="px-3 py-2">Subtotal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {itens.map((item, index) => (
              <tr key={`${item.origem}-${item.id ?? index}`}>
                <td className="px-3 py-2 text-left text-muted-foreground">{item.origem} · {item.status}</td>
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
                <td colSpan={6} className="px-3 py-5 text-center text-xs text-muted-foreground/80">
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
    <div className="rounded-md bg-muted/50 p-3">
      <dt className="text-xs font-medium text-muted-foreground">{titulo}</dt>
      <dd className="mt-1 font-medium">{valor}</dd>
    </div>
  );
}

/** Seção da folha. Na impressão não se parte entre páginas, salvo `permiteQuebra` (tabela longa). */
function SecaoDocumento({
  titulo,
  ajuda,
  permiteQuebra = false,
  children,
}: {
  titulo: string;
  ajuda?: ReactNode;
  permiteQuebra?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`border-t border-border px-6 py-6 sm:px-10${permiteQuebra ? " permite-quebra" : ""}`}>
      <div className="flex items-center gap-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</h2>
        {ajuda && <span className="no-print">{ajuda}</span>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ParteDocumento({ titulo, nome, detalhes = [] }: { titulo: string; nome: string; detalhes?: (string | null)[] }) {
  const linhas = detalhes.filter((linha): linha is string => Boolean(linha));
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</p>
      <p className="mt-2 font-medium">{nome}</p>
      {linhas.map((linha) => (
        <p key={linha} className="text-sm text-muted-foreground">{linha}</p>
      ))}
    </div>
  );
}

function LinhaAssinatura({ titulo, nome }: { titulo: string; nome: string }) {
  return (
    <div>
      <div className="h-12 border-b border-foreground/60" />
      <p className="mt-2 text-xs text-muted-foreground">{titulo}</p>
      <p className="text-sm font-medium">{nome}</p>
      <p className="mt-1 text-xs text-muted-foreground">Data: ____/____/________</p>
    </div>
  );
}

function Resumo({ titulo, valor, destaque = false }: { titulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${destaque ? "border-brand-200 bg-brand-50 dark:border-brand-900 dark:bg-brand-950/30" : "border-border"}`}>
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <p className={`mt-1 text-base font-semibold tabular-nums ${destaque ? "text-brand-700 dark:text-brand-300" : ""}`}>
        {brl(Number(valor ?? 0))}
      </p>
    </div>
  );
}
