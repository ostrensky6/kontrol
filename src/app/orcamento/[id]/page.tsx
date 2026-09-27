import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
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
  const tabs = [
    { href: "#identificacao-tecnica", label: "Identificação", meta: orc.responsavel ? "preenchida" : "pendente" },
    { href: "#analises-quantidades", label: "Análises", meta: `${itens.length} linha(s)` },
    { href: "#composicao-tecnica", label: "Composição", meta: `${totalAmostras} amostra(s)` },
    { href: "#totais-tecnicos", label: "Totais", meta: brl(Number(totaisOperacionais.custo ?? totalCusto)) },
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
    "rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-brand-700 dark:text-brand-300"; // §8.2: entrada em azul
  const lbl = "block text-xs font-medium text-muted-foreground";
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
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <Breadcrumbs items={[{ label: "Orçamentos", href: "/orcamento/demandas" }, { label: `Custos laboratoriais #${orc.id}` }]} />
          <div className="flex flex-wrap items-center gap-2">
            <PrintButton />
            {planoGerado && (
              <Link
                href={`/planejamento/${planoGerado.id}`}
                className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Planejamento #{planoGerado.id}
              </Link>
            )}
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

        {/* Documento imprimível */}
        <div className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-sm print:border-0 print:shadow-none">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                Custos laboratoriais
              </h1>
              <p className="text-sm text-muted-foreground">
                Laboratório ATGC — Biologia Molecular
              </p>
            </div>
            <div className="text-right text-sm">
              <p className="font-medium">Nº {orc.id}</p>
              <p className="text-muted-foreground">Data: {formatDate(orc.data_orcamento)}</p>
              {validade && (
                <p className="text-muted-foreground">Válido até: {validade}</p>
              )}
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Orçamento lab:</dt>
              <dd className="font-medium">#{orc.id} · {rotuloStatusModulo(orc.status)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Orçamento:</dt>
              <dd>
                {demanda ? (
                  <Link href={`/orcamento/demandas/${demanda.id}`} className="font-medium text-primary hover:underline">
                    {demanda.titulo}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Cliente:</dt>
              <dd className="font-medium">{orc.cliente_nome}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Matriz/amostra:</dt>
              <dd>{demanda?.matriz_amostra ?? "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">CNPJ:</dt>
              <dd>{orc.cliente_cnpj ?? "—"}</dd>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <dt className="text-muted-foreground">Endereço:</dt>
              <dd>{orc.cliente_endereco ?? "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Contato:</dt>
              <dd>{orc.cliente_contato ?? "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Responsável:</dt>
              <dd>{orc.responsavel ?? "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Custo calculado em:</dt>
              <dd>{formatDateTime(snapshotGeradoEm)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Fonte dos insumos:</dt>
              <dd>{orc.fonte_custo_insumos === "custo_medio_ponderado" ? "Média ponderada dos lotes liberados" : "Custo padrão aprovado"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Projeto:</dt>
              <dd>{projetoNome ?? "—"}</dd>
            </div>
          </dl>

          <nav className="no-print sticky top-[57px] z-10 mt-6 overflow-x-auto md:top-0 border-y border-border bg-card/95 py-2 shadow-sm backdrop-blur">
            <div className="flex min-w-max gap-2">
              {tabs.map((tab) => (
                <a
                  key={tab.href}
                  href={tab.href}
                  className="app-nav-level-3 rounded-md border border-primary/20 px-3 py-2 text-left text-xs text-brand-800 shadow-xs transition hover:border-primary/40 hover:text-brand-900 dark:text-brand-300"
                >
                  <span className="block font-semibold">{tab.label}</span>
                  <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground">{tab.meta}</span>
                </a>
              ))}
            </div>
          </nav>

          <section id="totais-tecnicos" className="no-print mt-6 scroll-mt-24 rounded-lg border border-border bg-muted/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1">
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
              </div>
              <span className="rounded-full bg-card px-2.5 py-1 text-xs font-medium text-foreground ring-1 ring-border">
                {rotuloStatusModulo(statusOperacional)}
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <ResumoOperacional titulo="Reagentes" valor={Number(totaisOperacionais.reagentes ?? 0)} />
              <ResumoOperacional titulo="Materiais" valor={Number(totaisOperacionais.materiais ?? 0)} />
              <ResumoOperacional titulo="Equipamentos" valor={Number(totaisOperacionais.equipamentos ?? 0)} />
              <ResumoOperacional titulo="Mão de obra" valor={Number(totaisOperacionais.mao_obra ?? 0)} />
              <ResumoOperacional titulo="Terceiros" valor={Number(totaisOperacionais.terceiros ?? 0)} />
              <ResumoOperacional titulo="Overhead" valor={Number(totaisOperacionais.overhead ?? 0)} />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <ResumoOperacional titulo="Subtotal custo" valor={Number(totaisOperacionais.custo ?? totalCusto)} destaque />
              <ResumoOperacional titulo="Amostras" valor={Number(totaisOperacionais.amostras ?? totalAmostras)} numero />
              <ResumoOperacional titulo="Preço preservado" valor={Number(totaisOperacionais.preco ?? totalPreco)} discreto />
            </div>
          </section>

          {/* Análises solicitadas */}
          <section id="analises-quantidades" className="mt-6 scroll-mt-24">
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
                          <button className="text-xs text-danger-strong hover:underline" aria-label={`Remover ${linha.codigo}`}>
                            Remover
                          </button>
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

          <section id="composicao-tecnica" className="no-print mt-6 scroll-mt-24">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex items-center gap-1">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Composição técnica por bloco</h2>
                <HelpTip title="Overhead técnico">
                  <p>São os <b>custos indiretos</b> do laboratório (limpeza, energia, gestão), repartidos pelas <b>horas de bancada</b> de cada amostra.</p>
                  <HelpExample>0,5 h por amostra × R$ 40/h de overhead = R$ 20 por amostra.</HelpExample>
                </HelpTip>
              </div>
            </div>
            <TabelaResumoTecnico
              colunas={["Bloco", "Como é calculado", "Subtotal"]}
              vazio="Sem composição técnica calculada."
              linhas={[
                ["Reagentes", `Consumo por amostra × amostras; itens por corrida são divididos pelo lote. Preço: ${orc.fonte_custo_insumos === "custo_medio_ponderado" ? "média dos lotes liberados" : "custo padrão do insumo"}.`, brl(Number(totaisOperacionais.reagentes ?? 0))],
                ["Materiais", "Material de consumo, somado junto aos reagentes.", brl(Number(totaisOperacionais.materiais ?? 0))],
                ["Equipamentos", "Custo diário do equipamento (depreciação e manutenção) dividido pela capacidade da análise.", brl(Number(totaisOperacionais.equipamentos ?? 0))],
                ["Mão de obra", "Horas de bancada por amostra × valor-hora da equipe.", brl(Number(totaisOperacionais.mao_obra ?? 0))],
                ["Terceiros", "Serviços de terceiros (nenhum lançado).", brl(Number(totaisOperacionais.terceiros ?? 0))],
                ["Overhead técnico", "Horas de bancada por amostra × custo-hora de overhead.", brl(Number(totaisOperacionais.overhead ?? 0))],
              ]}
            />
          </section>

          {orc.observacoes && (
            <div className="mt-4 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Observações
              </p>
              <p className="mt-1 whitespace-pre-wrap text-foreground">
                {orc.observacoes}
              </p>
            </div>
          )}
        </div>

        {desatualizado && (
          <p className="no-print mt-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-strong">
            Os parâmetros de custo mudaram desde a emissão. Use “Recalcular
            preços” para atualizar os valores deste orçamento.
          </p>
        )}

        {erroExclusao && (
          <p className="no-print mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">
            {erroExclusao}
          </p>
        )}
        {aviso && (
          <p role="status" className="no-print mt-4 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            {aviso}
          </p>
        )}

        {/* Catálogo visível de análises */}
        <section id="identificacao-tecnica" className="no-print mt-6 scroll-mt-24 rounded-xl border border-border bg-card p-4 shadow-sm">
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

        {demanda ? (
          <section className="no-print mt-6 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-1">
                <h2 className="text-sm font-semibold">Dados comerciais herdados</h2>
                <HelpTip title="Dados comerciais herdados">
                  <p>Cliente, documento e contato vêm dos <b>dados do orçamento</b>; altere-os por lá. A proposta emitida guarda uma cópia própria desses dados.</p>
                </HelpTip>
              </div>
              <Link
                href={`/orcamento/demandas/${demanda.id}#demanda`}
                className="app-nav-level-3 rounded-md border border-primary/20 px-3 py-2 text-xs font-medium text-brand-800 shadow-xs transition hover:border-primary/40 hover:text-brand-900 dark:text-brand-300"
              >
                Editar dados do orçamento
              </Link>
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Cliente</dt><dd className="font-medium">{orc.cliente_nome ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Documento</dt><dd>{orc.cliente_cnpj ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Contato</dt><dd>{orc.cliente_contato ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Origem</dt><dd>Orçamento nº {demanda.id}</dd></div>
            </dl>
          </section>
        ) : (
        <section className="no-print mt-6 rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Dados do cliente e do orçamento</h2>
          <FormEstado action={salvarCabecalho} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2" mensagemClassName="sm:col-span-2">
            <input type="hidden" name="orcamento_id" value={orcId} />
            <div>
              <label className={lbl}>Cliente cadastrado</label>
              <select aria-label="Cliente cadastrado" name="cliente_id" defaultValue={orc.cliente_id ?? ""} className={`${inp} mt-1 w-full`}>
                <option value="">— (preencher manualmente abaixo)</option>
                {(clientes ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground/80">
                Ao vincular, os dados do documento são preenchidos a partir do cadastro.
              </p>
            </div>
            <div>
              <label className={lbl}>Projeto</label>
              <select aria-label="Projeto" name="projeto_id" defaultValue={orc.projeto_id ?? ""} className={`${inp} mt-1 w-full`}>
                <option value="">—</option>
                {(projetos ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={lbl}>Cliente (texto livre, se não cadastrado)</label>
              <input id="cabecalho-cliente" aria-label="Cliente (texto livre, se não cadastrado)" name="cliente_nome" defaultValue={orc.cliente_nome ?? ""} className={`${inp} mt-1 w-full scroll-mt-28`} />
            </div>
            <div>
              <label className={lbl}>CNPJ</label>
              <input aria-label="CNPJ" name="cliente_cnpj" defaultValue={orc.cliente_cnpj ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
            <div>
              <label className={lbl}>Contato (e-mail / telefone)</label>
              <input aria-label="Contato (e-mail / telefone)" name="cliente_contato" defaultValue={orc.cliente_contato ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
            <div className="sm:col-span-2">
              <label className={lbl}>Endereço</label>
              <input aria-label="Endereço" name="cliente_endereco" defaultValue={orc.cliente_endereco ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
            <div>
              <label className={lbl}>Data do orçamento</label>
              <input aria-label="Data do orçamento" name="data_orcamento" type="date" defaultValue={orc.data_orcamento ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
            <div>
              <label className={lbl}>Validade (dias)</label>
              <input aria-label="Validade (dias)" name="validade_dias" type="number" min="0" step="1" defaultValue={orc.validade_dias ?? 30} className={`${inp} mt-1 w-full`} />
            </div>
            <div>
              <label className={lbl}>Responsável (laboratório)</label>
              <input id="cabecalho-responsavel" aria-label="Responsável (laboratório)" name="responsavel" defaultValue={orc.responsavel ?? ""} className={`${inp} mt-1 w-full scroll-mt-28`} />
            </div>
            <div>
              <p className={lbl}>Situação</p>
              <p className="mt-1 text-sm font-medium">{rotuloStatusModulo(orc.status)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground/80">Muda pelas ações da página (revisar, cancelar), não por aqui.</p>
            </div>
            <div className="sm:col-span-2">
              <label className={lbl}>Observações</label>
              <textarea aria-label="Observações" name="observacoes" rows={3} defaultValue={orc.observacoes ?? ""} className={`${inp} mt-1 w-full`} />
            </div>
            <div className="sm:col-span-2">
              <SubmitButton>Salvar dados</SubmitButton>
            </div>
          </FormEstado>
        </section>
        )}

        <section id="revisao-laboratorio" className="no-print mt-6 scroll-mt-24 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Revisão técnica dos custos</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Confira as pendências e marque os custos como revisados. Revisar congela análises e quantidades para a proposta.
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${revisaoPendencias.length === 0 ? "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300" : "bg-warning-soft text-warning-strong"}`}>
              {revisaoPendencias.length === 0 ? "Liberado" : `${revisaoPendencias.length} pendência(s)`}
            </span>
          </div>
          {revisaoPendencias.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-4 text-xs leading-5 text-warning-strong">
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
            <p className="mt-3 rounded-md bg-brand-50 px-3 py-2 text-xs leading-5 text-brand-900 dark:bg-brand-950/40 dark:text-brand-200">
              Tudo certo. Marque como revisado para liberar a proposta final.
            </p>
          )}
          {demanda && statusOperacional !== "revisado" && orc.status !== "cancelado" && !podeRevisar && (
            <p className="mt-4 text-xs text-muted-foreground">
              A revisão dos custos é feita por coordenador ou superior, ou por quem tem a permissão “Orçamentos: Emitir proposta”.
            </p>
          )}
          {demanda && statusOperacional !== "revisado" && orc.status !== "cancelado" && podeRevisar && (
            <FormEstado action={revisarOrcamentoLaboratorio} className="mt-4 grid gap-3 rounded-md border border-border bg-muted/50 p-3 text-sm sm:grid-cols-[1fr_auto]" mensagemClassName="sm:col-span-2">
              <input type="hidden" name="orcamento_id" value={orcId} />
              <div>
                <label htmlFor="revisao-responsavel" className={lbl}>Responsável técnico</label>
                <input
                  id="revisao-responsavel"
                  name="responsavel"
                  defaultValue={orc.responsavel ?? demanda.responsavel_interno ?? ""}
                  className={`${inp} mt-1 w-full scroll-mt-28`}
                  required
                />
              </div>
              <div className="flex items-end gap-1">
                <ConfirmSubmitButton
                  className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
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

        <section id="historico-laboratorio" className="no-print mt-6 scroll-mt-24 rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Linha do tempo</h2>
          <p className="mt-1 mb-3 text-xs text-muted-foreground">
            Mudanças de status aparecem aqui.
          </p>
          <Timeline eventos={eventos} />
        </section>

        <div className="no-print mt-6 flex flex-wrap gap-3">
          {!podeCancelar ? null : ["enviado", "aprovado"].includes(orc.status) ? (
            <CancelarComMotivo
              action={cancelarOrcamento}
              fields={{ orcamento_id: orcId }}
              trigger="Cancelar orçamento"
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

function ResumoOperacional({
  titulo,
  valor,
  destaque = false,
  discreto = false,
  numero = false,
}: {
  titulo: string;
  valor: number;
  destaque?: boolean;
  discreto?: boolean;
  numero?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${destaque ? "border-brand-200 bg-brand-50 dark:border-brand-900 dark:bg-brand-950/30" : "border-border bg-card"} ${discreto ? "opacity-80" : ""}`}>
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums">
        {numero ? valor.toLocaleString("pt-BR") : brl(valor)}
      </p>
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
    <div className="mt-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[980px] text-right text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Incluir</th>
            <th className="px-3 py-2 text-left">Código</th>
            <th className="px-3 py-2 text-left">Nome</th>
            <th className="px-3 py-2">Lote</th>
            <th className="px-3 py-2">Custo unit.</th>
            <th className="px-3 py-2" title="R reagentes · E equipamentos · P pessoal · O overhead">
              Composição (R · E · P · O)
            </th>
            <th className="px-3 py-2">Amostras</th>
            <th className="px-3 py-2">Subtotal</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {analises.map((analise) => {
            const item = itensPorCodigo.get(analise.codigo);
            const selecionada = Boolean(item);
            const custoUnitario = Number(item?.custo_unitario ?? analise.breakdown?.custoTotal ?? 0);
            const amostras = Number(item?.n_amostras ?? 1);
            const subtotal = selecionada ? custoUnitario * amostras : 0;
            return (
              <tr key={analise.codigo} className={selecionada ? "bg-brand-50/40 dark:bg-brand-950/10" : ""}>
                <td className="px-3 py-2 text-left">
                  {bloqueado ? (
                    <span className="text-xs text-muted-foreground">{selecionada ? "Incluída" : "—"}</span>
                  ) : (
                  <FormEstado action={salvarItemOrcamento} mensagemClassName="mt-1 max-w-48 text-xs">
                    <input type="hidden" name="orcamento_id" value={orcId} />
                    <input type="hidden" name="codigo_analise" value={analise.codigo} />
                    <input type="hidden" name="n_amostras" value={amostras} />
                    <input type="hidden" name="acao" value={selecionada ? "remover" : "incluir"} />
                    <button
                      className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                        selecionada
                          ? "border-danger-strong/30 text-danger-strong hover:bg-danger-soft"
                          : "border-brand-200 text-brand-700 hover:bg-brand-50 dark:border-brand-900 dark:text-brand-300"
                      }`}
                    >
                      {selecionada ? "Remover" : "Incluir"}
                    </button>
                  </FormEstado>
                  )}
                </td>
                <td className="px-3 py-2 text-left font-semibold">{analise.codigo}</td>
                <td className="max-w-xs px-3 py-2 text-left text-foreground">{analise.nome ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{analise.breakdown?.lote ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{brl(custoUnitario)}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  R {brl(Number(analise.breakdown?.reagentes ?? 0))} · E {brl(Number(analise.breakdown?.equipamento ?? 0))} · P {brl(Number(analise.breakdown?.pessoal ?? 0))} · O {brl(Number(analise.breakdown?.overhead ?? 0))}
                </td>
                <td className="px-3 py-2">
                  {selecionada && bloqueado ? (
                    <span className="tabular-nums">{amostras}</span>
                  ) : selecionada ? (
                    <FormEstado action={salvarItemOrcamento} className="flex flex-wrap justify-end gap-2" mensagemClassName="w-full text-right text-xs">
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
                      <button className="rounded-md border border-input px-2 py-1 text-xs hover:bg-muted">
                        Salvar
                      </button>
                    </FormEstado>
                  ) : (
                    <span className="text-muted-foreground/80">—</span>
                  )}
                </td>
                <td className="px-3 py-2 font-semibold tabular-nums">{brl(subtotal)}</td>
                <td className="px-3 py-2 text-left text-xs text-muted-foreground">
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
    <div className="mt-3 overflow-x-auto rounded-lg border border-border">
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
