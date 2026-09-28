import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { calcularTodas } from "@/lib/costing/loader";
import {
  calcularOrcamentoProjeto,
  itensProjetoNaBaseDeCusto,
} from "@/lib/project-budget/orcamento-projeto";
import { criarResolvedorDeTaxas, type ProjetoComTaxas } from "@/lib/orcamento/valores-modulos";
import { ParametrosEconomicosForm } from "@/components/orcamento/ParametrosEconomicosForm";
import { HelpExample, HelpFormula, HelpTip } from "@/components/common/HelpTip";
import {
  formatCurrency as brl,
  formatNumber,
  formatDateTime,
  formatPercent,
} from "@/lib/formatters";

export const dynamic = "force-dynamic";

const pct = (v: number) => formatPercent(v, 2);

const PARAM_KEYS = [
  "dias_uteis_ano",
  "margem_lucro",
  "impostos",
  "taxas",
  "fundo_reserva",
  "fundo_investimento",
] as const;

type ParamKey = (typeof PARAM_KEYS)[number];
type PercentParamKey = Exclude<ParamKey, "dias_uteis_ano">;

type ProjetoAnalise = {
  n_amostras: number | null;
  custo_unitario: number | null;
};

type ProjetoCusto = {
  rubrica: string | null;
  quantidade: number | null;
  custo_unitario: number | null;
  preco_unitario: number | null;
  meses_selecionados: number[] | null;
};

type ProjetoResumo = {
  id: number;
  titulo: string | null;
  status: string | null;
  cliente_nome: string | null;
  data_orcamento: string | null;
  analisesCount: number;
  custosCount: number;
};

type VersaoParametro = {
  id: number;
  escopo: string;
  orcamento_projeto_id: number | null;
  versao: number;
  origem: string;
  criado_em: string;
  criado_por: string | null;
  parametros: unknown;
};

const DEFAULTS: Record<ParamKey, number> = {
  dias_uteis_ano: 222,
  margem_lucro: 0,
  impostos: 0,
  taxas: 0,
  fundo_reserva: 0,
  fundo_investimento: 0,
};

const PARAMETROS_LAB: Array<{
  chave: PercentParamKey;
  label: string;
  origem: string;
}> = [
  { chave: "margem_lucro", label: "Margem/lucro", origem: "global" },
  { chave: "impostos", label: "Impostos", origem: "global" },
  { chave: "taxas", label: "Taxas", origem: "global" },
  { chave: "fundo_reserva", label: "Reserva", origem: "global" },
  { chave: "fundo_investimento", label: "Investimentos", origem: "global" },
];

export default async function ParametrosEconomicosPage() {
  const supabase = await createClient();
  const [{ data: parametros }, { data: versoes }, { data: orcamentosProjeto }, { breakdowns, params }] = await Promise.all([
    supabase.from("parametros").select("chave, valor, atualizado_em"),
    supabase
      .from("parametros_economicos_versoes")
      .select("id, escopo, orcamento_projeto_id, versao, origem, criado_em, criado_por, parametros")
      .order("criado_em", { ascending: false })
      .limit(12),
    supabase
      .from("orcamento_projetos")
      .select(
        "id, demanda_id, titulo, status, cliente_nome, data_orcamento, impostos, impostos_legacy, incubacao, reserva, investimentos, lucro, margem_lucro, orcamento_projeto_analises(n_amostras, custo_unitario), orcamento_projeto_custos(rubrica, quantidade, custo_unitario, preco_unitario, meses_selecionados)",
      )
      .order("criado_em", { ascending: false })
      .limit(8),
    calcularTodas(),
  ]);

  const valores = { ...DEFAULTS };
  const atualizadoEm = new Map<string, string>();
  for (const p of parametros ?? []) {
    if (PARAM_KEYS.includes(p.chave as ParamKey)) {
      valores[p.chave as ParamKey] = Number(p.valor);
      if (p.atualizado_em) atualizadoEm.set(p.chave, p.atualizado_em);
    }
  }

  const fatorTotal =
    params.margem_lucro +
    params.impostos +
    params.taxas +
    params.fundo_reserva +
    params.fundo_investimento;
  const custoMedio =
    breakdowns.length > 0
      ? breakdowns.reduce((acc, b) => acc + b.custoTotal, 0) / breakdowns.length
      : 0;
  const precoMedio =
    breakdowns.length > 0
      ? breakdowns.reduce((acc, b) => acc + b.preco, 0) / breakdowns.length
      : 0;
  const ultimaAtualizacao = [...atualizadoEm.values()].sort().at(-1);

  const analisesPreview = [...breakdowns]
    .sort((a, b) => b.preco - a.preco)
    .slice(0, 5);
  const impactoTotalLab = Math.max(0, precoMedio - custoMedio);
  const parametrosLab = PARAMETROS_LAB.map((parametro) => ({
    ...parametro,
    valor: valores[parametro.chave],
    impacto: custoMedio * (valores[parametro.chave] / 100),
    versao: versaoMaisRecente(versoes as VersaoParametro[] | null | undefined, "laboratorio_global"),
  }));

  const taxasDa = criarResolvedorDeTaxas({
    projetos: orcamentosProjeto as unknown as ProjetoComTaxas[] | null,
    demandas: [],
    parametrosGlobais: parametros,
  });
  const projetos = ((orcamentosProjeto ?? []) as unknown as ProjetoResumo[]).map((orcamento) => {
    const analises = (orcamento as unknown as { orcamento_projeto_analises?: ProjetoAnalise[] | null })
      .orcamento_projeto_analises ?? [];
    const custos = (orcamento as unknown as { orcamento_projeto_custos?: ProjetoCusto[] | null })
      .orcamento_projeto_custos ?? [];
    // mesma base e mesmas taxas da emissão da proposta
    const itens = itensProjetoNaBaseDeCusto({ custos, analises });
    const demandaId = (orcamento as unknown as { demanda_id?: number | null }).demanda_id;
    return {
      id: orcamento.id,
      // Editor de custos fica na etapa de projeto da proposta; o endereço antigo só redireciona.
      href: demandaId ? `/orcamento/demandas/${demandaId}?etapa=projeto` : `/orcamento/projetos/${orcamento.id}`,
      titulo: orcamento.titulo,
      status: orcamento.status,
      cliente_nome: orcamento.cliente_nome,
      data_orcamento: orcamento.data_orcamento,
      rates: taxasDa(demandaId, orcamento as unknown as ProjetoComTaxas),
      itens,
      analisesCount: analises.length,
      custosCount: custos.length,
    };
  });
  const projetosCalculados = projetos.map((projeto) => ({
    ...projeto,
    calculo: calcularOrcamentoProjeto(projeto.itens, projeto.rates),
  }));
  const totalProjetoCusto = projetosCalculados.reduce((acc, projeto) => acc + projeto.calculo.subtotal, 0);
  const totalProjetoFinal = projetosCalculados.reduce((acc, projeto) => acc + projeto.calculo.grossTotal, 0);
  const impactoProjeto = Math.max(0, totalProjetoFinal - totalProjetoCusto);
  const parametrosProjeto = somarParametrosProjeto(projetosCalculados);
  const projetosInvalidos = projetosCalculados.filter((projeto) => projeto.calculo.validationError);

  const versoesLista = (versoes ?? []) as VersaoParametro[];
  const blocoVersoes =
    versoesLista.length === 0 ? (
      <LinhaVazia
        titulo="Versões de parâmetros"
        ajuda={<AjudaVersoes />}
        texto="Nenhuma versão registrada ainda. O próximo salvamento criará a primeira versão."
      />
    ) : (
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <Cabecalho titulo="Versões de parâmetros" ajuda={<AjudaVersoes />} />
        <div className="divide-y divide-border/70">
          {versoesLista.map((versao) => (
            <div
              key={versao.id}
              className="grid gap-x-3 gap-y-0.5 px-3 py-1.5 text-sm md:grid-cols-[9rem_3rem_7rem_minmax(0,8rem)_8.5rem_minmax(0,1fr)] md:items-baseline"
            >
              <span className="font-medium">
                {versao.escopo === "laboratorio_global" ? "Laboratório global" : "Projeto"}
              </span>
              <span className="tabular-nums">v{versao.versao}</span>
              <span>{versao.orcamento_projeto_id ? `Projeto #${versao.orcamento_projeto_id}` : "Global"}</span>
              <span className="truncate" title={versao.origem}>{versao.origem}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{formatDateTime(versao.criado_em)}</span>
              <span className="truncate text-xs text-muted-foreground" title={resumirPayloadVersao(versao.parametros)}>
                {resumirPayloadVersao(versao.parametros)}
              </span>
            </div>
          ))}
        </div>
      </section>
    );

  return (
    <div className="min-h-dvh bg-transparent font-sans text-foreground">
      <main className="app-page-container">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href="/orcamento"
              className="text-xs text-muted-foreground hover:underline"
            >
              Orçamentos
            </Link>
            <div className="mt-1 flex items-center gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Parâmetros econômicos</h1>
              <HelpTip title="Parâmetros econômicos">
                <p>Mostra os percentuais que formam os preços e o <b>impacto</b> de cada um, para conferir antes de recalcular ou emitir propostas. Cada salvamento gera uma nova versão.</p>
                <p>A <b>margem global</b> é o padrão do laboratório; o lucro de cada proposta é definido na própria proposta ou no orçamento de projeto.</p>
              </HelpTip>
            </div>
            {/* resumo em uma linha (28/09): os números de referência sem cartões ocupando a tela */}
            <dl className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <Indicador
                rotulo="Fator econômico total"
                valor={pct(fatorTotal)}
                destaque
                ajuda={
                  <HelpTip title="Fator econômico total" className="h-6 w-6">
                    <p>Soma dos <b>fatores de preço</b> do laboratório: margem, impostos, taxas e fundos.</p>
                  </HelpTip>
                }
              />
              <Indicador rotulo="Dias úteis/ano" valor={formatNumber(params.dias_uteis_ano)} />
              <Indicador
                rotulo="Impacto laboratório"
                valor={brl(impactoTotalLab)}
                ajuda={
                  <HelpTip title="Impacto dos parâmetros" className="h-6 w-6">
                    <p>Quanto os parâmetros <b>acrescentam ao custo</b>. No laboratório, a conta usa o custo médio do catálogo; no projeto, os orçamentos de projeto recentes.</p>
                  </HelpTip>
                }
              />
              <Indicador rotulo="Impacto projeto" valor={brl(impactoProjeto)} />
              {ultimaAtualizacao && (
                <Indicador rotulo="Última atualização" valor={formatDateTime(ultimaAtualizacao)} />
              )}
            </dl>
          </div>
          <Link href="/custeio" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Ver custeio
          </Link>
        </div>

        {/* Premissas numa faixa: seis campos curtos lado a lado; Salvar na linha do título */}
        <section aria-labelledby="premissas-titulo" className="mt-4 rounded-lg border border-border bg-card px-3 pb-3 pt-2 shadow-sm">
          <ParametrosEconomicosForm
            valores={valores}
            cabecalho={
              <div className="flex items-center gap-0.5">
                <h2 id="premissas-titulo" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Premissas de orçamento
                </h2>
                <HelpTip title="Quando as mudanças valem" className="h-6 w-6">
                  <p>Alterações valem para <b>novos cálculos</b>. Orçamentos já existentes mantêm os valores gravados até você usar <b>Recalcular preços</b>.</p>
                </HelpTip>
              </div>
            }
          />
        </section>

        {/* Blocos em duas colunas equilibradas pelo navegador (a altura de cada um
            depende dos dados); blocos sem dados viram uma linha. */}
        <div className="mt-4 gap-4 xl:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
          <TabelaParametros
            titulo="Impacto dos parâmetros globais"
            subtitulo="Simulação sobre o custo médio calculado do catálogo laboratorial."
            linhas={parametrosLab.map((parametro) => [
              parametro.label,
              pct(parametro.valor),
              parametro.origem,
              parametro.versao,
              brl(parametro.impacto),
            ])}
          />
          <PainelCustos
            titulo="Custos recebidos"
            itens={[
              ["Laboratório", brl(custoMedio), `${breakdowns.length} análise(s) no catálogo calculado`],
              ["Projeto", brl(totalProjetoCusto), `${projetosCalculados.length} orçamento(s) recentes considerados`],
              ["Consolidado", brl(custoMedio + totalProjetoCusto), "base de simulação antes dos parâmetros"],
            ]}
          />
          <section className="rounded-lg border border-border bg-card shadow-sm">
            <Cabecalho
              titulo="Fórmula e validação"
              ajuda={
                <HelpTip title="Duas fórmulas de preço" className="h-6 w-6">
                  <p><b>Laboratório</b>: o preço de tabela soma os fatores sobre o custo. <b>Projeto</b>: os percentuais incidem sobre o preço final (gross-up), por isso a soma precisa ficar abaixo de 100%.</p>
                  <HelpFormula>projeto: total = custo ÷ (1 − soma dos %)</HelpFormula>
                  <HelpExample>Custo de R$ 1.000 e 25%: laboratório → R$ 1.250; projeto → R$ 1.333,33.</HelpExample>
                </HelpTip>
              }
            />
            <dl className="grid sm:grid-cols-2">
              <InfoParametro label="Laboratório" value={`Preço = custo x (1 + ${pct(fatorTotal)})`} />
              <InfoParametro label="Projeto" value="Total = custo / (1 - soma dos percentuais)" />
              <InfoParametro label="Base laboratório" value={`${brl(custoMedio)} -> ${brl(precoMedio)}`} />
              <InfoParametro label="Base projeto" value={`${brl(totalProjetoCusto)} -> ${brl(totalProjetoFinal)}`} />
            </dl>
            <p className="px-3 py-1.5 text-xs text-muted-foreground">
              {projetosInvalidos.length > 0 ? (
                <span className="font-medium text-danger-strong">
                  {projetosInvalidos.length} orçamento(s) de projeto têm gross-up inválido e precisam de revisão antes de emissão.
                </span>
              ) : (
                <span>Percentuais válidos nos orçamentos recentes (soma abaixo de 100%).</span>
              )}
            </p>
          </section>

          <TabelaParametros
            titulo="Impacto dos parâmetros de projeto"
            subtitulo="Soma dos impactos nos orçamentos de projeto recentes."
            linhas={parametrosProjeto.map((parametro) => [
              parametro.label,
              pct(parametro.percentualMedio),
              "projeto",
              versaoMaisRecente(versoes as VersaoParametro[] | null | undefined, "projeto"),
              brl(parametro.impacto),
            ])}
          />

          {analisesPreview.length === 0 ? (
            <LinhaVazia titulo="Prévia de impacto" texto="Nenhuma análise calculada no catálogo." />
          ) : (
            <section tabIndex={0} aria-label="Prévia de impacto" className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
              <Cabecalho titulo="Prévia de impacto" subtitulo="Cinco análises com maior preço atual usando estes parâmetros." />
              <table className="w-full text-right text-sm">
                <thead className={cabecalhoTabela}>
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Análise</th>
                    <th className="px-3 py-1.5 font-medium">Custo total</th>
                    <th className="px-3 py-1.5 font-medium">Fatores</th>
                    <th className="px-3 py-1.5 font-medium">Preço</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {analisesPreview.map((b) => (
                    <tr key={b.codigo}>
                      <td className="max-w-64 truncate px-3 py-1.5 text-left font-medium" title={b.codigo}>
                        {b.codigo}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted-foreground">
                        {brl(b.custoTotal)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted-foreground">
                        {pct(b.fatores * 100)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 font-semibold tabular-nums text-brand-700 dark:text-brand-400">
                        {brl(b.preco)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {projetosCalculados.length === 0 ? (
            <LinhaVazia
              titulo="Orçamentos de projeto considerados"
              texto="Nenhum orçamento de projeto recente encontrado para simulação."
            />
          ) : (
            <section tabIndex={0} aria-label="Orçamentos de projeto considerados" className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
              <Cabecalho
                titulo="Orçamentos de projeto considerados"
                subtitulo="Leitura recente para validar base, itens, fator de gross-up e bloqueios."
              />
              <table className="w-full text-left text-sm">
                <thead className={cabecalhoTabela}>
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Projeto</th>
                    <th className="px-3 py-1.5 font-medium">Cliente</th>
                    <th className="px-3 py-1.5 text-right font-medium">Itens</th>
                    <th className="px-3 py-1.5 text-right font-medium">Custo</th>
                    <th className="px-3 py-1.5 text-right font-medium">Gross-up</th>
                    <th className="px-3 py-1.5 text-right font-medium">Total</th>
                    <th className="px-3 py-1.5 font-medium">Validação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {projetosCalculados.map((projeto) => (
                    <tr key={projeto.id}>
                      <td className="max-w-56 px-3 py-1.5">
                        <Link
                          href={projeto.href}
                          className="block truncate font-medium text-brand-700 hover:underline dark:text-brand-300"
                          title={`#${projeto.id} ${projeto.titulo ?? "Sem título"}`}
                        >
                          #{projeto.id} {projeto.titulo ?? "Sem título"}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{projeto.status ?? "sem status"}</span>
                      </td>
                      <td className="max-w-40 truncate px-3 py-1.5 text-muted-foreground" title={projeto.cliente_nome ?? undefined}>
                        {projeto.cliente_nome ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{projeto.analisesCount + projeto.custosCount}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">{brl(projeto.calculo.subtotal)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {pct(projeto.calculo.markupRate)} · {projeto.calculo.grossUpFactor.toFixed(4).replace(".", ",")}x
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums">{brl(projeto.calculo.grossTotal)}</td>
                      <td className="px-3 py-1.5">
                        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                          projeto.calculo.validationError
                            ? "bg-danger-soft text-danger-strong"
                            : "bg-success-soft text-success-strong"
                        }`}>
                          {projeto.calculo.validationError || "Válido"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {versoesLista.length === 0 && blocoVersoes}
        </div>

        {versoesLista.length > 0 && blocoVersoes}
      </main>
    </div>
  );
}

const cabecalhoTabela = "whitespace-nowrap text-[11px] uppercase tracking-wide text-muted-foreground";

function AjudaVersoes() {
  return (
    <HelpTip title="Versões de parâmetros" className="h-6 w-6">
      <p>Cada vez que parâmetros globais ou de um projeto são salvos, uma <b>nova versão</b> é registrada aqui, com data e origem.</p>
    </HelpTip>
  );
}

/** Um número do resumo do topo: rótulo discreto, valor em destaque. */
function Indicador({
  rotulo,
  valor,
  ajuda,
  destaque = false,
}: {
  rotulo: string;
  valor: string;
  ajuda?: ReactNode;
  destaque?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <dt className="flex items-center">
        {rotulo}
        {ajuda}
      </dt>
      <dd className={`font-semibold tabular-nums ${destaque ? "text-brand-700 dark:text-brand-400" : "text-foreground"}`}>
        {valor}
      </dd>
    </div>
  );
}

/** Cabeçalho de bloco em uma linha: título, ajuda e explicação curta ao lado. */
function Cabecalho({
  titulo,
  subtitulo,
  ajuda,
}: {
  titulo: string;
  subtitulo?: string;
  ajuda?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-border px-3 py-2">
      <div className="flex items-center gap-0.5">
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {ajuda ?? (subtitulo ? <HelpTip title={titulo}><p>{subtitulo}</p></HelpTip> : null)}
      </div>
    </div>
  );
}

/** Bloco sem dados: uma linha discreta no lugar de uma tabela vazia. */
function LinhaVazia({ titulo, texto, ajuda }: { titulo: string; texto: string; ajuda?: ReactNode }) {
  return (
    <section
      aria-label={titulo}
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-border bg-card px-3 py-2 shadow-sm"
    >
      <div className="flex items-center gap-0.5">
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {ajuda}
      </div>
      <p className="text-xs text-muted-foreground/80">{texto}</p>
    </section>
  );
}

function InfoParametro({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border/70 px-3 py-1.5 text-sm sm:odd:border-r">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function PainelCustos({
  titulo,
  itens,
}: {
  titulo: string;
  itens: Array<[string, string, string]>;
}) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <Cabecalho titulo={titulo} />
      <div className="divide-y divide-border/70 px-3">
        {itens.map(([label, valor, detalhe]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 py-1.5">
            <p className="min-w-0 text-sm">
              <span className="font-medium">{label}</span>
              <span className="text-xs text-muted-foreground"> · {detalhe}</span>
            </p>
            <p className="whitespace-nowrap text-right text-sm font-semibold tabular-nums">{valor}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function TabelaParametros({
  titulo,
  subtitulo,
  linhas,
}: {
  titulo: string;
  subtitulo: string;
  /** [campo, valor com unidade, origem, versão, impacto] */
  linhas: string[][];
}) {
  if (linhas.length === 0) {
    return <LinhaVazia titulo={titulo} texto="Sem dados suficientes para calcular impacto." />;
  }
  return (
    <section tabIndex={0} aria-label={titulo} className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <Cabecalho titulo={titulo} subtitulo={subtitulo} />
      <table className="w-full text-left text-sm">
        <thead className={cabecalhoTabela}>
          <tr>
            <th className="px-3 py-1.5 font-medium">Campo</th>
            <th className="px-3 py-1.5 text-right font-medium">Valor</th>
            <th className="px-3 py-1.5 font-medium">Origem</th>
            <th className="px-3 py-1.5 font-medium">Versão</th>
            <th className="px-3 py-1.5 text-right font-medium">Impacto</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {linhas.map((linha) => (
            <tr key={`${linha[0]}-${linha[2]}`}>
              <td className="px-3 py-1.5 font-medium">{linha[0]}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">{linha[1]}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{linha[2]}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{linha[3]}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums">{linha[4]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function versaoMaisRecente(
  versoes: VersaoParametro[] | null | undefined,
  escopo: "laboratorio_global" | "projeto",
) {
  const versao = (versoes ?? []).find((item) => item.escopo === escopo);
  return versao ? `v${versao.versao}` : "sem versão";
}

function somarParametrosProjeto(
  projetos: Array<{ calculo: ReturnType<typeof calcularOrcamentoProjeto> }>,
) {
  const mapa = new Map<string, { label: string; impacto: number; percentual: number; count: number }>();
  for (const projeto of projetos) {
    for (const parametro of projeto.calculo.economicParameters) {
      const atual = mapa.get(parametro.key) ?? {
        label: parametro.label,
        impacto: 0,
        percentual: 0,
        count: 0,
      };
      atual.impacto += parametro.amount;
      atual.percentual += parametro.nominalRate;
      atual.count += 1;
      mapa.set(parametro.key, atual);
    }
  }
  return [...mapa.values()].map((item) => ({
    label: item.label,
    impacto: item.impacto,
    percentualMedio: item.count > 0 ? item.percentual / item.count : 0,
  }));
}

function resumirPayloadVersao(payload: unknown) {
  if (!payload || typeof payload !== "object") return "sem payload";
  const record = payload as Record<string, unknown>;
  const entradas = Object.entries(record)
    .filter(([, value]) => typeof value === "number" || typeof value === "string")
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return entradas.length > 0 ? entradas.join(" · ") : "payload estruturado";
}
