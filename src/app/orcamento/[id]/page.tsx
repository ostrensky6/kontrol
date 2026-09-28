import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { calcularTodas, type FonteCustoInsumos } from "@/lib/costing/loader";
import { PrintButton } from "@/components/orcamento/PrintButton";
import { FluxoProposta } from "@/components/orcamento/FluxoProposta";
import { RecalcularOrcamentoForm } from "@/components/orcamento/RecalcularOrcamentoForm";
import { ConfirmActionButton } from "@/components/common/ConfirmActionButton";
import { ConfirmSubmitButton } from "@/components/common/ConfirmSubmitButton";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import {
  salvarCabecalho,
  revisarOrcamentoLaboratorio,
  salvarItemOrcamento,
  cancelarOrcamento,
  excluirOrcamento,
} from "@/lib/actions/orcamentos";
import { FormEstado } from "@/components/orcamento/FormEstado";
import { CancelarComMotivo } from "@/components/orcamento/CancelarComMotivo";
import { SubmitButton } from "@/components/common/SubmitButton";
import { listarEventos } from "@/lib/actions/eventos";
import { Timeline } from "@/components/common/Timeline";
import { formatCurrency as brl, formatDate, formatDateTime } from "@/lib/formatters";
import { montarSnapshotLaboratorio } from "@/lib/orcamento/laboratorio-operacional";
import { moduloBloqueadoParaEdicao } from "@/lib/orcamento/ciclo-vida-modulo";
import { rotuloStatusModulo } from "@/lib/orcamento/rotulos-status";
import { HelpExample, HelpLegend, HelpTip } from "@/components/common/HelpTip";
import type { Json } from "@/lib/supabase/database.types";
import { podeOrcamento } from "@/lib/orcamento/governanca";

export const dynamic = "force-dynamic";

type Item = {
  id: number;
  codigo_analise: string;
  n_amostras: number;
  custo_unitario: number;
  preco_unitario: number;
  valor_snapshot?: Json | null;
};

type SnapshotLaboratorio = {
  gerado_em?: string;
  totais?: {
    reagentes?: number;
    materiais?: number;
    equipamentos?: number;
    mao_obra?: number;
    terceiros?: number;
    overhead?: number;
    custo?: number;
    preco?: number;
    amostras?: number;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberFrom(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default async function OrcamentoDetalhe({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro_exclusao?: string; aviso?: string }>;
}) {
  const { id } = await params;
  const { erro_exclusao: erroExclusao, aviso } = await searchParams;
  const orcId = Number(id);
  const supabase = await createClient();

  const { data: orc } = await supabase
    .from("orcamentos")
    .select("*")
    .eq("id", orcId)
    .single();
  if (!orc) notFound();

  const [{ data: itensRaw }, { data: analises }, { breakdowns }, { data: clientes }, { data: projetos }] =
    await Promise.all([
      supabase
        .from("orcamento_itens")
        .select("id, codigo_analise, n_amostras, custo_unitario, preco_unitario, valor_snapshot")
        .eq("orcamento_id", orcId)
        .order("id"),
      supabase.from("analises").select("codigo, nome").eq("ativo", true).eq("ofertavel", true).order("codigo"),
      calcularTodas({}, (orc.fonte_custo_insumos === "custo_medio_ponderado" ? "custo_medio_ponderado" : "custo_padrao") as FonteCustoInsumos),
      supabase.from("clientes").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("projetos").select("id, nome").order("nome"),
    ]);

  const { data: demanda } = orc.demanda_id
    ? await supabase
        .from("demandas_propostas")
        .select("id, titulo, modalidade, status, matriz_amostra, responsavel_interno")
        .eq("id", orc.demanda_id)
        .single()
    : { data: null };

  const projetoNome =
    orc.projeto_id != null
      ? (projetos ?? []).find((p) => p.id === orc.projeto_id)?.nome ?? null
      : null;

  const itens = (itensRaw ?? []) as Item[];
  const totalAmostras = itens.reduce((a, it) => a + Number(it.n_amostras), 0);
  const totalCusto = itens.reduce(
    (a, it) => a + Number(it.custo_unitario) * Number(it.n_amostras),
    0,
  );
  const totalPreco = itens.reduce(
    (a, it) => a + Number(it.preco_unitario) * Number(it.n_amostras),
    0,
  );
  const snapshotCalculado = montarSnapshotLaboratorio(itens, breakdowns) as SnapshotLaboratorio;
  const snapshotPersistido = isRecord(orc.custo_snapshot) ? (orc.custo_snapshot as SnapshotLaboratorio) : {};
  const snapshotOperacional = snapshotPersistido.totais ? snapshotPersistido : snapshotCalculado;
  const totaisOperacionais = snapshotOperacional.totais ?? {};
  const snapshotGeradoEm =
    isRecord(snapshotOperacional) && typeof snapshotOperacional.gerado_em === "string"
      ? snapshotOperacional.gerado_em
      : null;
  const statusOperacional = orc.status_operacional ?? (
    orc.status === "cancelado" ? "cancelado" : ["enviado", "aprovado"].includes(orc.status) ? "revisado" : itens.length > 0 ? "preenchido" : "pendente"
  );
  // Mesma regra do servidor: revisado/enviado/aprovado/cancelado não aceita edição direta.
  // cancelado no documento, mas o andamento ficou para trás (gravação que falhou)
  const cancelamentoIncompleto =
    orc.status === "cancelado" && orc.status_operacional != null && orc.status_operacional !== "cancelado";
  const bloqueado = moduloBloqueadoParaEdicao({ status: orc.status, statusOperacional: orc.status_operacional }).bloqueado;
  const motivoBloqueio = `Somente leitura: custos ${rotuloStatusModulo(orc.status_operacional === "revisado" ? "revisado" : orc.status).toLowerCase()}.`;
  const nomeAnalise = new Map((analises ?? []).map((analise) => [analise.codigo, analise.nome ?? null]));
  const breakdownPorCodigo = new Map(breakdowns.map((breakdown) => [breakdown.codigo, breakdown]));
  const linhasTecnicas = itens.map((item) => {
    const quantidade = Number(item.n_amostras);
    const breakdown = breakdownPorCodigo.get(item.codigo_analise);
    const snapshot = isRecord(item.valor_snapshot) ? item.valor_snapshot : {};
    const composicaoTotais = isRecord(snapshot.composicao_totais) ? snapshot.composicao_totais : {};
    const reagentes = numberFrom(composicaoTotais.reagentes, Number(breakdown?.reagentes ?? 0) * quantidade);
    const equipamentos = numberFrom(composicaoTotais.equipamento, Number(breakdown?.equipamento ?? 0) * quantidade);
    const maoObra = numberFrom(composicaoTotais.pessoal, Number(breakdown?.pessoal ?? 0) * quantidade);
    const overhead = numberFrom(composicaoTotais.overhead, Number(breakdown?.overhead ?? 0) * quantidade);
    const custo = Number(item.custo_unitario) * quantidade;
    const preco = Number(item.preco_unitario) * quantidade;
    return {
      id: item.id,
      codigo: item.codigo_analise,
      nome: nomeAnalise.get(item.codigo_analise),
      quantidade,
      lote: numberFrom(snapshot.lote_padrao, Number(breakdown?.lote ?? 0)) || null,
      numeroExecucoes: numberFrom(snapshot.numero_execucoes, 0) || null,
      reagentes,
      materiais: reagentes,
      equipamentos,
      maoObra,
      terceiros: 0,
      overhead,
      custo,
      preco,
      custoUnitario: Number(item.custo_unitario),
      precoUnitario: Number(item.preco_unitario),
      origem: snapshot.composicao_totais ? "Gravado no item" : breakdown ? "Custeio atual" : "Gravado no item",
    };
  });

  // detecta itens cujo preço atual difere do snapshot (parâmetros mudaram)
  const precoAtual = new Map(breakdowns.map((b) => [b.codigo, b.preco]));
  const desatualizado = itens.some((it) => {
    const atual = precoAtual.get(it.codigo_analise);
    return atual != null && Math.abs(atual - Number(it.preco_unitario)) > 0.005;
  });

  const eventos = await listarEventos("orcamento", orcId);
  const revisaoPendencias = [
    !orc.cliente_nome ? "informar cliente" : null,
    !orc.responsavel ? "informar responsável técnico" : null,
    itens.length === 0 ? "adicionar ao menos uma análise" : null,
    desatualizado ? "recalcular preços após mudança de parâmetros" : null,
  ].filter(Boolean) as string[];
  const custoResumo = Number(totaisOperacionais.custo ?? totalCusto);
  const tabs = [
    { href: "#identificacao-tecnica", label: "Identificação", meta: orc.responsavel ? "preenchida" : "pendente" },
    { href: "#analises-quantidades", label: "Análises", meta: `${itens.length} linha(s)` },
    { href: "#composicao-tecnica", label: "Composição", meta: `${totalAmostras} amostra(s)` },
    { href: "#totais-tecnicos", label: "Totais", meta: brl(custoResumo) },
    { href: "#revisao-laboratorio", label: "Revisão", meta: revisaoPendencias.length === 0 ? "liberada" : `${revisaoPendencias.length} pendência(s)` },
    { href: "#historico-laboratorio", label: "Histórico", meta: `${eventos.length} evento(s)` },
  ];

  const validade =
    orc.data_orcamento && orc.validade_dias
      ? formatDate(
          new Date(
            new Date(orc.data_orcamento).getTime() +
              orc.validade_dias * 86400000,
          ),
        )
      : null;

  const inp =
    "rounded-md border border-input bg-card px-2.5 py-1.5 text-sm font-medium text-brand-700 dark:text-brand-300"; // §8.2: entrada em azul
  const campo = `${inp} mt-0.5 h-8 w-full py-0`; // campos de uma linha: 32 px, como em Dados do orçamento
  const lbl = "block text-xs font-medium text-muted-foreground";
  const botaoSecundario = buttonVariants({ variant: "outline" });
  const operacaoRecalculoId = randomUUID();
  // Proposta aprovada gera o plano sozinha (0122); aqui só o link para ele.
  const { data: planoGerado } = await supabase
    .from("planejamento")
    .select("id")
    .eq("orcamento_id", orcId)
    .neq("status_operacional", "cancelado")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const [podeRecalcular, podeRevisar, podeCancelar] = await Promise.all([
    podeOrcamento("recalcular_custos"),
    podeOrcamento("revisar_modulo"),
    podeOrcamento("cancelar_documento"),
  ]);
  // Cada pendência da revisão leva ao campo onde ela se resolve.
  const formularioRevisaoVisivel =
    Boolean(demanda) && statusOperacional !== "revisado" && orc.status !== "cancelado" && podeRevisar;
  const alvoPendencia: Record<string, string | null> = {
    "informar cliente": demanda ? `/orcamento/demandas/${demanda.id}#demanda` : "#cabecalho-cliente",
    "informar responsável técnico": formularioRevisaoVisivel
      ? "#revisao-responsavel"
      : demanda
        ? null
        : "#cabecalho-responsavel",
    "adicionar ao menos uma análise": "#analises-quantidades",
  };

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="print-area app-page-container">
        <div className="no-print flex flex-wrap items-center justify-between gap-2">
          <Breadcrumbs items={[{ label: "Orçamentos", href: "/orcamento/demandas" }, { label: `Custos laboratoriais nº ${orc.id}` }]} />
          <div className="flex flex-wrap items-center gap-2">
            {demanda && (
              <span className="inline-flex items-center gap-0.5">
                <Link href={`/orcamento/demandas/${demanda.id}#demanda`} className={botaoSecundario}>
                  Editar dados do orçamento
                </Link>
                <HelpTip title="Dados comerciais herdados">
                  <p>Cliente, documento e contato vêm dos <b>dados do orçamento</b>; altere-os por lá. A proposta emitida guarda uma cópia própria desses dados.</p>
                </HelpTip>
              </span>
            )}
            {planoGerado && (
              <Link href={`/planejamento/${planoGerado.id}`} className={botaoSecundario}>
                Planejamento nº {planoGerado.id}
              </Link>
            )}
            <PrintButton />
            {podeRecalcular && (
              <RecalcularOrcamentoForm
                orcamentoId={orcId}
                fonteAtual={orc.fonte_custo_insumos ?? "custo_padrao"}
                operacaoId={operacaoRecalculoId}
              />
            )}
          </div>
        </div>

        {demanda && <FluxoProposta modalidade={demanda.modalidade} atual="laboratorio" />}

        {desatualizado && (
          <p className="no-print mt-3 rounded-md bg-warning-soft px-3 py-1.5 text-sm text-warning-strong">
            Os parâmetros de custo mudaram desde a emissão. Use “Recalcular
            preços” para atualizar os valores deste orçamento.
          </p>
        )}
        {erroExclusao && (
          <p className="no-print mt-3 rounded-md bg-danger-soft px-3 py-1.5 text-sm text-danger-strong">
            {erroExclusao}
          </p>
        )}
        {aviso && (
          <p role="status" className="no-print mt-3 rounded-md bg-amber-500/10 px-3 py-1.5 text-sm text-amber-800 dark:text-amber-200">
            {aviso}
          </p>
        )}

        {/* Documento imprimível */}
        <div className="mt-3 rounded-xl border border-border bg-card p-4 shadow-sm print:border-0 print:shadow-none">
          {/* div, não <header>: a regra de impressão esconde todo header (cabeçalho do app). */}
          <div>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className="text-lg font-semibold tracking-tight">Custos laboratoriais nº {orc.id}</h1>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">{rotuloStatusModulo(orc.status)}</span>
              <span className="text-lg font-semibold tabular-nums text-brand-800 dark:text-brand-200">{brl(custoResumo)}</span>
              <span className="text-xs text-muted-foreground">de custo</span>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {["Laboratório ATGC — Biologia Molecular", `Data: ${formatDate(orc.data_orcamento)}`, validade ? `Válido até: ${validade}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          {/* Dados comerciais vêm do orçamento (demanda); editar pelo botão do topo. */}
          {/* 3 colunas (4 em telas muito largas); os dois campos longos ocupam 2 e o dense fecha as lacunas. */}
          <dl className="mt-3 grid grid-flow-row-dense grid-cols-1 gap-x-6 gap-y-1 border-t border-border pt-3 text-sm sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            <Campo rotulo="Cliente">
              <span className="font-medium">{orc.cliente_nome ?? "—"}</span>
            </Campo>
            <Campo rotulo="CNPJ">{orc.cliente_cnpj ?? "—"}</Campo>
            <Campo rotulo="Contato">{orc.cliente_contato ?? "—"}</Campo>
            <Campo rotulo="Orçamento" className="lg:col-span-2">
              {demanda ? (
                <Link href={`/orcamento/demandas/${demanda.id}`} className="font-medium text-primary hover:underline">
                  nº {demanda.id} · {demanda.titulo}
                </Link>
              ) : (
                "—"
              )}
            </Campo>
            <Campo rotulo="Responsável">{orc.responsavel ?? "—"}</Campo>
            <Campo rotulo="Endereço" className="lg:col-span-2">{orc.cliente_endereco ?? "—"}</Campo>
            <Campo rotulo="Matriz/amostra">{demanda?.matriz_amostra ?? "—"}</Campo>
            <Campo rotulo="Projeto">{projetoNome ?? "—"}</Campo>
            <Campo rotulo="Fonte dos insumos">
              {orc.fonte_custo_insumos === "custo_medio_ponderado" ? "Média ponderada dos lotes liberados" : "Custo padrão aprovado"}
            </Campo>
            <Campo rotulo="Custo calculado em">{formatDateTime(snapshotGeradoEm)}</Campo>
          </dl>

          <nav aria-label="Seções da página" className="no-print sticky top-[57px] z-10 mt-3 overflow-x-auto border-y border-border bg-card/95 py-1.5 backdrop-blur md:top-0">
            <div className="flex min-w-max gap-1.5">
              {tabs.map((tab) => (
                <a
                  key={tab.href}
                  href={tab.href}
                  className="inline-flex items-baseline gap-1.5 rounded-md border border-primary/20 px-2.5 py-1 text-xs text-brand-800 transition hover:border-primary/40 hover:bg-primary/5 hover:text-brand-900 dark:text-brand-300"
                >
                  <span className="font-semibold">{tab.label}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{tab.meta}</span>
                </a>
              ))}
            </div>
          </nav>

          <section
            id="totais-tecnicos"
            aria-label="Preenchimento interno"
            className="no-print mt-3 scroll-mt-24 rounded-lg border border-border bg-muted/30 px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-semibold">Preenchimento interno</h2>
                <HelpTip title="Custo técnico">
                  <p>Tudo aqui é <b>custo</b>: insumos, equipamentos, mão de obra e overhead. O preço da proposta só é formado depois, nos parâmetros econômicos.</p>
                  <p><b>Preço preservado</b> é o preço de tabela das análises, mostrado apenas como referência.</p>
                  <HelpExample>Custo de R$ 80 por amostra e preço de tabela de R$ 120: a proposta parte dos R$ 80.</HelpExample>
                  <p>A etiqueta ao lado mostra a <b>conferência técnica</b> destes custos, não a situação da proposta:</p>
                  <HelpLegend
                    items={[
                      { tom: "neutro", rotulo: "Pendente", texto: "Nenhuma análise incluída ainda." },
                      { tom: "neutro", rotulo: "Preenchido", texto: "Há análises, mas falta a revisão técnica." },
                      { tom: "neutro", rotulo: "Revisado", texto: "Custos conferidos e travados para a proposta." },
                    ]}
                  />
                </HelpTip>
                <span className="rounded-full bg-card px-2 py-0.5 text-[11px] font-medium text-foreground ring-1 ring-border">
                  {rotuloStatusModulo(statusOperacional)}
                </span>
              </div>
              <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm sm:ml-auto">
                <ResumoOperacional titulo="Amostras" valor={Number(totaisOperacionais.amostras ?? totalAmostras)} numero />
                <ResumoOperacional titulo="Preço preservado" valor={Number(totaisOperacionais.preco ?? totalPreco)} discreto />
                <ResumoOperacional titulo="Subtotal custo" valor={custoResumo} destaque />
              </dl>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-1.5 text-sm sm:grid-cols-3 lg:grid-cols-6">
              <ResumoOperacional titulo="Reagentes" valor={Number(totaisOperacionais.reagentes ?? 0)} bloco />
              <ResumoOperacional titulo="Materiais" valor={Number(totaisOperacionais.materiais ?? 0)} bloco />
              <ResumoOperacional titulo="Equipamentos" valor={Number(totaisOperacionais.equipamentos ?? 0)} bloco />
              <ResumoOperacional titulo="Mão de obra" valor={Number(totaisOperacionais.mao_obra ?? 0)} bloco />
              <ResumoOperacional titulo="Terceiros" valor={Number(totaisOperacionais.terceiros ?? 0)} bloco />
              <ResumoOperacional titulo="Overhead" valor={Number(totaisOperacionais.overhead ?? 0)} bloco />
            </dl>
          </section>

          {/* Análises solicitadas */}
          <section id="analises-quantidades" className="mt-4 scroll-mt-24">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Análises e quantidades
              </h2>
              <span className="text-xs text-muted-foreground/80">
                {bloqueado && <span className="no-print mr-2 font-medium text-warning-strong">{motivoBloqueio}</span>}
                {totalAmostras} amostra(s)
              </span>
            </div>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-right text-sm">
              <thead className="bg-transparent text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Análise</th>
                  <th className="px-3 py-2 text-left">Matriz</th>
                  <th className="px-3 py-2">
                    <span className="inline-flex items-center gap-1">
                      Lote
                      <HelpTip title="Lote da análise" className="no-print">
                        <p>Quantas amostras cabem em <b>uma corrida</b>. Itens cobrados por corrida, como controles, são divididos entre elas.</p>
                        <HelpExample>Controle de R$ 60 por corrida e lote de 12: R$ 5 por amostra.</HelpExample>
                      </HelpTip>
                    </span>
                  </th>
                  <th className="px-3 py-2">Amostras</th>
                  <th className="px-3 py-2 no-print">Reagentes</th>
                  <th className="px-3 py-2">Equip.</th>
                  <th className="px-3 py-2">Mão obra</th>
                  <th className="px-3 py-2">Overhead</th>
                  <th className="px-3 py-2">Custo</th>
                  <th className="px-3 py-2 text-left">Origem do valor</th>
                  <th className="px-3 py-2 no-print"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {linhasTecnicas.map((linha) => (
                  <tr key={linha.id}>
                    <td className="px-3 py-2 text-left font-medium">
                      <p>{linha.codigo}</p>
                      <p className="text-xs font-normal text-muted-foreground">{linha.nome ?? "—"}</p>
                    </td>
                    <td className="px-3 py-2 text-left text-muted-foreground">{demanda?.matriz_amostra ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{linha.lote ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{linha.quantidade}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground no-print">
                      {brl(linha.reagentes)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{brl(linha.equipamentos)}</td>
                    <td className="px-3 py-2 tabular-nums">{brl(linha.maoObra)}</td>
                    <td className="px-3 py-2 tabular-nums">{brl(linha.overhead)}</td>
                    <td className="px-3 py-2 font-semibold tabular-nums">
                      {brl(linha.custo)}
                    </td>
                    <td className="px-3 py-2 text-left text-xs text-muted-foreground">{linha.origem}</td>
                    <td className="px-3 py-2 no-print">
                      {!bloqueado && (
                        <FormEstado action={salvarItemOrcamento} mensagemClassName="text-xs">
                          <input type="hidden" name="orcamento_id" value={orcId} />
                          <input type="hidden" name="codigo_analise" value={linha.codigo} />
                          <input type="hidden" name="acao" value="remover" />
                          <SubmitButton
                            variant="link"
                            size="sm"
                            pendingLabel="Removendo…"
                            className="h-auto p-0 text-xs text-danger-strong"
                            aria-label={`Remover ${linha.codigo}`}
                          >
                            Remover
                          </SubmitButton>
                        </FormEstado>
                      )}
                    </td>
                  </tr>
                ))}
                {itens.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-muted-foreground/80">
                      Nenhuma análise. Adicione abaixo.
                    </td>
                  </tr>
                )}
              </tbody>
              {itens.length > 0 && (
                <tfoot className="border-t border-border bg-transparent">
                  <tr>
                    <td className="px-3 py-2.5 text-left font-medium">Total</td>
                    <td></td>
                    <td></td>
                    <td className="px-3 py-2.5 tabular-nums">{totalAmostras}</td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground no-print">{brl(Number(totaisOperacionais.reagentes ?? 0))}</td>
                    <td className="px-3 py-2.5 tabular-nums">{brl(Number(totaisOperacionais.equipamentos ?? 0))}</td>
                    <td className="px-3 py-2.5 tabular-nums">{brl(Number(totaisOperacionais.mao_obra ?? 0))}</td>
                    <td className="px-3 py-2.5 tabular-nums">{brl(Number(totaisOperacionais.overhead ?? 0))}</td>
                    <td className="px-3 py-2.5 text-base font-semibold tabular-nums text-brand-700 dark:text-brand-400">
                      {brl(totalCusto)}
                    </td>
                    <td></td>
                    <td className="no-print"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          </section>

          <section id="composicao-tecnica" className="no-print mt-3 scroll-mt-24">
            <details className="group rounded-md border border-border px-3 py-1.5 text-sm">
              {/* summary vira botão para leitores de tela: só texto aqui; a ajuda fica na linha do overhead. */}
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-1.5">
                <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                <span className="font-medium">Como cada bloco é calculado</span>
              </summary>
            <TabelaResumoTecnico
              colunas={["Bloco", "Como é calculado", "Subtotal"]}
              vazio="Sem composição técnica calculada."
              linhas={[
                ["Reagentes", `Consumo por amostra × amostras; itens por corrida são divididos pelo lote. Preço: ${orc.fonte_custo_insumos === "custo_medio_ponderado" ? "média dos lotes liberados" : "custo padrão do insumo"}.`, brl(Number(totaisOperacionais.reagentes ?? 0))],
                ["Materiais", "Material de consumo, somado junto aos reagentes.", brl(Number(totaisOperacionais.materiais ?? 0))],
                ["Equipamentos", "Custo diário do equipamento (depreciação e manutenção) dividido pela capacidade da análise.", brl(Number(totaisOperacionais.equipamentos ?? 0))],
                ["Mão de obra", "Horas de bancada por amostra × valor-hora da equipe.", brl(Number(totaisOperacionais.mao_obra ?? 0))],
                ["Terceiros", "Serviços de terceiros (nenhum lançado).", brl(Number(totaisOperacionais.terceiros ?? 0))],
                [
                  <span key="overhead" className="inline-flex items-center gap-1">
                    Overhead técnico
                    <HelpTip title="Overhead técnico">
                      <p>São os <b>custos indiretos</b> do laboratório (limpeza, energia, gestão), repartidos pelas <b>horas de bancada</b> de cada amostra.</p>
                      <HelpExample>0,5 h por amostra × R$ 40/h de overhead = R$ 20 por amostra.</HelpExample>
                    </HelpTip>
                  </span>,
                  "Horas de bancada por amostra × custo-hora de overhead.",
                  brl(Number(totaisOperacionais.overhead ?? 0)),
                ],
              ]}
            />
            </details>
          </section>

          {orc.observacoes && (
            <div className="mt-3 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Observações
              </p>
              <p className="mt-1 whitespace-pre-wrap text-foreground">
                {orc.observacoes}
              </p>
            </div>
          )}
        </div>

        {/* Catálogo visível de análises */}
        <section id="identificacao-tecnica" className="no-print mt-3 scroll-mt-24 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-center gap-1">
              <h2 className="text-sm font-semibold">Catálogo de análises laboratoriais</h2>
              <HelpTip title="Catálogo de análises">
                <p>Lista todas as análises ativas. Use <b>Incluir</b> para levar uma análise a este orçamento; só as incluídas entram no subtotal de custo.</p>
              </HelpTip>
            </div>
            <span className="text-xs text-muted-foreground/80">
              {bloqueado ? motivoBloqueio : `${analises?.length ?? 0} análise(s) ativa(s)`}
            </span>
          </div>
          <TabelaCatalogoAnalises
            bloqueado={bloqueado}
            analises={(analises ?? []).map((analise) => ({
              codigo: analise.codigo,
              nome: analise.nome ?? null,
              breakdown: breakdownPorCodigo.get(analise.codigo) ?? null,
            }))}
            itens={itens}
            orcId={orcId}
          />
        </section>

        {!demanda && (
        <section className="no-print mt-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Dados do cliente e do orçamento</h2>
          <FormEstado action={salvarCabecalho} className="mt-2 grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-4" mensagemClassName="sm:col-span-2 lg:col-span-4">
            <input type="hidden" name="orcamento_id" value={orcId} />
            <div className="lg:col-span-2">
              <label className={lbl}>Cliente cadastrado</label>
              <select aria-label="Cliente cadastrado" name="cliente_id" defaultValue={orc.cliente_id ?? ""} className={campo}>
                <option value="">— (preencher manualmente abaixo)</option>
                {(clientes ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
              <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                Ao vincular, os dados do documento são preenchidos a partir do cadastro.
              </p>
            </div>
            <div className="lg:col-span-2">
              <label className={lbl}>Projeto</label>
              <select aria-label="Projeto" name="projeto_id" defaultValue={orc.projeto_id ?? ""} className={campo}>
                <option value="">—</option>
                {(projetos ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={lbl}>Cliente (texto livre, se não cadastrado)</label>
              <input id="cabecalho-cliente" aria-label="Cliente (texto livre, se não cadastrado)" name="cliente_nome" defaultValue={orc.cliente_nome ?? ""} className={`${campo} scroll-mt-28`} />
            </div>
            <div>
              <label className={lbl}>CNPJ</label>
              <input aria-label="CNPJ" name="cliente_cnpj" defaultValue={orc.cliente_cnpj ?? ""} className={campo} />
            </div>
            <div>
              <label className={lbl}>Contato (e-mail / telefone)</label>
              <input aria-label="Contato (e-mail / telefone)" name="cliente_contato" defaultValue={orc.cliente_contato ?? ""} className={campo} />
            </div>
            <div className="sm:col-span-2">
              <label className={lbl}>Endereço</label>
              <input aria-label="Endereço" name="cliente_endereco" defaultValue={orc.cliente_endereco ?? ""} className={campo} />
            </div>
            <div>
              <label className={lbl}>Data do orçamento</label>
              <input aria-label="Data do orçamento" name="data_orcamento" type="date" defaultValue={orc.data_orcamento ?? ""} className={campo} />
            </div>
            <div>
              <label className={lbl}>Validade (dias)</label>
              <input aria-label="Validade (dias)" name="validade_dias" type="number" min="0" step="1" defaultValue={orc.validade_dias ?? 30} className={campo} />
            </div>
            <div>
              <label className={lbl}>Responsável (laboratório)</label>
              <input id="cabecalho-responsavel" aria-label="Responsável (laboratório)" name="responsavel" defaultValue={orc.responsavel ?? ""} className={`${campo} scroll-mt-28`} />
            </div>
            <div>
              <p className={lbl}>Situação</p>
              <p className="mt-1 text-sm font-medium">{rotuloStatusModulo(orc.status)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/80">Muda pelas ações da página (revisar, cancelar), não por aqui.</p>
            </div>
            <div className="sm:col-span-2">
              <label className={lbl}>Observações</label>
              <textarea aria-label="Observações" name="observacoes" rows={2} defaultValue={orc.observacoes ?? ""} className={`${inp} mt-0.5 w-full`} />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <SubmitButton size="sm">Salvar dados</SubmitButton>
            </div>
          </FormEstado>
        </section>
        )}

        <div className="no-print mt-3 grid items-start gap-3 lg:grid-cols-2">
        <section id="revisao-laboratorio" className="scroll-mt-24 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-sm font-semibold">Revisão técnica dos custos</h2>
            <HelpTip title="Revisão técnica">
              <p>Confira as pendências e marque os custos como revisados. Revisar congela análises e quantidades para a proposta.</p>
            </HelpTip>
            <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${revisaoPendencias.length === 0 ? "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300" : "bg-warning-soft text-warning-strong"}`}>
              {revisaoPendencias.length === 0 ? "Liberado" : `${revisaoPendencias.length} pendência(s)`}
            </span>
          </div>

          {revisaoPendencias.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-warning-strong">
              {revisaoPendencias.map((pendencia) => {
                const alvo = alvoPendencia[pendencia] ?? null;
                return (
                  <li key={pendencia}>
                    {alvo ? (
                      <a href={alvo} className="underline underline-offset-2 hover:text-warning-strong/80">
                        {pendencia}
                      </a>
                    ) : (
                      pendencia
                    )}
                    {pendencia === "informar responsável técnico" && alvo === "#revisao-responsavel" && (
                      <span className="text-muted-foreground"> — no campo “Responsável técnico” abaixo; é gravado ao marcar revisado</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 rounded-md bg-brand-50 px-3 py-1.5 text-xs leading-5 text-brand-900 dark:bg-brand-950/40 dark:text-brand-200">
              Tudo certo. Marque como revisado para liberar a proposta final.
            </p>
          )}
          {demanda && statusOperacional !== "revisado" && orc.status !== "cancelado" && !podeRevisar && (
            <p className="mt-3 text-xs text-muted-foreground">
              A revisão dos custos é feita por coordenador ou superior, ou por quem tem a permissão “Orçamentos: Emitir proposta”.
            </p>
          )}
          {demanda && statusOperacional !== "revisado" && orc.status !== "cancelado" && podeRevisar && (
            <FormEstado action={revisarOrcamentoLaboratorio} className="mt-3 grid gap-2 rounded-md border border-border bg-muted/50 p-2.5 text-sm sm:grid-cols-[1fr_auto]" mensagemClassName="sm:col-span-2">
              <input type="hidden" name="orcamento_id" value={orcId} />
              <div>
                <label htmlFor="revisao-responsavel" className={lbl}>Responsável técnico</label>
                <input
                  id="revisao-responsavel"
                  name="responsavel"
                  defaultValue={orc.responsavel ?? demanda.responsavel_interno ?? ""}
                  className={`${campo} scroll-mt-28`}
                  required
                />
              </div>
              <div className="flex items-end gap-1">
                <ConfirmSubmitButton
                  className="h-8 rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-500"
                  titulo="Marcar custos como revisados?"
                  mensagem="Os custos laboratoriais ficam congelados para a proposta final. Depois disso, a edição direta fica bloqueada."
                  confirmLabel="Marcar revisado"
                >
                  Marcar revisado
                </ConfirmSubmitButton>
              </div>
            </FormEstado>
          )}
        </section>

        <section id="historico-laboratorio" className="scroll-mt-24 rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">Linha do tempo</h2>
          <Timeline eventos={eventos} />
        </section>
        </div>

        <div className="no-print mt-3 flex flex-wrap gap-3">
          {!podeCancelar ? null : ["enviado", "aprovado"].includes(orc.status) || cancelamentoIncompleto ? (
            <CancelarComMotivo
              action={cancelarOrcamento}
              fields={{ orcamento_id: orcId }}
              trigger={cancelamentoIncompleto ? "Concluir cancelamento" : "Cancelar orçamento"}
              titulo="Cancelar orçamento"
              mensagem={`Cancelar o orçamento de “${orc.cliente_nome}”? O histórico será preservado.`}
              confirmLabel="Cancelar orçamento"
              triggerClassName="text-xs text-warning-strong hover:underline"
            />
          ) : (
            <ConfirmActionButton
              action={excluirOrcamento}
              fields={{ orcamento_id: orcId }}
              trigger="Excluir orçamento"
              titulo="Excluir orçamento"
              mensagem={`Excluir o orçamento de “${orc.cliente_nome}”? Esta ação não pode ser desfeita.`}
              confirmLabel="Excluir orçamento"
            />
          )}
        </div>
      </main>
    </div>
  );
}

/** Par rótulo: valor do cabeçalho (dl denso em colunas). */
function Campo({ rotulo, children, className = "" }: { rotulo: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 gap-1.5 ${className}`}>
      <dt className="shrink-0 text-muted-foreground">{rotulo}:</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/**
 * Item da faixa de totais: rótulo e valor na mesma linha; zero fica apagado.
 * `bloco` = célula da grade de blocos de custo; `destaque` = subtotal de custo.
 */
function ResumoOperacional({
  titulo,
  valor,
  destaque = false,
  discreto = false,
  numero = false,
  bloco = false,
}: {
  titulo: string;
  valor: number;
  destaque?: boolean;
  discreto?: boolean;
  numero?: boolean;
  bloco?: boolean;
}) {
  const zerado = Math.abs(valor) < 0.005;
  // No celular o bloco empilha rótulo e valor (duas colunas estreitas não cabem lado a lado).
  const caixa = bloco
    ? "max-sm:flex-col max-sm:items-start max-sm:gap-0 justify-between rounded-md bg-card px-2 py-1 ring-1 ring-border/70"
    : destaque
      ? "rounded-md bg-brand-50 px-2 py-0.5 ring-1 ring-brand-200 dark:bg-brand-950/30 dark:ring-brand-900"
      : "";
  const tomValor = destaque
    ? "font-semibold text-brand-800 dark:text-brand-200"
    : zerado
      ? "text-muted-foreground"
      : discreto
        ? "font-medium text-muted-foreground"
        : "font-semibold";
  return (
    <div className={`flex min-w-0 items-baseline gap-2 ${caixa}`}>
      <dt className={`min-w-0 text-xs leading-tight ${destaque ? "font-medium text-brand-800 dark:text-brand-200" : "text-muted-foreground"}`}>{titulo}</dt>
      <dd className={`shrink-0 tabular-nums ${tomValor}`}>{numero ? valor.toLocaleString("pt-BR") : brl(valor)}</dd>
    </div>
  );
}

function TabelaCatalogoAnalises({
  analises,
  itens,
  orcId,
  bloqueado = false,
}: {
  bloqueado?: boolean;
  analises: Array<{
    codigo: string;
    nome: string | null;
    breakdown: {
      lote?: number | null;
      reagentes?: number;
      equipamento?: number;
      pessoal?: number;
      overhead?: number;
      custoTotal?: number;
      preco?: number;
    } | null;
  }>;
  itens: Item[];
  orcId: number;
}) {
  const itensPorCodigo = new Map(itens.map((item) => [item.codigo_analise, item]));
  const inputClass =
    "w-24 rounded-md border border-input bg-card px-2 py-1.5 text-right text-sm font-medium text-brand-700 dark:text-brand-300";

  return (
    <div className="mt-3 rounded-lg border border-border md:overflow-x-auto">
      {/* No celular cada análise vira um cartão (mesma tabela, só CSS): código e nome em cima. */}
      <table className="w-full text-sm md:min-w-[980px] md:text-right">
        <thead className="hidden bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground md:table-header-group min-[1400px]:whitespace-nowrap">
          <tr>
            <th className="px-2 py-2 text-left">Incluir</th>
            <th className="px-2 py-2 text-left">Código</th>
            <th className="px-2 py-2 text-left">Nome</th>
            <th className="px-2 py-2">Lote</th>
            <th className="px-2 py-2">Custo unit.</th>
            <th className="px-2 py-2" title="R reagentes · E equipamentos · P pessoal · O overhead">
              Composição (R · E · P · O)
            </th>
            <th className="px-2 py-2">Amostras</th>
            <th className="px-2 py-2">Subtotal</th>
            <th className="px-2 py-2"></th>
          </tr>
        </thead>
        <tbody className="block divide-y divide-border/70 md:table-row-group">
          {analises.map((analise) => {
            const item = itensPorCodigo.get(analise.codigo);
            const selecionada = Boolean(item);
            const custoUnitario = Number(item?.custo_unitario ?? analise.breakdown?.custoTotal ?? 0);
            const amostras = Number(item?.n_amostras ?? 1);
            const subtotal = selecionada ? custoUnitario * amostras : 0;
            return (
              <tr
                key={analise.codigo}
                className={`grid grid-cols-2 gap-x-3 gap-y-2 p-3 md:table-row md:p-0 ${selecionada ? "bg-brand-50/40 dark:bg-brand-950/10" : ""}`}
              >
                <td data-label="Incluir" className="order-6 self-end md:order-none md:table-cell md:px-2 md:py-1.5 md:text-left">
                  {bloqueado ? (
                    <span className="text-xs text-muted-foreground">{selecionada ? "Incluída" : "—"}</span>
                  ) : (
                  <FormEstado action={salvarItemOrcamento} mensagemClassName="mt-1 max-w-48 text-xs">
                    <input type="hidden" name="orcamento_id" value={orcId} />
                    <input type="hidden" name="codigo_analise" value={analise.codigo} />
                    <input type="hidden" name="n_amostras" value={amostras} />
                    <input type="hidden" name="acao" value={selecionada ? "remover" : "incluir"} />
                    <SubmitButton
                      variant="outline"
                      size="sm"
                      pendingLabel={selecionada ? "Removendo…" : "Incluindo…"}
                      className={`h-auto px-2.5 py-1 text-xs max-md:min-h-11 max-md:w-full ${
                        selecionada
                          ? "border-danger-strong/30 text-danger-strong hover:bg-danger-soft"
                          : "border-brand-200 text-brand-700 hover:bg-brand-50 dark:border-brand-900 dark:text-brand-300"
                      }`}
                    >
                      {selecionada ? "Remover" : "Incluir"}
                    </SubmitButton>
                  </FormEstado>
                  )}
                </td>
                <td className="order-1 col-span-2 font-semibold md:order-none md:table-cell md:px-2 md:py-1.5 md:text-left">{analise.codigo}</td>
                <td className="order-2 col-span-2 -mt-2 text-foreground md:order-none md:mt-0 md:table-cell md:max-w-xs md:px-2 md:py-1.5 md:text-left">{analise.nome ?? "—"}</td>
                <td data-label="Lote" className="order-7 tabular-nums md:order-none md:table-cell md:px-2 md:py-1.5 max-md:before:block max-md:before:text-[11px] max-md:before:font-medium max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]">{analise.breakdown?.lote ?? "—"}</td>
                <td data-label="Custo unit." className="order-3 tabular-nums md:order-none md:table-cell md:px-2 md:py-1.5 max-md:before:block max-md:before:text-[11px] max-md:before:font-medium max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]">{brl(custoUnitario)}</td>
                <td data-label="Composição (R · E · P · O)" className="order-9 col-span-2 text-xs text-muted-foreground md:order-none md:table-cell md:px-2 md:py-1.5 min-[1400px]:whitespace-nowrap max-md:before:block max-md:before:text-[11px] max-md:before:font-medium max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]">
                  R {brl(Number(analise.breakdown?.reagentes ?? 0))} · E {brl(Number(analise.breakdown?.equipamento ?? 0))} · P {brl(Number(analise.breakdown?.pessoal ?? 0))} · O {brl(Number(analise.breakdown?.overhead ?? 0))}
                </td>
                <td data-label="Amostras" className="order-5 md:order-none md:table-cell md:px-2 md:py-1.5 max-md:before:block max-md:before:text-[11px] max-md:before:font-medium max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]">
                  {selecionada && bloqueado ? (
                    <span className="tabular-nums">{amostras}</span>
                  ) : selecionada ? (
                    <FormEstado action={salvarItemOrcamento} className="flex flex-wrap gap-2 md:justify-end" mensagemClassName="w-full text-xs md:text-right">
                      <input type="hidden" name="orcamento_id" value={orcId} />
                      <input type="hidden" name="codigo_analise" value={analise.codigo} />
                      <input type="hidden" name="acao" value="quantidade" />
                      <input
                        aria-label={`Amostras de ${analise.codigo}`}
                        name="n_amostras"
                        type="number"
                        min="1"
                        step="1"
                        defaultValue={amostras}
                        className={inputClass}
                      />
                      <SubmitButton variant="outline" size="sm" pendingLabel="Salvando…" className="h-auto px-2 py-1 text-xs max-md:min-h-11">
                        Salvar
                      </SubmitButton>
                    </FormEstado>
                  ) : (
                    <span className="text-muted-foreground/80">—</span>
                  )}
                </td>
                <td data-label="Subtotal" className="order-4 font-semibold tabular-nums md:order-none md:table-cell md:px-2 md:py-1.5 max-md:before:block max-md:before:text-[11px] max-md:before:font-medium max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]">{brl(subtotal)}</td>
                <td className="order-8 self-center text-xs text-muted-foreground md:order-none md:table-cell md:px-2 md:py-1.5 md:text-left min-[1400px]:whitespace-nowrap">
                  {selecionada ? "No orçamento" : "Fora do subtotal"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TabelaResumoTecnico({
  colunas,
  linhas,
  vazio,
}: {
  colunas: string[];
  linhas: ReactNode[][];
  vazio: string;
}) {
  return (
    <div className="mb-1.5 mt-2 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-muted-foreground">
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
              <tr key={index}>
                {linha.map((celula, celulaIndex) => (
                  <td key={celulaIndex} className="max-w-lg px-3 py-2 text-foreground">
                    {celula}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={colunas.length} className="px-3 py-6 text-center text-muted-foreground/80">
                {vazio}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
