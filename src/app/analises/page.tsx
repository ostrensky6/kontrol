import { createClient } from "@/lib/supabase/server";
import { gargalo, horasBancadaPorAmostra, type Etapa } from "@/lib/costing/engine";
import { calcularTodas } from "@/lib/costing/loader";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { podeEditarAnalises } from "@/lib/auth/permissao-efetiva";
import { HelpExample, HelpLegend, HelpTip } from "@/components/common/HelpTip";
import {
  AnaliseLinhaAcoes,
  NovaAnaliseButton,
  type AnaliseOpcao,
} from "@/components/analises/AnaliseCatalogoAcoes";

export const dynamic = "force-dynamic";

type AnaliseCatalogo = {
  codigo: string;
  nome: string | null;
  nome_simplificado: string | null;
  descricao: string | null;
  status: string | null;
  ativo: boolean;
  ofertavel: boolean;
};

type DiagnosticoAnalise = {
  analise: AnaliseCatalogo;
  nEtapas: number;
  nInsumos: number;
  nEquipamentos: number;
  tempoBancada: number;
  amostrasDia: number;
  preco: number | null;
  avisos: string[];
};

type ConsultaIssue = {
  tabela: string;
  mensagem: string;
};

const card =
  "rounded-lg border border-border bg-card p-4 shadow-sm";

function statusTextualIndicaRevisao(status: string | null) {
  return /experimental|experimento|revis|avali|pend|todo/i.test(status ?? "");
}

function grupoDaAnalise(analise: AnaliseCatalogo) {
  if (!analise.ativo) return "inativas";
  if (statusTextualIndicaRevisao(analise.status)) return "revisao";
  return analise.ofertavel ? "ofertaveis" : "ativas_nao_ofertaveis";
}

function rotuloPrincipal(analise: AnaliseCatalogo) {
  return analise.nome_simplificado || analise.nome || analise.codigo;
}

function badgeAtivo(ativo: boolean) {
  return ativo
    ? "bg-success-soft text-success-strong ring-success-strong/30"
    : "bg-muted text-muted-foreground ring-border";
}

function erroConsulta(tabela: string, error: { message?: string | null; code?: string | null } | null) {
  if (!error) return null;
  return {
    tabela,
    mensagem: [error.code, error.message].filter(Boolean).join(" - ") || "Falha ao consultar dados.",
  };
}

export default async function AnalisesPage() {
  const supabase = await createClient();
  const [
    analisesResult,
    etapasResult,
    insumosAnaliseResult,
    equipamentosAnaliseResult,
  ] =
    await Promise.all([
      supabase
        .from("analises")
        .select("codigo, nome, nome_simplificado, descricao, status, ativo, ofertavel")
        .order("codigo"),
      supabase.from("etapas").select("*"),
      supabase
        .from("insumo_analise")
        .select("codigo_analise, insumo_id, quantidade_por_amostra, especificacao_insumo"),
      supabase
        .from("equipamento_analise")
        .select("codigo_analise, equipamento_id, peso_alocacao")
        .gt("peso_alocacao", 0),
    ]);

  const consultaIssues = [
    erroConsulta("analises", analisesResult.error),
    erroConsulta("etapas", etapasResult.error),
    erroConsulta("insumo_analise", insumosAnaliseResult.error),
    erroConsulta("equipamento_analise", equipamentosAnaliseResult.error),
  ].filter((issue): issue is ConsultaIssue => issue != null);

  const analises = analisesResult.data;
  const etapas = etapasResult.data;
  const insumosAnalise = insumosAnaliseResult.data;
  const equipamentosAnalise = equipamentosAnaliseResult.data;

  let custos = new Map<string, number>();
  let semPreco = new Map<string, string[]>();
  let erroCusteio = false;
  try {
    const { breakdowns } = await calcularTodas();
    custos = new Map(breakdowns.map((b) => [b.codigo, b.preco]));
    semPreco = new Map(breakdowns.map((b) => [b.codigo, b.insumosSemCusto ?? []]));
  } catch {
    erroCusteio = true;
    custos = new Map();
  }

  const diagnosticos: DiagnosticoAnalise[] = ((analises ?? []) as AnaliseCatalogo[]).map((analise) => {
    const etapasDaAnalise = ((etapas ?? []) as Etapa[]).filter(
      (etapa) => (etapa as unknown as { codigo_analise: string }).codigo_analise === analise.codigo,
    );
    const insumosDaAnalise = (insumosAnalise ?? []).filter((linha) => linha.codigo_analise === analise.codigo);
    const equipamentosDaAnalise = (equipamentosAnalise ?? []).filter((linha) => linha.codigo_analise === analise.codigo);
    const g = gargalo(etapasDaAnalise);
    const avisos: string[] = [];

    if (etapasDaAnalise.length === 0) avisos.push("sem etapas");
    if (insumosDaAnalise.length === 0) avisos.push("sem materiais/insumos");
    if (equipamentosDaAnalise.length === 0) avisos.push("sem equipamentos");
    if (insumosDaAnalise.some((linha) => Number(linha.quantidade_por_amostra ?? 0) > 0 && !linha.insumo_id)) {
      avisos.push("material consumido sem vínculo com insumo de estoque");
    }
    if (analise.ativo && statusTextualIndicaRevisao(analise.status)) {
      avisos.push("ativa com status textual de revisão");
    }
    if (analise.ativo && !analise.ofertavel) avisos.push("ativa, mas fora da oferta comercial");
    if (analise.ativo && (custos.get(analise.codigo) ?? 0) <= 0) avisos.push("sem preço calculado");
    const faltando = semPreco.get(analise.codigo) ?? [];
    if (faltando.length > 0) avisos.push(`insumo sem preço: ${faltando.join(", ")}`);

    return {
      analise,
      nEtapas: etapasDaAnalise.length,
      nInsumos: insumosDaAnalise.length,
      nEquipamentos: equipamentosDaAnalise.length,
      tempoBancada: horasBancadaPorAmostra(etapasDaAnalise),
      amostrasDia: g.amostrasDia,
      preco: custos.get(analise.codigo) ?? null,
      avisos,
    };
  });

  const totalOfertaveis = diagnosticos.filter((item) => item.analise.ativo && item.analise.ofertavel);
  const ofertaveisEmRevisao = diagnosticos.filter(
    (item) => item.analise.ativo && item.analise.ofertavel && statusTextualIndicaRevisao(item.analise.status),
  );
  const ativasNaoOfertaveis = diagnosticos.filter((item) => grupoDaAnalise(item.analise) === "ativas_nao_ofertaveis");
  const inativas = diagnosticos.filter((item) => grupoDaAnalise(item.analise) === "inativas");
  const podeEditar = await podeEditarAnalises();
  const opcoes: AnaliseOpcao[] = diagnosticos.map((item) => ({
    codigo: item.analise.codigo,
    rotulo: rotuloPrincipal(item.analise),
  }));
  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <h1 className="text-xl font-semibold tracking-tight">Análises</h1>
            <HelpTip title="Catálogo de análises">
              <p>
                Cada análise tem uma <b>receita</b> (etapas, materiais e equipamentos). Dela saem a
                capacidade por dia, o custo e o preço usados nos orçamentos.
              </p>
              <p>
                Use <b>Nova análise</b> para criar e <b>⋯</b> na linha para duplicar ou excluir.
                Análises já usadas não podem ser excluídas: inative-as na ficha.
              </p>
            </HelpTip>
          </div>
          {podeEditar && <NovaAnaliseButton analises={opcoes} />}
        </div>

        {consultaIssues.length > 0 && <ConsultaAlert issues={consultaIssues} />}

        {erroCusteio && (
          <div className="mt-4 rounded-lg border border-warning-strong/30 bg-warning-soft p-4 text-sm text-warning-strong">
            <p className="font-medium">Custeio indisponível</p>
            <p className="mt-1">As análises foram carregadas, mas o preço calculado não pôde ser obtido agora.</p>
          </div>
        )}

        <div className="mt-6 flex items-center gap-1 text-xs font-medium text-muted-foreground">
          Situação do catálogo
          <HelpTip title="Situação das análises">
            <HelpLegend
              items={[
                { tom: "ok", rotulo: "Ativa", texto: "pode ser usada em planos e orçamentos." },
                { tom: "info", rotulo: "Ofertável", texto: "também aparece para o cliente nas propostas." },
                { tom: "neutro", rotulo: "Inativa", texto: "fora de uso; o histórico é preservado e ela pode ser reativada." },
              ]}
            />
            <p><b>Em revisão</b> são análises ofertáveis cujo status foi marcado para revisão.</p>
          </HelpTip>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Ofertáveis totais" value={String(totalOfertaveis.length)} />
          <Stat label="Ofertáveis em revisão" value={String(ofertaveisEmRevisao.length)} />
          <Stat label="Ativas não ofertáveis" value={String(ativasNaoOfertaveis.length)} />
          <Stat label="Inativas" value={String(inativas.length)} />
        </div>

        {diagnosticos.length > 0 ? (
          <AnalisesResumoTable rows={diagnosticos} opcoes={opcoes} podeEditar={podeEditar} />
        ) : (
          <EmptyAnalises />
        )}
      </main>
    </div>
  );
}

function ConsultaAlert({ issues }: { issues: ConsultaIssue[] }) {
  return (
    <section className="mt-6 rounded-lg border border-danger-strong/30 bg-danger-soft p-4 text-sm text-danger-strong">
      <p className="font-medium">Falha ao carregar dados de análises</p>
      <p className="mt-1">
        Algumas consultas não retornaram corretamente. Nenhum dado sensível foi exibido.
      </p>
      <ul className="mt-3 space-y-1">
        {issues.map((issue) => (
          <li key={issue.tabela}>
            <span className="font-mono text-xs">{issue.tabela}</span>: {issue.mensagem}
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmptyAnalises() {
  return (
    <section className={`${card} mt-6`}>
      <p className="font-medium">Nenhuma análise cadastrada.</p>
      <p className="mt-1 text-sm text-muted-foreground">Crie a primeira em “Nova análise”.</p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function AnalisesResumoTable({
  rows,
  opcoes,
  podeEditar,
}: {
  rows: DiagnosticoAnalise[];
  opcoes: AnaliseOpcao[];
  podeEditar: boolean;
}) {
  return (
    <section className="mt-6 rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border/70 px-3 py-2">
        <h2 className="text-sm font-semibold">Catálogo de análises</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="mx-auto table-auto border-collapse">
          <thead>
            <tr className="bg-muted/35">
              <th className={tableHead}>Código</th>
              <th className={tableHead}>Análise</th>
              <th className={tableHead}>Status</th>
              <th className={`${tableHead} text-right`}>Etapas</th>
              <th className={`${tableHead} text-right`}>Insumos</th>
              <th className={`${tableHead} text-right`}>Equip.</th>
              <th className={`${tableHead} text-right`}>
                <span className="inline-flex items-center gap-1">
                  Capacidade
                  <HelpTip title="Capacidade diária">
                    <p>Amostras por dia que a análise comporta, definidas pela <b>etapa mais lenta</b> da receita: corridas por dia × amostras por corrida.</p>
                    <HelpExample>2 corridas por dia × 12 amostras = 24/dia.</HelpExample>
                  </HelpTip>
                </span>
              </th>
              <th className={`${tableHead} text-right`}>
                <span className="inline-flex items-center gap-1">
                  Preço
                  <HelpTip title="Preço de tabela">
                    <p>Custo total por amostra com os <b>fatores de preço</b> de Parâmetros de custeio. Nas propostas, serve só como referência.</p>
                  </HelpTip>
                </span>
              </th>
              <th className={tableHead}>Alertas</th>
              <th className={`${tableHead} text-right`}>Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const { analise } = item;
              return (
                <tr key={analise.codigo} className="border-t border-border/70 hover:bg-muted/25">
                  <td className="whitespace-nowrap px-3 py-2 align-middle font-mono text-xs text-muted-foreground">{analise.codigo}</td>
                  <td className="min-w-64 px-3 py-2 align-middle">
                    <p className="text-sm font-medium">{rotuloPrincipal(analise)}</p>
                    {analise.descricao && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{analise.descricao}</p>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-middle">
                    <div className="flex flex-wrap gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${badgeAtivo(analise.ativo)}`}>
                        {analise.ativo ? "Ativa" : "Inativa"}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${analise.ofertavel ? "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-900" : "bg-muted text-muted-foreground ring-border"}`}>
                        {analise.ofertavel ? "Ofertável" : "Não ofertável"}
                      </span>
                    </div>
                  </td>
                  <td className={tableNumber}>{item.nEtapas}</td>
                  <td className={tableNumber}>{item.nInsumos}</td>
                  <td className={tableNumber}>{item.nEquipamentos}</td>
                  <td className={tableNumber}>{item.amostrasDia > 0 ? `${formatNumber(item.amostrasDia)}/dia` : "-"}</td>
                  <td className={tableNumber}>{item.preco != null && item.preco > 0 ? formatCurrency(item.preco) : "-"}</td>
                  <td className="max-w-80 px-3 py-2 align-middle">
                    {item.avisos.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {item.avisos.slice(0, 3).map((aviso) => (
                          <span key={aviso} className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] text-warning-strong">
                            {aviso}
                          </span>
                        ))}
                        {item.avisos.length > 3 && <span className="text-[11px] text-muted-foreground">+{item.avisos.length - 3}</span>}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right align-middle">
                    <AnaliseLinhaAcoes
                      codigo={analise.codigo}
                      rotulo={rotuloPrincipal(analise)}
                      analises={opcoes}
                      podeEditar={podeEditar}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const tableHead = "whitespace-nowrap px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground";
const tableNumber = "whitespace-nowrap px-3 py-2 text-right align-middle text-xs tabular-nums";
