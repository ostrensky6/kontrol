import Link from "next/link";
import { QrCode } from "@/components/common/QrCode";
import { formatDate } from "@/lib/formatters";
import { HelpExample, HelpLegend, HelpTip } from "@/components/common/HelpTip";
import { origemPublicaKontrol } from "@/lib/scanner/origem";
import { gerarUrlCurtaKontrol } from "@/lib/scanner/urls";
import { createClientUntyped } from "@/lib/supabase/server";
import { pode } from "@/lib/auth/permissao-efetiva";
import {
  EncaminharAvisoForm,
  NovaUnidadeForm,
  PlanoManutencaoForm,
  RegistrarManutencaoForm,
} from "@/components/estoque/EquipamentoForms";
import {
  ordenarAvisos,
  ROTULO_DECISAO,
  rotuloTipo,
  textoPrazo,
  type AvisoEquipamento,
} from "@/lib/equipamentos/avisos";

export const dynamic = "force-dynamic";

type SearchParams = {
  tab?: string;
  focus?: string;
  /** formato antigo dos links do scanner; mantido para links já impressos */
  scan?: string;
};

type UnidadeEquipamento = {
  id: number;
  equipamento_id: number;
  codigo_patrimonio: string | null;
  numero_serie: string | null;
  fabricante: string | null;
  modelo: string | null;
  status_operacional: string;
  ativo: boolean;
  observacoes: string | null;
  equipamentos: { nome: string | null } | { nome: string | null }[] | null;
  locais: { nome: string | null } | { nome: string | null }[] | null;
};

type ManutencaoEquipamento = {
  id: number;
  equipamento_unidade_id: number;
  tipo: string;
  data_programada: string;
  data_inicio: string | null;
  data_conclusao: string | null;
  proxima_data: string | null;
  status: string;
  bloqueia_operacao: boolean;
  tecnico_responsavel: string | null;
  descricao: string | null;
  resultado: string | null;
  ordem_servico: string | null;
  numero_documento: string | null;
};

type PlanoManutencao = {
  id: number;
  equipamento_id: number | null;
  equipamento_unidade_id: number | null;
  tipo: string;
  periodicidade_dias: number;
  tolerancia_dias: number;
  obrigatorio: boolean;
  descricao: string | null;
  ativo: boolean;
};

type StatusLogEquipamento = {
  id: number;
  equipamento_unidade_id: number;
  status_anterior: string | null;
  status_novo: string;
  motivo: string | null;
  criado_em: string;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  operacional: { label: "Operacional", cls: "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300" },
  em_manutencao: { label: "Em manutenção", cls: "bg-warning-soft text-warning-strong" },
  calibracao_pendente: { label: "Calibração pendente", cls: "bg-info-soft text-info-strong" },
  calibracao_vencida: { label: "Calibração vencida", cls: "bg-danger-soft text-danger-strong" },
  reservado: { label: "Reservado", cls: "bg-muted text-foreground" },
  inativo: { label: "Inativo", cls: "bg-muted text-muted-foreground" },
  descartado: { label: "Descartado", cls: "bg-muted text-muted-foreground" },
};

function asOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function statusMeta(status: string, ativo: boolean) {
  if (!ativo) return STATUS.inativo;
  return STATUS[status] ?? { label: status, cls: "bg-muted text-foreground" };
}

function labelTipo(value: string | null | undefined) {
  if (!value) return "—";
  return value.replaceAll("_", " ");
}

function dateTime(value: string | null | undefined) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function byUnit<T extends { equipamento_unidade_id: number }>(items: T[]) {
  return items.reduce<Record<number, T[]>>((acc, item) => {
    acc[item.equipamento_unidade_id] = [...(acc[item.equipamento_unidade_id] ?? []), item];
    return acc;
  }, {});
}

function proximaManutencao(items: ManutencaoEquipamento[]) {
  return [...items]
    .filter((item) => ["agendada", "em_execucao", "vencida"].includes(item.status))
    .sort((a, b) => dateTime(a.data_programada) - dateTime(b.data_programada))[0] ?? null;
}

function planoAplicavel(unidade: UnidadeEquipamento, planos: PlanoManutencao[]) {
  return planos.find((plano) => plano.equipamento_unidade_id === unidade.id)
    ?? planos.find((plano) => plano.equipamento_id === unidade.equipamento_id)
    ?? null;
}

export default async function EquipamentosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { focus, scan: scanAntigo } = await searchParams;
  const scan = focus ?? scanAntigo;
  const origem = await origemPublicaKontrol();
  const scanId = scan != null && /^\d+$/.test(scan) ? Number(scan) : null;
  const supabase = await createClientUntyped();

  const query = supabase
    .from("equipamento_unidades")
    .select("id, equipamento_id, codigo_patrimonio, numero_serie, fabricante, modelo, status_operacional, ativo, observacoes, equipamentos(nome), locais(nome)")
    .order("id", { ascending: true });

  const [{ data }, avisosResult, catalogoResult, antecedenciaResult, podeEditar] = await Promise.all([
    scanId ? query.eq("id", scanId) : query,
    supabase
      .from("v_equipamento_avisos")
      .select("equipamento_unidade_id, tipo, obrigatorio, periodicidade_dias, antecedencia_dias, ultima_conclusao, vencimento, situacao, dias_para_vencer, agendada_para, encaminhamento_decisao, encaminhamento_observacao, encaminhado_em, encaminhado")
      .limit(500),
    supabase.from("equipamentos").select("id, nome").order("nome").limit(500),
    supabase.from("parametros").select("valor").eq("chave", "equipamento_aviso_antecedencia_dias").maybeSingle(),
    pode("cadastros.editar"),
  ]);
  const unidades = (data ?? []) as unknown as UnidadeEquipamento[];
  const unidadeIds = unidades.map((unidade) => unidade.id);
  const [manutencoesResult, planosResult, logsResult] = unidadeIds.length > 0
    ? await Promise.all([
        supabase
          .from("equipamento_manutencoes")
          .select("id, equipamento_unidade_id, tipo, data_programada, data_inicio, data_conclusao, proxima_data, status, bloqueia_operacao, tecnico_responsavel, descricao, resultado, ordem_servico, numero_documento")
          .in("equipamento_unidade_id", unidadeIds)
          .order("data_programada", { ascending: false })
          .limit(200),
        supabase
          .from("equipamento_planos_manutencao")
          .select("id, equipamento_id, equipamento_unidade_id, tipo, periodicidade_dias, tolerancia_dias, obrigatorio, descricao, ativo")
          .eq("ativo", true)
          .limit(200),
        supabase
          .from("equipamento_status_log")
          .select("id, equipamento_unidade_id, status_anterior, status_novo, motivo, criado_em")
          .in("equipamento_unidade_id", unidadeIds)
          .order("criado_em", { ascending: false })
          .limit(200),
      ])
    : [{ data: [], error: null }, { data: [] }, { data: [] }];

  const manutencoesIndisponiveis = manutencoesResult.error != null;
  const manutencoesPorUnidade = byUnit((manutencoesResult.data ?? []) as unknown as ManutencaoEquipamento[]);
  const logsPorUnidade = byUnit((logsResult.data ?? []) as unknown as StatusLogEquipamento[]);
  const planos = (planosResult.data ?? []) as unknown as PlanoManutencao[];
  const avisosIndisponiveis = avisosResult.error != null;
  const unidadesPorId = new Map(unidades.map((u) => [u.id, u]));
  const avisos = ordenarAvisos(((avisosResult.data ?? []) as unknown as AvisoEquipamento[])
    .filter((a) => unidadesPorId.has(a.equipamento_unidade_id)));
  const avisosPendentes = avisos.filter((a) => !a.encaminhado);
  const avisosEncaminhados = avisos.filter((a) => a.encaminhado);
  const catalogo = ((catalogoResult.data ?? []) as { id: number; nome: string }[]);
  const antecedenciaPadrao = Number(antecedenciaResult.data?.valor ?? 90);
  const nomeUnidade = (id: number) => {
    const u = unidadesPorId.get(id);
    const nome = asOne(u?.equipamentos)?.nome ?? `Equipamento #${u?.equipamento_id ?? "?"}`;
    return `${nome} · ${u?.codigo_patrimonio ?? u?.numero_serie ?? `unidade #${id}`}`;
  };

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Estoque · Patrimônio físico
            </p>
            <div className="mt-1 flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Equipamentos físicos</h1>
              <HelpTip title="Equipamentos físicos">
                <p>
                  Cada aparelho do laboratório (com patrimônio ou número de série) e a etiqueta QR dele.
                  Escaneie o QR colado no aparelho para abrir a ficha.
                </p>
                <p>
                  Os avisos mostram calibrações e manutenções vencidas ou perto de vencer. Cada aviso fica na
                  lista até alguém registrar o que foi decidido ou agendar o serviço.
                </p>
                <p>Nada é bloqueado sozinho: quem decide é a pessoa responsável.</p>
              </HelpTip>
            </div>
          </div>
          <Link
            href="/cadastros/equipamentos"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Cadastro de tipos
          </Link>
        </div>

        {scanId && (
          <div className="mt-5 rounded-lg border border-info-strong/30 bg-info-soft px-4 py-3 text-sm text-info-strong">
            Exibindo a unidade escaneada #{scanId} (somente consulta).
            <Link href="/estoque/equipamentos?tab=unidades" className="ml-2 font-medium underline">
              Ver todas
            </Link>
          </div>
        )}

        <section aria-labelledby="titulo-avisos-equipamentos" className="mt-6 rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1">
            <h2 id="titulo-avisos-equipamentos" className="text-base font-semibold">Avisos de manutenção e calibração</h2>
            <HelpTip title="Como os avisos funcionam">
              <p>O vencimento vem da próxima data informada na última manutenção concluída ou, sem ela, da última conclusão somada à frequência do plano.</p>
              <p>O aviso aparece {antecedenciaPadrao} dias antes, ou com a antecedência definida no plano da unidade. O prazo padrão fica em Parâmetros.</p>
              <p>Agendar o serviço ou registrar um encaminhamento tira o aviso da lista de pendentes.</p>
            </HelpTip>
          </div>
          {avisosIndisponiveis ? (
            <p role="status" className="mt-2 text-sm text-warning-strong">Não foi possível carregar os avisos. Atualize a página para tentar de novo.</p>
          ) : avisosPendentes.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {avisos.length === 0 ? "Nenhum aviso. Para receber avisos, defina a frequência de cada unidade em “Definir frequência e aviso”." : "Nenhum aviso pendente; todos já foram encaminhados."}
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {avisosPendentes.map((a) => (
                <li key={`${a.equipamento_unidade_id}-${a.tipo}`} className="py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${a.situacao === "proximo" ? "bg-warning-soft text-warning-strong" : "bg-danger-soft text-danger-strong"}`}>
                      {textoPrazo(a)}
                    </span>
                    <span className="text-sm font-medium">{rotuloTipo(a.tipo)}</span>
                    <Link href={`/estoque/equipamentos?focus=${a.equipamento_unidade_id}`} className="text-sm underline-offset-4 hover:underline">
                      {nomeUnidade(a.equipamento_unidade_id)}
                    </Link>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.vencimento ? `Vencimento ${formatDate(a.vencimento)}` : "Sem data de referência"}
                    {a.ultima_conclusao ? ` · última em ${formatDate(a.ultima_conclusao)}` : ""}
                    {` · a cada ${a.periodicidade_dias} dias`}
                    {a.obrigatorio ? " · obrigatório" : ""}
                  </p>
                  {podeEditar && (
                    <details className="mt-2">
                      <summary className="min-h-10 cursor-pointer py-2 text-sm font-medium text-primary">Encaminhar</summary>
                      <div className="mt-2 rounded-md border border-border p-3">
                        <EncaminharAvisoForm unidadeId={a.equipamento_unidade_id} tipo={a.tipo} vencimento={a.vencimento} />
                      </div>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          {avisosEncaminhados.length > 0 && (
            <details className="mt-3 border-t border-border pt-2">
              <summary className="min-h-10 cursor-pointer py-2 text-sm font-medium">Já encaminhados ({avisosEncaminhados.length})</summary>
              <ul className="mt-1 divide-y divide-border text-sm">
                {avisosEncaminhados.map((a) => (
                  <li key={`enc-${a.equipamento_unidade_id}-${a.tipo}`} className="py-2">
                    <p><span className="font-medium">{rotuloTipo(a.tipo)}</span> · {nomeUnidade(a.equipamento_unidade_id)} · {textoPrazo(a)}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.agendada_para
                        ? `Agendada para ${formatDate(a.agendada_para)}`
                        : `${a.encaminhamento_decisao ? ROTULO_DECISAO[a.encaminhamento_decisao] : "Encaminhado"}${a.encaminhamento_observacao ? `: ${a.encaminhamento_observacao}` : ""}${a.encaminhado_em ? ` (${formatDate(a.encaminhado_em)})` : ""}`}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {podeEditar && !scanId && (
          <details className="mt-4 rounded-lg border border-border bg-card p-4 shadow-sm">
            <summary className="min-h-10 cursor-pointer py-2 text-sm font-medium">+ Cadastrar unidade física</summary>
            <div className="mt-3">
              {catalogo.length > 0
                ? <NovaUnidadeForm equipamentos={catalogo} />
                : <p className="text-sm text-muted-foreground">Cadastre primeiro o equipamento em Cadastro de tipos.</p>}
            </div>
          </details>
        )}

        <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-transparent text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">ID</th>
                <th className="px-4 py-3 text-left">Equipamento/tipo</th>
                <th className="px-4 py-3 text-left">Patrimônio</th>
                <th className="px-4 py-3 text-left">Série</th>
                <th className="px-4 py-3 text-left">Fabricante/modelo</th>
                <th className="px-4 py-3 text-left">Local</th>
                <th className="px-4 py-3 text-left">
                  <span className="inline-flex items-center gap-1">
                    Situação
                    <HelpTip title="Situação do equipamento">
                      <HelpLegend
                        items={[
                          { tom: "info", rotulo: "Operacional", texto: "pronto para uso" },
                          { tom: "atencao", rotulo: "Em manutenção", texto: "fora de uso até concluir o serviço" },
                          { tom: "info", rotulo: "Calibração pendente", texto: "calibração programada, ainda no prazo" },
                          { tom: "critico", rotulo: "Calibração vencida", texto: "não usar até recalibrar" },
                          { tom: "neutro", rotulo: "Reservado", texto: "separado para um uso específico" },
                          { tom: "neutro", rotulo: "Inativo", texto: "fora de operação ou descartado" },
                        ]}
                      />
                    </HelpTip>
                  </span>
                </th>
                <th className="px-4 py-3 text-left">Etiqueta QR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {unidades.map((unidade) => {
                const equipamento = asOne(unidade.equipamentos);
                const local = asOne(unidade.locais);
                const meta = statusMeta(unidade.status_operacional, unidade.ativo);
                const destacado = scanId === unidade.id;
                const urlCurta = gerarUrlCurtaKontrol("equipamento_unidade", unidade.id, origem);

                return (
                  <tr
                    key={unidade.id}
                    className={destacado ? "bg-info-soft/70" : ""}
                  >
                    <td className="px-4 py-3 font-mono text-xs">#{unidade.id}</td>
                    <td className="px-4 py-3 font-medium">
                      {equipamento?.nome ?? `Equipamento #${unidade.equipamento_id}`}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {unidade.codigo_patrimonio ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {unidade.numero_serie ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {[unidade.fabricante, unidade.modelo].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {local?.nome ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="inline-grid max-w-48 gap-2 rounded-md border border-border bg-card p-2 text-xs shadow-sm">
                        <QrCode
                          value={urlCurta}
                          label={`QR da unidade ${unidade.id}`}
                          size={84}
                          className="rounded bg-card"
                        />
                        <div className="space-y-0.5">
                          <p className="font-medium text-foreground">
                            ID Kontrol #{unidade.id}
                          </p>
                          <p className="truncate text-muted-foreground" title={equipamento?.nome ?? undefined}>
                            {equipamento?.nome ?? `Equipamento #${unidade.equipamento_id}`}
                          </p>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {unidade.codigo_patrimonio ?? "Sem patrimônio"}
                          </p>
                          {unidade.numero_serie && (
                            <p className="font-mono text-[11px] text-muted-foreground">
                              Série {unidade.numero_serie}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {unidades.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground/80">
                    {scanId ? `Nenhuma unidade encontrada para #${scanId}.` : "Nenhuma unidade patrimonial cadastrada."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-1">
                <h2 className="text-lg font-semibold tracking-tight">Operação básica</h2>
                <HelpTip title="Operação básica">
                  <p>
                    Até 200 registros de manutenção são carregados nesta consulta. Por unidade, o resumo
                    mostra a conclusão datada mais recente e as conclusões sem data, além da <b>próxima ação</b>,
                    do plano ativo e das mudanças recentes de situação.
                  </p>
                  <HelpExample>Próxima ação: “calibração · 12/10/2026”.</HelpExample>
                </HelpTip>
              </div>
            </div>
            <Link
              href="/cadastros/equipamentos"
              className="text-sm font-medium text-brand-700 underline-offset-4 hover:underline dark:text-brand-300"
            >
              Gerenciar cadastro de equipamentos
            </Link>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {unidades.map((unidade) => {
              const equipamento = asOne(unidade.equipamentos);
              const meta = statusMeta(unidade.status_operacional, unidade.ativo);
              const manutencoes = manutencoesPorUnidade[unidade.id] ?? [];
              const concluidas = manutencoesIndisponiveis ? [] : manutencoes.filter((item) => item.status === "concluida");
              const ultimaDatada = concluidas
                .filter((item) => item.data_conclusao != null)
                .sort((a, b) => dateTime(b.data_conclusao) - dateTime(a.data_conclusao))[0];
              const semData = concluidas.filter((item) => item.data_conclusao == null);
              const proxima = proximaManutencao(manutencoes);
              const plano = planoAplicavel(unidade, planos);
              const historico = (logsPorUnidade[unidade.id] ?? []).slice(0, 3);

              return (
                <article
                  key={`operacao-${unidade.id}`}
                  className="rounded-lg border border-border bg-card p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs text-muted-foreground">Unidade #{unidade.id}</p>
                      <h3 className="mt-1 text-base font-semibold">
                        {equipamento?.nome ?? `Equipamento #${unidade.equipamento_id}`}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Patrimônio {unidade.codigo_patrimonio ?? "não informado"} · Série {unidade.numero_serie ?? "não informada"}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
                      {meta.label}
                    </span>
                  </div>

                  <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border border-border/70 p-3">
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Conclusões no recorte carregado</dt>
                      {ultimaDatada?.data_conclusao != null && (
                        <dd className="mt-1 text-sm font-medium">
                          <p>{labelTipo(ultimaDatada.tipo)} · Concluída em {formatDate(ultimaDatada.data_conclusao)}</p>
                          {ultimaDatada.resultado && (
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{ultimaDatada.resultado}</p>
                          )}
                        </dd>
                      )}
                      {semData.map((item) => (
                        <dd key={item.id} className="mt-2 text-sm font-medium">
                          <p>{labelTipo(item.tipo)} · Data de conclusão não informada</p>
                          {item.resultado && (
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.resultado}</p>
                          )}
                        </dd>
                      ))}
                      {concluidas.length === 0 && (
                        <dd className="mt-1 text-sm font-medium">
                          {manutencoesIndisponiveis
                            ? "Não foi possível carregar as conclusões. Atualize a página para tentar novamente."
                            : "Nenhuma manutenção concluída no recorte carregado"}
                        </dd>
                      )}
                    </div>
                    <div className="rounded-md border border-border/70 p-3">
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Próxima ação</dt>
                      <dd className="mt-1 text-sm font-medium">
                        {manutencoesIndisponiveis || !Array.isArray(manutencoesResult.data)
                          ? "Agenda indisponível no recorte carregado."
                          : proxima
                            ? `${labelTipo(proxima.tipo)} · ${formatDate(proxima.data_programada)}`
                            : !Array.isArray(planosResult.data) || ("error" in planosResult && planosResult.error != null)
                              ? "Sem ocorrência aberta no recorte; plano indisponível."
                              : plano
                                ? `${labelTipo(plano.tipo)} · a cada ${plano.periodicidade_dias} dias`
                                : "Sem agenda/plano ativo"}
                      </dd>
                      {proxima?.bloqueia_operacao && (
                        <p className="mt-1 text-xs font-medium text-danger-strong">Bloqueia operação</p>
                      )}
                    </div>
                    <div className="rounded-md border border-border/70 p-3">
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plano ativo</dt>
                      {!Array.isArray(planosResult.data) || ("error" in planosResult && planosResult.error != null) ? (
                        <dd className="mt-1 text-sm font-medium">Planos indisponíveis no recorte carregado.</dd>
                      ) : (
                        <>
                          <dd className="mt-1 text-sm font-medium">
                            {plano ? `${labelTipo(plano.tipo)} · tolerância ${plano.tolerancia_dias} dias` : "Nenhum plano aplicável"}
                          </dd>
                          {plano?.descricao && (
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{plano.descricao}</p>
                          )}
                        </>
                      )}
                    </div>
                    <div className="rounded-md border border-border/70 p-3">
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Histórico de status</dt>
                      <dd className="mt-1 space-y-1 text-xs text-muted-foreground">
                        {historico.length > 0 ? historico.map((item) => (
                          <p key={item.id}>
                            <span className="font-medium text-foreground">{statusMeta(item.status_novo, true).label}</span>
                            {" · "}
                            {formatDate(item.criado_em)}
                          </p>
                        )) : "Sem transições registradas"}
                      </dd>
                    </div>
                  </dl>
                  <details className="mt-4 border-t border-border/70 pt-2">
                    <summary className="min-h-10 cursor-pointer rounded-sm py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      Datas registradas da unidade #{unidade.id}
                    </summary>
                    {manutencoesIndisponiveis || !Array.isArray(manutencoesResult.data) ? (
                      <p className="mt-2 text-sm">Não foi possível carregar as datas registradas. Atualize a página para tentar novamente.</p>
                    ) : manutencoes.length === 0 ? (
                      <p className="mt-2 text-sm">Nenhuma ocorrência desta unidade no recorte carregado.</p>
                    ) : (
                      <>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Datas das ocorrências no recorte carregado.
                        </p>
                        <ul className="mt-2 divide-y divide-border/70">
                          {manutencoes.map((item) => (
                            <li key={item.id} className="min-w-0 py-3">
                              <p className="text-sm font-medium">Ocorrência #{item.id} · {labelTipo(item.tipo)}</p>
                              <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                                {([
                                  ["Data programada", item.data_programada],
                                  ["Início registrado", item.data_inicio],
                                  ["Conclusão registrada", item.data_conclusao],
                                  ["Próxima data registrada", item.proxima_data],
                                ] as const).map(([rotulo, data]) => (
                                  <div key={rotulo}>
                                    <dt className="text-muted-foreground">{rotulo}</dt>
                                    <dd>{data ? <time dateTime={data}>{formatDate(data)}</time> : "Não informada"}</dd>
                                  </div>
                                ))}
                              </dl>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </details>
                  {podeEditar && (
                    <>
                      <details className="border-t border-border/70 pt-2">
                        <summary className="min-h-10 cursor-pointer rounded-sm py-2 text-sm font-medium">Registrar manutenção ou calibração</summary>
                        <div className="mt-2"><RegistrarManutencaoForm unidadeId={unidade.id} /></div>
                      </details>
                      <details className="border-t border-border/70 pt-2">
                        <summary className="min-h-10 cursor-pointer rounded-sm py-2 text-sm font-medium">Definir frequência e aviso</summary>
                        <div className="mt-2"><PlanoManutencaoForm unidadeId={unidade.id} antecedenciaPadrao={antecedenciaPadrao} /></div>
                      </details>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
