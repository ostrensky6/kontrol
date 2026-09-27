import { randomUUID } from "node:crypto";
import Link from "next/link";

import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { DownloadButton } from "@/components/common/DownloadButton";
import { HelpLegend, HelpTip } from "@/components/common/HelpTip";
import { CancelarComMotivo } from "@/components/orcamento/CancelarComMotivo";
import { ClassificarVersao } from "@/components/orcamento/ClassificarVersao";
import {
  atualizarOrcamentosFinaisVencidos,
  cancelarVersaoFinal,
  classificarVersaoFinal,
  duplicarVersaoFinal,
} from "@/lib/actions/orcamento-historico";
import { formatCurrency as brl, formatDate, formatDateTime } from "@/lib/formatters";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { rotuloModalidade } from "@/lib/orcamento/orcamento-economico";
import { hojeCalendario, rotuloStatusVersaoFinal, statusEfetivoVersaoFinal } from "@/lib/orcamento/rotulos-status";
import { podeOrcamento } from "@/lib/orcamento/governanca";
import { STATUS_APROVADOS, classificacoesPermitidas } from "@/lib/orcamento/transicoes-versao";

export const dynamic = "force-dynamic";

type SearchParams = {
  texto?: string;
  status?: string;
  cliente?: string;
  responsavel?: string;
  modalidade?: string;
  emitido_de?: string;
  emitido_ate?: string;
  validade_de?: string;
  validade_ate?: string;
  valor_min?: string;
  valor_max?: string;
  comparar?: string;
};

type DemandaHistorico = {
  id: number;
  titulo: string | null;
  cliente_nome: string | null;
  responsavel_interno: string | null;
  modalidade: string | null;
};

type SnapshotParametro = {
  key?: string;
  label?: string;
  nominalRate?: number;
  amount?: number;
};

type SnapshotFinal = {
  demanda?: {
    titulo?: string | null;
    cliente_nome?: string | null;
    responsavel_interno?: string | null;
    modalidade?: string | null;
  };
  consolidado?: {
    totalLaboratorioCusto?: number;
    totalLaboratorioPreco?: number;
    totalProjetoCusto?: number;
    totalProjetoFinal?: number;
    totalFinal?: number;
    markupProjeto?: number;
    parametrosProjeto?: SnapshotParametro[];
    economia?: { parametros?: Array<{ chave?: string; label?: string; valorNominal?: number }> };
    origens?: Array<{ campo?: string; titulo?: string; regra?: string; valor?: number }>;
  };
  orcamentos_analises?: Array<{ id?: number; orcamento_itens?: unknown[] }>;
  orcamentos_projeto?: Array<{ id?: number; orcamento_projeto_custos?: unknown[]; orcamento_projeto_analises?: unknown[] }>;
};

type VersaoFinal = {
  id: number;
  demanda_id: number;
  versao: number;
  numero: string;
  status: string;
  validade_dias: number;
  valido_ate: string | null;
  total_final: number;
  total_laboratorio_custo: number;
  total_laboratorio_preco: number;
  total_projeto_custo: number;
  total_projeto_final: number;
  criado_por: string | null;
  criado_em: string;
  duplicada_de_id: number | null;
  cancelado_em: string | null;
  cancelado_motivo: string | null;
  classificado_em: string | null;
  classificacao_motivo: string | null;
  snapshot: Json;
  demandas_propostas?: DemandaHistorico | null;
};

type VersaoComAnterior = VersaoFinal & { anterior: VersaoFinal | null };

const statusOptions = [
  ["", "Todos"],
  ["emitido", "Emitido"],
  ["enviado", "Enviado"],
  ["alterado_reenviado", "Alterado e reenviado"],
  ["aprovado", "Aprovado"],
  ["rejeitado", "Rejeitado"],
  ["recusado", "Recusado"],
  ["vencido", "Vencido"],
  ["substituido", "Substituído"],
  ["cancelado", "Cancelado"],
  ["convertido_projeto", "Convertido em projeto"],
] as const;

const atalhosStatus = [
  ["", "Todos"],
  ["emitido", "Emitidos"],
  ["enviado", "Enviados"],
  ["alterado_reenviado", "Alterados e reenviados"],
  ["aprovado", "Aprovados"],
  ["rejeitado", "Rejeitados"],
  ["cancelado", "Cancelados"],
  ["substituido", "Substituídos"],
  ["convertido_projeto", "Convertidos em projeto"],
] as const;


export default async function HistoricoOrcamentosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Gravar "vencido" exige papel de coordenador; sem ele (ou em falha) a página
  // segue e o status é derivado na leitura por statusEfetivoVersaoFinal.
  await atualizarOrcamentosFinaisVencidos().catch(() => undefined);

  const filtros = await searchParams;
  const supabase = await createClient();
  const db = supabase as unknown as {
    from: (table: "orcamento_final_versoes") => {
      select: (columns: string) => {
        order: (column: string, options?: { ascending?: boolean }) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
  };
  const { data, error } = await db
    .from("orcamento_final_versoes")
    .select(
      "id, demanda_id, versao, numero, status, validade_dias, valido_ate, total_final, total_laboratorio_custo, total_laboratorio_preco, total_projeto_custo, total_projeto_final, criado_por, criado_em, duplicada_de_id, cancelado_em, cancelado_motivo, classificado_em, classificacao_motivo, snapshot, demandas_propostas(id, titulo, cliente_nome, responsavel_interno, modalidade)",
    )
    .order("criado_em", { ascending: false });
  if (error) throw new Error(error.message);

  const hoje = hojeCalendario();
  const lidas = ((data ?? []) as unknown as VersaoFinal[]).map((versao) => ({
    ...versao,
    status: statusEfetivoVersaoFinal(versao, hoje),
  }));
  const todas = lidas.map((versao) => ({
    ...versao,
    anterior: encontrarAnterior(lidas, versao),
  }));
  const versoes = filtrarVersoes(todas, filtros);
  const comparada = todas.find((item) => item.id === Number(filtros.comparar));
  const exportHref = `/orcamento/historico/export?${new URLSearchParams(limparFiltros(filtros)).toString()}`;

  const emitidos = versoes.filter((item) => ["emitido", "enviado", "alterado_reenviado"].includes(item.status)).length;
  const aprovados = versoes.filter((item) => item.status === "aprovado").length;
  const cancelados = versoes.filter((item) => item.status === "cancelado").length;
  const totalHistorico = versoes.reduce((total, item) => total + Number(item.total_final ?? 0), 0);
  const operacoesDuplicacao = new Map(versoes.map((item) => [item.id, randomUUID()]));
  const [podeDuplicar, podeCancelar, podeClassificar] = await Promise.all([
    podeOrcamento("duplicar_final"),
    podeOrcamento("cancelar_documento"),
    podeOrcamento("classificar_final"),
  ]);
  // Uma versão viva por proposta: com versão aprovada, nenhuma outra é aprovada nem duplicada.
  const propostasAprovadas = new Set(
    lidas.filter((v) => (STATUS_APROVADOS as readonly string[]).includes(v.status)).map((v) => v.demanda_id),
  );

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <Breadcrumbs items={[{ label: "Orçamentos", href: "/orcamento" }, { label: "Histórico de Orçamentos" }]} />

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Histórico de Orçamentos</h1>
              <HelpTip title="Histórico de orçamentos">
                <p>
                  Versões de proposta já emitidas. Cada versão guarda os <b>custos, parâmetros e valores
                  do dia da emissão</b>; mudanças posteriores nos cadastros não a alteram.
                </p>
              </HelpTip>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <DownloadButton href={exportHref} fileName="historico-orcamentos.csv">
              Exportar CSV
            </DownloadButton>
            <Link href="/orcamento/demandas/nova" className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500">
              + Novo orçamento
            </Link>
          </div>
        </div>

        <section className="mt-6 grid gap-3 sm:grid-cols-4">
          <Resumo titulo="Emitidos/enviados" valor={emitidos} />
          <Resumo titulo="Aprovados" valor={aprovados} />
          <Resumo titulo="Cancelados" valor={cancelados} />
          <Resumo titulo="Total filtrado" valor={totalHistorico} moeda />
        </section>

        <nav className="mt-6 flex flex-wrap gap-2" aria-label="Status do histórico">
          {atalhosStatus.map(([value, label]) => (
            <Link
              key={value || "todos"}
              href={value ? `/orcamento/historico?status=${value}` : "/orcamento/historico"}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                (filtros.status ?? "") === value
                  ? "border-brand-600 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950/30 dark:text-brand-300"
                  : "border-input text-muted-foreground hover:bg-muted"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        <form className="mt-6 rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
            <CampoFiltro label="Texto livre">
              <input name="texto" defaultValue={filtros.texto ?? ""} className={inputCls} placeholder="Número, título ou cliente" />
            </CampoFiltro>
            <CampoFiltro label="Status">
              <select name="status" defaultValue={filtros.status ?? ""} className={inputCls}>
                {statusOptions.map(([value, label]) => (
                  <option key={value || "todos"} value={value}>{label}</option>
                ))}
              </select>
            </CampoFiltro>
            <CampoFiltro label="Cliente">
              <input name="cliente" defaultValue={filtros.cliente ?? ""} className={inputCls} />
            </CampoFiltro>
            <CampoFiltro label="Responsável">
              <input name="responsavel" defaultValue={filtros.responsavel ?? ""} className={inputCls} />
            </CampoFiltro>
            <CampoFiltro label="Modalidade">
              <input name="modalidade" defaultValue={filtros.modalidade ?? ""} className={inputCls} />
            </CampoFiltro>
            <CampoFiltro label="Emitido de">
              <input name="emitido_de" type="date" defaultValue={filtros.emitido_de ?? ""} className={inputCls} />
            </CampoFiltro>
            <CampoFiltro label="Emitido até">
              <input name="emitido_ate" type="date" defaultValue={filtros.emitido_ate ?? ""} className={inputCls} />
            </CampoFiltro>
            <CampoFiltro label="Validade de">
              <input name="validade_de" type="date" defaultValue={filtros.validade_de ?? ""} className={inputCls} />
            </CampoFiltro>
            <CampoFiltro label="Validade até">
              <input name="validade_ate" type="date" defaultValue={filtros.validade_ate ?? ""} className={inputCls} />
            </CampoFiltro>
            <CampoFiltro label="Valor mínimo">
              <input name="valor_min" type="number" step="0.01" defaultValue={filtros.valor_min ?? ""} className={inputCls} />
            </CampoFiltro>
            <CampoFiltro label="Valor máximo">
              <input name="valor_max" type="number" step="0.01" defaultValue={filtros.valor_max ?? ""} className={inputCls} />
            </CampoFiltro>
            <div className="flex items-end gap-2 md:col-span-2">
              <button className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500">
                Filtrar
              </button>
              <Link href="/orcamento/historico" className="rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-muted">
                Limpar
              </Link>
            </div>
          </div>
        </form>

        {comparada && (
          <ComparacaoLadoALado atual={comparada} anterior={comparada.anterior} />
        )}

        <section className="mt-6 overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full min-w-[1900px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-3">Número</th>
                <th className="px-3 py-3">Título</th>
                <th className="px-3 py-3">Cliente</th>
                <th className="px-3 py-3">Modalidade</th>
                <th className="px-3 py-3">Responsável</th>
                <th className="px-3 py-3">Emitida em</th>
                <th className="px-3 py-3">Conclusão</th>
                <th className="px-3 py-3">Validade</th>
                <th className="px-3 py-3">
                  <span className="flex items-center gap-1">
                    Status
                    <HelpTip title="Status da proposta">
                      <HelpLegend
                        items={[
                          { tom: "info", rotulo: "Emitida", texto: "documento gerado, ainda sem retorno do cliente." },
                          { tom: "ok", rotulo: "Aprovada", texto: "o cliente aceitou a proposta." },
                          { tom: "atencao", rotulo: "Vencida", texto: "passou da validade sem resposta." },
                          { tom: "critico", rotulo: "Recusada", texto: "recusada pelo cliente ou cancelada; o registro fica no histórico." },
                          { tom: "neutro", rotulo: "Substituída", texto: "uma versão mais nova tomou o lugar." },
                        ]}
                      />
                      <p>Use <b>Classificar</b> para registrar o retorno do cliente.</p>
                    </HelpTip>
                  </span>
                </th>
                <th className="px-3 py-3 text-right">Custo análises</th>
                <th className="px-3 py-3 text-right">Custo projeto</th>
                <th className="px-3 py-3 text-right">Subtotal custos</th>
                <th className="px-3 py-3 text-right">Taxas/impostos</th>
                <th className="px-3 py-3 text-right">
                  <span className="inline-flex items-center gap-1">
                    Margem/lucro
                    <HelpTip title="Valores dos parâmetros">
                      <p>As colunas <b>Taxas/impostos</b>, <b>Margem/lucro</b> e <b>Fundos/equip.</b> somam, em R$, os parâmetros de cada proposta: impostos e incubação; lucro; reserva e investimentos.</p>
                    </HelpTip>
                  </span>
                </th>
                <th className="px-3 py-3 text-right">Fundos/equip.</th>
                <th className="px-3 py-3 text-right">Preço final</th>
                <th className="px-3 py-3 text-right">
                  Variação vs. versão anterior
                </th>
                <th className="px-3 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {versoes.map((item) => {
                const snapshot = normalizarSnapshot(item.snapshot);
                const composicao = composicaoEconomica(item, snapshot);
                return (
                  <tr key={item.id}>
                    <td className="px-3 py-3">
                      <Link href={`/orcamento/final/${item.id}`} className="font-medium text-primary hover:underline">
                        {item.numero}
                      </Link>
                      <p className="text-xs text-muted-foreground">v{item.versao}{item.duplicada_de_id ? ` · duplicada de #${item.duplicada_de_id}` : ""}</p>
                    </td>
                    <td className="px-3 py-3">
                      <Link href={`/orcamento/demandas/${item.demanda_id}`} className="font-medium hover:underline">
                        {snapshot.demanda?.titulo ?? item.demandas_propostas?.titulo ?? `Orçamento ${item.demanda_id}`}
                      </Link>
                    </td>
                    <td className="px-3 py-3">{snapshot.demanda?.cliente_nome ?? item.demandas_propostas?.cliente_nome ?? "Cliente não informado"}</td>
                    <td className="px-3 py-3"><Badge>{rotuloModalidade(snapshot.demanda?.modalidade ?? item.demandas_propostas?.modalidade)}</Badge></td>
                    <td className="px-3 py-3">
                      <p>{snapshot.demanda?.responsavel_interno ?? item.demandas_propostas?.responsavel_interno ?? item.criado_por ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{item.criado_por ? `usuário ${item.criado_por}` : "sem usuário registrado"}</p>
                    </td>
                    <td className="px-3 py-3">{formatDateTime(item.criado_em)}</td>
                    <td className="px-3 py-3">{formatDateTime(item.classificado_em ?? item.cancelado_em)}</td>
                    <td className="px-3 py-3">
                      <p>{formatDate(item.valido_ate)}</p>
                      <p className="text-xs text-muted-foreground">{item.validade_dias} dias</p>
                    </td>
                    <td className="px-3 py-3">
                      <Status status={item.status} />
                      {item.cancelado_motivo && <p className="mt-1 max-w-40 text-xs text-muted-foreground">{item.cancelado_motivo}</p>}
                      {item.classificacao_motivo && <p className="mt-1 max-w-48 text-xs text-muted-foreground">{item.classificacao_motivo}</p>}
                      {podeClassificar && (
                        <ClassificarVersao
                          versaoId={item.id}
                          numero={item.numero}
                          action={classificarVersaoFinal}
                          opcoes={classificacoesPermitidas({
                            status: item.status,
                            valido_ate: item.valido_ate,
                            hoje,
                            outraAprovada: propostasAprovadas.has(item.demanda_id) && !(STATUS_APROVADOS as readonly string[]).includes(item.status),
                          })}
                        />
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{brl(composicao.custoAnalises)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{brl(composicao.custoProjeto)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{brl(composicao.subtotalCustos)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{brl(composicao.taxasImpostos)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{brl(composicao.margemLucro)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{brl(composicao.fundosInvestimentos)}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{brl(Number(item.total_final ?? 0))}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {item.anterior ? (
                        <Comparacao atual={Number(item.total_final ?? 0)} anterior={Number(item.anterior.total_final ?? 0)} />
                      ) : (
                        <span className="text-muted-foreground/80">primeira versão</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/orcamento/final/${item.id}`} className="text-xs text-brand-700 hover:underline dark:text-brand-300">
                          Detalhes/PDF
                        </Link>
                        <Link href={`/orcamento/historico?${new URLSearchParams({ ...limparFiltros(filtros), comparar: String(item.id) }).toString()}`} className="text-xs text-brand-700 hover:underline dark:text-brand-300">
                          Comparar
                        </Link>
                        {podeDuplicar && !propostasAprovadas.has(item.demanda_id) && (
                        <form action={duplicarVersaoFinal}>
                          <input type="hidden" name="versao_id" value={item.id} />
                          <input type="hidden" name="validade_dias" value={item.validade_dias || 30} />
                          <input type="hidden" name="operacao_id" value={operacoesDuplicacao.get(item.id)} />
                          <button className="text-xs text-brand-700 hover:underline dark:text-brand-300">Duplicar</button>
                        </form>
                        )}
                        {podeCancelar && ["emitido", "enviado", "alterado_reenviado", "recusado", "rejeitado", "aprovado"].includes(item.status) && (
                          <CancelarComMotivo
                            action={cancelarVersaoFinal}
                            fields={{ versao_id: item.id }}
                            trigger="Cancelar"
                            titulo="Cancelar versão final"
                            mensagem={item.status === "aprovado"
                              ? `Cancelar a versão aprovada ${item.numero}? O planejamento dela em rascunho ou reservado também é cancelado, com as reservas liberadas.`
                              : `Cancelar a versão ${item.numero}? O registro continuará no histórico.`}
                            confirmLabel="Cancelar versão"
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {versoes.length === 0 && (
                <tr>
                  <td colSpan={18} className="px-3 py-6 text-left text-muted-foreground/80">
                    <p className="sticky left-3 inline-block">Nenhuma versão final encontrada para os filtros atuais.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}

const inputCls =
  "mt-1 w-full rounded-md border border-input bg-card px-2 py-2 text-sm";

function filtrarVersoes(versoes: VersaoComAnterior[], filtros: SearchParams) {
  const texto = (valor: string | null | undefined) => (valor ?? "").toLocaleLowerCase("pt-BR");
  const inclui = (valor: string | null | undefined, filtro: string | undefined) =>
    !filtro || texto(valor).includes(texto(filtro));
  const dataMin = (valor: string, min?: string) => !min || valor.slice(0, 10) >= min;
  const dataMax = (valor: string, max?: string) => !max || valor.slice(0, 10) <= max;
  const numeroMin = (valor: number, min?: string) => !min || valor >= Number(min);
  const numeroMax = (valor: number, max?: string) => !max || valor <= Number(max);

  return versoes.filter((item) => {
    const demanda = item.demandas_propostas;
    const snapshot = normalizarSnapshot(item.snapshot);
    const buscaLivre = [
      item.numero,
      demanda?.titulo,
      demanda?.cliente_nome,
      demanda?.responsavel_interno,
      demanda?.modalidade,
      snapshot.demanda?.titulo,
      snapshot.demanda?.cliente_nome,
      snapshot.demanda?.responsavel_interno,
      snapshot.demanda?.modalidade,
      item.status,
    ].join(" ");
    return (
      inclui(buscaLivre, filtros.texto) &&
      (!filtros.status || item.status === filtros.status) &&
      inclui(snapshot.demanda?.cliente_nome ?? demanda?.cliente_nome, filtros.cliente) &&
      inclui(snapshot.demanda?.responsavel_interno ?? demanda?.responsavel_interno ?? item.criado_por, filtros.responsavel) &&
      inclui(snapshot.demanda?.modalidade ?? demanda?.modalidade, filtros.modalidade) &&
      dataMin(item.criado_em, filtros.emitido_de) &&
      dataMax(item.criado_em, filtros.emitido_ate) &&
      (!item.valido_ate || dataMin(item.valido_ate, filtros.validade_de)) &&
      (!item.valido_ate || dataMax(item.valido_ate, filtros.validade_ate)) &&
      numeroMin(Number(item.total_final ?? 0), filtros.valor_min) &&
      numeroMax(Number(item.total_final ?? 0), filtros.valor_max)
    );
  });
}

function encontrarAnterior(versoes: VersaoFinal[], atual: VersaoFinal) {
  return versoes
    .filter((item) => item.demanda_id === atual.demanda_id && item.versao < atual.versao)
    .sort((a, b) => b.versao - a.versao)[0] ?? null;
}

function normalizarSnapshot(snapshot: Json): SnapshotFinal {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return {};
  return snapshot as SnapshotFinal;
}

function resumoParametros(snapshot: SnapshotFinal) {
  const markup = Number(snapshot.consolidado?.markupProjeto ?? 0);
  const params = snapshot.consolidado?.parametrosProjeto ?? [];
  if (params.length === 0 && markup === 0) return "sem parâmetros registrados";
  const nomes = params.slice(0, 3).map((item) => `${item.label ?? item.key}: ${Number(item.nominalRate ?? 0).toLocaleString("pt-BR")}%`);
  return [`Σ parâmetros ${markup.toLocaleString("pt-BR")}%`, ...nomes].join(" · ");
}

function composicaoEconomica(item: VersaoFinal, snapshot: SnapshotFinal) {
  const custoAnalises = Number(snapshot.consolidado?.totalLaboratorioCusto ?? item.total_laboratorio_custo ?? 0);
  const custoProjeto = Number(snapshot.consolidado?.totalProjetoCusto ?? item.total_projeto_custo ?? 0);
  const subtotalCustos = custoAnalises + custoProjeto;
  // Engine atual grava economia.parametros ({chave, label, valorNominal}); versões antigas, parametrosProjeto.
  const economia = snapshot.consolidado?.economia?.parametros;
  const parametros: SnapshotParametro[] = Array.isArray(economia)
    ? economia.map((p) => ({ key: p.chave, label: p.label, amount: p.valorNominal }))
    : snapshot.consolidado?.parametrosProjeto ?? [];
  const totalParametros = (predicado: (parametro: SnapshotParametro) => boolean) =>
    parametros
      .filter(predicado)
      .reduce((total, parametro) => total + Number(parametro.amount ?? 0), 0);
  const taxasImpostos = totalParametros((parametro) => {
    const chave = `${parametro.key ?? ""} ${parametro.label ?? ""}`.toLocaleLowerCase("pt-BR");
    return ["taxa", "imposto", "incubacao", "admin", "administr"].some((token) => chave.includes(token));
  });
  const margemLucro =
    totalParametros((parametro) => {
      const chave = `${parametro.key ?? ""} ${parametro.label ?? ""}`.toLocaleLowerCase("pt-BR");
      return ["margem", "lucro", "markup"].some((token) => chave.includes(token));
    }) || Math.max(0, Number(item.total_final ?? 0) - subtotalCustos - taxasImpostos);
  const fundosInvestimentos = totalParametros((parametro) => {
    const chave = `${parametro.key ?? ""} ${parametro.label ?? ""}`.toLocaleLowerCase("pt-BR");
    return ["fundo", "invest", "equip", "reserva"].some((token) => chave.includes(token));
  });

  return {
    custoAnalises,
    custoProjeto,
    subtotalCustos,
    taxasImpostos,
    margemLucro,
    fundosInvestimentos,
  };
}

function limparFiltros(filtros: SearchParams) {
  return Object.fromEntries(
    Object.entries(filtros).filter(([, value]) => value !== undefined && value !== ""),
  ) as Record<string, string>;
}

function CampoFiltro({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function Resumo({ titulo, valor, moeda = false }: { titulo: string; valor: number; moeda?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{moeda ? brl(valor) : valor.toLocaleString("pt-BR")}</p>
    </div>
  );
}

function Comparacao({ atual, anterior }: { atual: number; anterior: number }) {
  const diferenca = atual - anterior;
  const percentual = anterior !== 0 ? (diferenca / anterior) * 100 : 0;
  const classe = diferenca > 0 ? "text-warning-strong" : diferenca < 0 ? "text-brand-700 dark:text-brand-300" : "text-muted-foreground";
  return (
    <div className={classe}>
      <p>{diferenca >= 0 ? "+" : ""}{brl(diferenca)}</p>
      <p className="text-xs">{percentual >= 0 ? "+" : ""}{percentual.toFixed(2).replace(".", ",")}%</p>
    </div>
  );
}

function ComparacaoLadoALado({ atual, anterior }: { atual: VersaoComAnterior; anterior: VersaoFinal | null }) {
  const snapAtual = normalizarSnapshot(atual.snapshot);
  const snapAnterior = anterior ? normalizarSnapshot(anterior.snapshot) : null;
  return (
    <section className="mt-6 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Comparação lado a lado</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {atual.numero} contra {anterior ? anterior.numero : "primeira versão"}.
          </p>
        </div>
        <Link href="/orcamento/historico" className="text-sm text-muted-foreground hover:underline">Fechar comparação</Link>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <PainelComparado titulo="Versão selecionada" versao={atual} snapshot={snapAtual} />
        {anterior ? (
          <PainelComparado titulo="Versão anterior" versao={anterior} snapshot={snapAnterior ?? {}} />
        ) : (
          <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            Não há versão anterior para comparar.
          </div>
        )}
      </div>
      {anterior && (
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Delta titulo="Laboratório" atual={atual.total_laboratorio_preco} anterior={anterior.total_laboratorio_preco} />
          <Delta titulo="Projeto" atual={atual.total_projeto_final} anterior={anterior.total_projeto_final} />
          <Delta titulo="Total" atual={atual.total_final} anterior={anterior.total_final} />
          <Delta titulo="Σ parâmetros" atual={Number(snapAtual.consolidado?.markupProjeto ?? 0)} anterior={Number(snapAnterior?.consolidado?.markupProjeto ?? 0)} percentual />
        </div>
      )}
    </section>
  );
}

function PainelComparado({ titulo, versao, snapshot }: { titulo: string; versao: VersaoFinal; snapshot: SnapshotFinal }) {
  const analises = snapshot.orcamentos_analises?.reduce((total, item) => total + (item.orcamento_itens?.length ?? 0), 0) ?? 0;
  const custosProjeto = snapshot.orcamentos_projeto?.reduce(
    (total, item) => total + (item.orcamento_projeto_custos?.length ?? 0) + (item.orcamento_projeto_analises?.length ?? 0),
    0,
  ) ?? 0;
  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <Info label="Número" value={`${versao.numero} · v${versao.versao}`} />
        <Info label="Status" value={rotuloStatusVersaoFinal(versao.status)} />
        <Info label="Criado em" value={formatDateTime(versao.criado_em)} />
        <Info label="Validade" value={formatDate(versao.valido_ate)} />
        <Info label="Itens laboratório" value={String(analises)} />
        <Info label="Itens projeto" value={String(custosProjeto)} />
        <Info label="Parâmetros" value={resumoParametros(snapshot)} wide />
        <Info label="Total" value={brl(Number(versao.total_final ?? 0))} wide />
      </dl>
    </div>
  );
}

function Delta({ titulo, atual, anterior, percentual = false }: { titulo: string; atual: number; anterior: number; percentual?: boolean }) {
  const delta = Number(atual ?? 0) - Number(anterior ?? 0);
  return (
    <div className="rounded-md bg-muted/50 p-3">
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <p className="mt-1 font-semibold tabular-nums">{percentual ? `${delta.toLocaleString("pt-BR")}%` : brl(delta)}</p>
    </div>
  );
}

function Info({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-md bg-muted/50 p-2 ${wide ? "sm:col-span-2" : ""}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{children}</span>;
}


function Status({ status }: { status: string }) {
  const cls =
    ["emitido", "enviado", "alterado_reenviado"].includes(status)
      ? "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300"
      : status === "aprovado" || status === "convertido_projeto"
        ? "bg-success-soft text-success-strong"
      : status === "vencido"
        ? "bg-warning-soft text-warning-strong"
        : ["cancelado", "rejeitado", "recusado"].includes(status)
          ? "bg-danger-soft text-danger-strong"
          : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{rotuloStatusVersaoFinal(status)}</span>;
}
