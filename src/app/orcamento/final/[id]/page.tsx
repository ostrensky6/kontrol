import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { HelpTip } from "@/components/common/HelpTip";
import { SubmitButton } from "@/components/common/SubmitButton";
import { CancelarComMotivo } from "@/components/orcamento/CancelarComMotivo";
import { DocumentoProposta } from "@/components/orcamento/documento/DocumentoProposta";
import { ExportOrcamentoFinalButtons } from "@/components/orcamento/ExportOrcamentoFinalButtons";
import { FormEstado } from "@/components/orcamento/FormEstado";
import { PainelInterno } from "@/components/orcamento/interno/PainelInterno";
import { LinkPublicoPainel, type LinkPublicoResumo } from "@/components/orcamento/LinkPublicoPainel";
import { PrintButton } from "@/components/orcamento/PrintButton";
import { buttonVariants } from "@/components/ui/button";
import {
  cancelarVersaoFinal,
  duplicarVersaoFinal,
  gerarPlanejamentoDaProposta,
  reemitirComPercentuais,
} from "@/lib/actions/orcamento-historico";
import { criarLinkPublico, revogarLinkPublico } from "@/lib/actions/orcamento-projetos";
import { salvarTextosVersao } from "@/lib/actions/orcamento-textos";
import { temPermissao } from "@/lib/auth/permissao-efetiva";
import { formatCurrency as brl, formatDate, formatDateTime } from "@/lib/formatters";
import { carregarComplementosDocumento } from "@/lib/orcamento/complementos-documento";
import { montarDocumentoProposta } from "@/lib/orcamento/documento-proposta";
import { empresaDoSnapshot } from "@/lib/orcamento/empresas-emissoras";
import { PARAMETROS_PROPOSTA } from "@/lib/orcamento/engine-economica";
import { podeOrcamento } from "@/lib/orcamento/governanca";
import { resolverIdentidadeComAviso } from "@/lib/orcamento/identidade-institucional";
import { explicarOrigem } from "@/lib/orcamento/orcamento-final";
import { rotuloModalidade } from "@/lib/orcamento/orcamento-economico";
import { montarPropostaFinalExport } from "@/lib/orcamento/proposta-final-export";
import {
  hojeCalendario,
  rotuloStatusModulo,
  rotuloStatusVersaoFinal,
  statusEfetivoVersaoFinal,
} from "@/lib/orcamento/rotulos-status";
import { textosDaVersao } from "@/lib/orcamento/textos-proposta";
import { STATUS_APROVADOS, STATUS_VIVOS, estaVencida } from "@/lib/orcamento/transicoes-versao";
import { entradaDoSnapshot, mascararPessoalVisao, montarFundos, montarVisaoInterna } from "@/lib/orcamento/visao-interna";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SnapshotFinal = {
  demanda?: {
    id?: number;
    titulo?: string | null;
    cliente_nome?: string | null;
    instituicao?: string | null;
    cliente_cnpj?: string | null;
    cliente_contato?: string | null;
    cliente_email?: string | null;
    cliente_telefone?: string | null;
    cliente_endereco?: string | null;
    modalidade?: string | null;
    escopo_preliminar?: string | null;
    descricao?: string | null;
    matriz_amostra?: string | null;
    quantidade_amostras_estimada?: number | null;
    prazo_tecnico_dias?: number | null;
  };
  orcamentos_analises?: Array<{ id?: number; status?: string | null; orcamento_itens?: Array<{ codigo_analise?: string | null }> }>;
  orcamentos_projeto?: Array<{ id?: number; status?: string | null; orcamento_projeto_analises?: Array<{ codigo_analise?: string | null }> }>;
  consolidado?: {
    origens?: Array<{ campo?: string; titulo?: string; regra?: string; valor?: number }>;
    economia?: { parametros?: Array<{ chave?: string; percentual?: number }> };
  };
  origem_versao?: { numero?: string; motivo?: string };
};

function lerSnapshot(snapshot: Json): SnapshotFinal {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return {};
  return snapshot as SnapshotFinal;
}

/** Título da aba e nome sugerido do PDF: a empresa, nunca o Kontrol (ferramenta interna). */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("orcamento_final_versoes")
    .select("numero, demanda_id")
    .eq("id", Number(id))
    .maybeSingle();
  if (!data) return { title: "Proposta comercial" };
  const { data: demanda } = await supabase
    .from("demandas_propostas")
    .select("instituicao")
    .eq("id", data.demanda_id)
    .maybeSingle();
  const { identidade } = resolverIdentidadeComAviso(demanda?.instituicao);
  return { title: `Proposta ${data.numero} · ${identidade.nomeLegal}` };
}

export default async function OrcamentoFinalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string; aba?: string; sub?: string }>;
}) {
  const [{ id }, { erro, aba: abaParam, sub }] = await Promise.all([params, searchParams]);
  const aba = abaParam === "documento" ? "documento" : "interno";
  const versaoId = Number(id);
  const operacaoDuplicacaoId = randomUUID();
  const operacaoReemissaoId = randomUUID();
  const [podeDuplicar, podeCancelar, podeEmitir, podeParametros, podePlanejar, podePessoalOrcamento, podeSalarioTecnicos] =
    await Promise.all([
      podeOrcamento("duplicar_final"),
      podeOrcamento("cancelar_documento"),
      podeOrcamento("emitir_final"),
      podeOrcamento("editar_parametros"),
      temPermissao("planejamento.editar"),
      temPermissao("orcamentos.pessoal"),
      temPermissao("tecnicos.salario.ver"),
    ]);
  // DC8: sem a permissão de pessoal, PE aparece como XXX e a planilha interna não é oferecida.
  const podeVerPessoal = podePessoalOrcamento || podeSalarioTecnicos;
  const supabase = await createClient();

  const { data: versao } = await supabase.from("orcamento_final_versoes").select("*").eq("id", versaoId).single();
  if (!versao) notFound();

  const [{ data: planoGerado }, { data: linksRaw }, { data: outrasVersoes }, { data: demandaAtual }, { data: acompanhamento }] =
    await Promise.all([
      // Proposta aprovada gera o plano sozinha (0122); cancelado não conta (0126).
      supabase
        .from("planejamento")
        .select("id, status_operacional")
        .eq("orcamento_final_versao_id", versaoId)
        .neq("status_operacional", "cancelado")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle(),
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
      supabase
        .from("demandas_propostas")
        .select("id, titulo, instituicao, cliente_nome, cliente_cnpj, cliente_contato, cliente_email, cliente_telefone, cliente_endereco, modalidade, escopo_preliminar, descricao, matriz_amostra, quantidade_amostras_estimada, prazo_tecnico_dias")
        .eq("id", versao.demanda_id)
        .single(),
      supabase
        .from("orcamento_fundos_acompanhamento")
        .select("valor_recebido, impostos_pagos, incubacao_paga, reserva_gasta, investimento_gasto, reserva_saldo_ajustado, investimento_saldo_ajustado")
        .eq("orcamento_final_versao_id", versaoId)
        .order("atualizado_em", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const links = (linksRaw ?? []) as LinkPublicoResumo[];
  const hoje = hojeCalendario();
  const vencida = estaVencida(versao.valido_ate, hoje);
  const aprovada = (STATUS_APROVADOS as readonly string[]).includes(versao.status);
  const viva = (STATUS_VIVOS as readonly string[]).includes(versao.status);
  // A reformulação (0139) de uma versão aprovada pode ser enviada e aprovada: aprovada, substitui a anterior.
  const outraAprovada = (outrasVersoes ?? []).find(
    (v) => (STATUS_APROVADOS as readonly string[]).includes(v.status) && v.id !== versao.reformulacao_de,
  );
  const reformulaAprovada = versao.reformulacao_de
    ? (outrasVersoes ?? []).find((v) => v.id === versao.reformulacao_de && (STATUS_APROVADOS as readonly string[]).includes(v.status))
    : undefined;
  const versaoMaisNova = (outrasVersoes ?? []).find(
    (v) => v.versao > versao.versao && (STATUS_VIVOS as readonly string[]).includes(v.status),
  );
  const motivoSemLink = !viva
    ? "Link de aprovação só existe para proposta emitida ou enviada, ainda não aprovada."
    : vencida
      ? "Proposta vencida: emita uma nova versão antes de enviar o link."
      : !podeEmitir
        ? "Criar ou revogar o link exige a permissão “Orçamentos: Emitir proposta”."
        : null;
  const linkAtivo = links.find((l) => !l.revogado && !l.aprovado_em);

  const snapshot = lerSnapshot(versao.snapshot);
  const demanda = snapshot.demanda ?? demandaAtual;
  // Não lança: versões antigas sem instituição ainda abrem, com aviso.
  const { identidade, aviso: avisoIdentidade } = resolverIdentidadeComAviso(demanda?.instituicao);
  const total = Number(versao.total_final ?? 0);

  const complementos = await carregarComplementosDocumento(supabase, {
    identidade,
    codigosAnalises: [
      ...(snapshot.orcamentos_analises ?? []).flatMap((o) => (o.orcamento_itens ?? []).map((i) => i.codigo_analise)),
      ...(snapshot.orcamentos_projeto ?? []).flatMap((o) => (o.orcamento_projeto_analises ?? []).map((i) => i.codigo_analise)),
    ],
  });
  const visao = montarVisaoInterna(entradaDoSnapshot(versao.snapshot, total, complementos.nomesAnalises));
  const fundos = montarFundos(
    visao,
    acompanhamento
      ? {
          valorRecebido: Number(acompanhamento.valor_recebido ?? 0),
          impostosPagos: Number(acompanhamento.impostos_pagos ?? 0),
          incubacaoPaga: Number(acompanhamento.incubacao_paga ?? 0),
          reservaGasta: Number(acompanhamento.reserva_gasta ?? 0),
          investimentoGasto: Number(acompanhamento.investimento_gasto ?? 0),
          reservaSaldoAjustado: acompanhamento.reserva_saldo_ajustado,
          investimentoSaldoAjustado: acompanhamento.investimento_saldo_ajustado,
        }
      : null,
  );

  const diasValidade = Number(versao.validade_dias ?? 0);
  const textos = textosDaVersao({
    coluna: versao.textos_proposta,
    snapshot: versao.snapshot,
    escopoLegado: demanda?.escopo_preliminar || demanda?.descricao || null,
    validadeTexto:
      diasValidade > 0
        ? `Valores válidos por ${diasValidade} dias a partir da emissão.`
        : `Valores válidos até ${formatDate(versao.valido_ate)}.`,
  });
  const documento = montarDocumentoProposta({
    versao,
    demanda: demanda ?? null,
    visao,
    textos,
    empresa: empresaDoSnapshot(versao.snapshot, identidade) ?? complementos.empresa,
  });
  // Planilha interna (XLSX): estrutura antiga, mantida.
  const dadosExport = montarPropostaFinalExport({
    versao,
    snapshot: versao.snapshot,
    demanda: demanda ?? null,
    responsavel: identidade.responsavel,
  });

  const statusLabel = rotuloStatusVersaoFinal(statusEfetivoVersaoFinal(versao));
  const botaoSecundario = buttonVariants({ variant: "outline", size: "sm" });
  const podeEditarTextos = viva && !vencida && podeEmitir;
  const motivoSemPercentuais = visao.legado
    ? "Versão emitida com a regra econômica anterior: para mudar percentuais, altere na elaboração e emita de novo."
    : aprovada || outraAprovada
      ? "Proposta aprovada: os percentuais não mudam mais."
      : versao.status === "cancelado"
        ? null
        : versaoMaisNova
          ? `Os percentuais se alteram na versão em vigor (${versaoMaisNova.numero}).`
          : !podeEmitir || !podeParametros
            ? "Alterar percentuais exige as permissões de emitir proposta e de parâmetros."
            : null;
  const percentuaisAtuais = Object.fromEntries(
    PARAMETROS_PROPOSTA.map((p) => [
      p.chave,
      Number((snapshot.consolidado?.economia?.parametros ?? []).find((x) => x.chave === p.chave)?.percentual ?? 0),
    ]),
  ) as Record<(typeof PARAMETROS_PROPOSTA)[number]["chave"], number>;
  const podeAlterarPercentuais = !motivoSemPercentuais && versao.status !== "cancelado";
  const origens = snapshot.consolidado?.origens ?? [];
  const orcamentosOrigem = [
    ...(snapshot.orcamentos_analises ?? []).map((o) => `Laboratório nº ${o.id ?? "—"} (${o.status ? rotuloStatusModulo(o.status) : "—"})`),
    ...(snapshot.orcamentos_projeto ?? []).map((o) => `Projeto nº ${o.id ?? "—"} (${o.status ? rotuloStatusModulo(o.status) : "—"})`),
  ];

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground print:min-h-0">
      <main className="print-area app-page-container">
        <div className="no-print">
          <Breadcrumbs
            items={[
              { label: "Orçamentos", href: "/orcamento/demandas" },
              { label: demanda?.titulo ?? `Orçamento #${versao.demanda_id}`, href: `/orcamento/demandas/${versao.demanda_id}` },
              { label: versao.numero },
            ]}
          />
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight">Proposta {versao.numero}</h1>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">{statusLabel}</span>
                <span className="text-lg font-semibold tabular-nums text-brand-800 dark:text-brand-200">{brl(total)}</span>
                {reformulaAprovada && (
                  <span
                    className="rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-medium text-warning-strong"
                    title={`Quando aprovada, esta versão substitui a ${reformulaAprovada.numero}, que fica no histórico.`}
                  >
                    Reformulação da {reformulaAprovada.numero}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {[
                  demanda?.cliente_nome || "Cliente sem nome",
                  rotuloModalidade(demanda?.modalidade),
                  `emitida em ${formatDate(versao.criado_em)}`,
                  versao.valido_ate ? `válida até ${formatDate(versao.valido_ate)}` : null,
                  identidade.nomeCurto,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/orcamento/demandas/${versao.demanda_id}`} className={botaoSecundario}>
                Voltar ao orçamento
              </Link>
              {planoGerado && (
                <Link href={`/planejamento/${planoGerado.id}`} className={botaoSecundario}>
                  Planejamento nº {planoGerado.id}
                </Link>
              )}
              {podeDuplicar && !aprovada && !outraAprovada && (
                <form action={duplicarVersaoFinal}>
                  <input type="hidden" name="versao_id" value={versao.id} />
                  <input type="hidden" name="operacao_id" value={operacaoDuplicacaoId} />
                  <input type="hidden" name="validade_dias" value={versao.validade_dias ?? 30} />
                  <SubmitButton
                    variant="outline"
                    size="sm"
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
                  triggerClassName="inline-flex h-8 items-center rounded-md border border-danger-strong/30 px-3 text-xs font-medium text-danger-strong hover:bg-danger-soft"
                />
              )}
              <ExportOrcamentoFinalButtons
                dados={podeVerPessoal || !visao.grupos.some((grupo) => grupo.id === "PE") ? dadosExport : null}
                documento={documento}
              />
              <PrintButton destaque />
            </div>
          </div>

          {[
            erro ? { tom: "erro" as const, texto: erro } : null,
            versaoMaisNova ? { tom: "aviso" as const, texto: `Existe uma versão mais nova desta proposta (${versaoMaisNova.numero}).`, link: `/orcamento/final/${versaoMaisNova.id}` } : null,
            viva && vencida ? { tom: "aviso" as const, texto: `Proposta vencida em ${formatDate(versao.valido_ate)}: não pode mais ser aprovada. Emita uma nova versão.` } : null,
            avisoIdentidade ? { tom: "aviso" as const, texto: avisoIdentidade } : null,
            snapshot.origem_versao?.numero
              ? { tom: "info" as const, texto: `Versão criada a partir da ${snapshot.origem_versao.numero} (${snapshot.origem_versao.motivo ?? "nova versão"}).` }
              : null,
          ]
            .filter((a): a is NonNullable<typeof a> => Boolean(a))
            .map((a) => (
              <p
                key={a.texto}
                role={a.tom === "erro" ? "alert" : undefined}
                className={`mt-2 rounded-md px-3 py-1.5 text-sm ${
                  a.tom === "erro"
                    ? "bg-danger-soft text-danger-strong"
                    : a.tom === "aviso"
                      ? "border border-warning-strong/30 bg-warning-soft text-warning-strong"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {a.texto}{" "}
                {"link" in a && a.link && (
                  <Link href={a.link} className="font-medium underline">
                    Abrir a versão em vigor
                  </Link>
                )}
              </p>
            ))}

          <nav aria-label="Modo de exibição" className="mt-3 flex gap-1 border-b border-border">
            {[
              { id: "interno", rotulo: "Interno", ajuda: "custos, percentuais e auditoria" },
              { id: "documento", rotulo: "Documento do cliente", ajuda: "o que vai impresso, em PDF e no link" },
            ].map((t) => (
              <Link
                key={t.id}
                href={t.id === "interno" ? `/orcamento/final/${versao.id}` : `/orcamento/final/${versao.id}?aba=documento`}
                aria-current={aba === t.id ? "page" : undefined}
                title={t.ajuda}
                className={`-mb-px border-b-2 px-4 py-2 text-sm ${
                  aba === t.id
                    ? "border-brand-600 font-semibold text-brand-800 dark:border-brand-400 dark:text-brand-200"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.rotulo}
              </Link>
            ))}
          </nav>
        </div>

        {aba === "interno" && (
          <section aria-label="Modo interno" className="mt-4 space-y-4 print:hidden">
            <details className="group rounded-md border border-border bg-card px-3 py-2 text-sm">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                <span className="font-medium">Link de aprovação do cliente:</span>
                <span className="text-muted-foreground">
                  {linkAtivo
                    ? `ativo desde ${formatDateTime(linkAtivo.criado_em)}`
                    : links.some((l) => l.aprovado_em)
                      ? "aprovado pelo cliente"
                      : motivoSemLink ?? "nenhum link criado"}
                </span>
                <span className="ml-auto text-xs font-medium text-primary group-open:hidden">Abrir</span>
                <HelpTip title="Link de aprovação">
                  <p>Endereço para o cliente ver a proposta e aprovar <b>sem login</b>. Vale só para esta versão.</p>
                  <p>Nova versão, cancelamento ou vencimento encerram o link. Aprovar pelo link cria o planejamento, como a aprovação pela equipe.</p>
                </HelpTip>
              </summary>
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
            </details>

            {aprovada && !planoGerado && (
              <div className="rounded-md border border-brand-200 bg-brand-50 p-3 text-sm dark:border-brand-900 dark:bg-brand-950/30">
                {visao.grupos.every((g) => g.id !== "laboratorio" && g.id !== "analises_projeto") ? (
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

            <PainelInterno
              visao={podeVerPessoal ? visao : mascararPessoalVisao(visao)}
              fundos={{ ...fundos, hrefFundos: "/orcamento/fundos" }}
              subInicial={sub}
              motivoSemPercentuais={motivoSemPercentuais}
              percentuais={
                podeAlterarPercentuais
                  ? {
                      valores: percentuaisAtuais,
                      custoLaboratorio: visao.grupos.filter((g) => g.id === "laboratorio").reduce((a, g) => a + g.custoTotal, 0),
                      custoProjeto: visao.grupos.filter((g) => g.id !== "laboratorio").reduce((a, g) => a + g.custoTotal, 0),
                      action: reemitirComPercentuais,
                      campos: { versao_id: versao.id, operacao_id: operacaoReemissaoId },
                      rotuloSalvar: `Salvar como versão ${versao.versao + 1}`,
                      aviso: `O total muda, então nasce a versão ${versao.versao + 1} com os mesmos custos e textos; esta passa a substituída e o link dela é encerrado.`,
                    }
                  : null
              }
            />

            <details className="rounded-md border border-border bg-card px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium">Auditoria e origem dos valores</summary>
              <div className="mt-3 space-y-3">
                <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
                  <dt className="text-muted-foreground">Valores</dt>
                  <dd>Congelados na emissão ({formatDateTime(versao.criado_em)})</dd>
                  <dt className="text-muted-foreground">Situação</dt>
                  <dd>{statusLabel}</dd>
                  <dt className="text-muted-foreground">Orçamento</dt>
                  <dd>
                    <Link href={`/orcamento/demandas/${versao.demanda_id}`} className="text-primary hover:underline">
                      nº {versao.demanda_id}
                    </Link>
                    {orcamentosOrigem.length > 0 && ` · ${orcamentosOrigem.join(" · ")}`}
                  </dd>
                </dl>
                {origens.length > 0 && (
                  <div className="divide-y divide-border rounded-md border border-border">
                    {origens.map((origem) => (
                      <div key={origem.campo ?? origem.titulo} className="grid gap-1 px-3 py-2 md:grid-cols-[1fr_2fr_auto] md:gap-3">
                        <p className="font-medium">{origem.titulo ?? origem.campo}</p>
                        <p className="text-muted-foreground">
                          {visao.legado ? origem.regra ?? "Valor registrado na emissão." : explicarOrigem(origem)}
                        </p>
                        <p className="font-semibold tabular-nums md:text-right">{brl(Number(origem.valor ?? 0))}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          </section>
        )}

        {/* O documento sempre vai ao papel, qualquer que seja a aba aberta. */}
        <div className={aba === "documento" ? "mt-4 space-y-3" : "hidden print:block"}>
          {documento.avisos.length > 0 && (
            <ul className="no-print space-y-1 text-xs text-warning-strong">
              {documento.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          {aba === "documento" && !podeEditarTextos && (
            <p className="no-print text-xs text-muted-foreground">
              {viva && !vencida
                ? "Editar os textos exige a permissão “Orçamentos: Emitir proposta”."
                : "Textos só leitura: a proposta não está mais emitida ou enviada dentro da validade."}
            </p>
          )}
          <DocumentoProposta
            modelo={documento}
            edicao={
              podeEditarTextos
                ? {
                    action: salvarTextosVersao,
                    campos: { versao_id: versao.id },
                    textos,
                    aviso: "Salva nesta versão, sem trocar o número. O link do cliente mostra o texto novo e a alteração fica na auditoria.",
                  }
                : null
            }
          />
        </div>
      </main>
    </div>
  );
}
