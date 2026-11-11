"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Select } from "@/components/ui/select";
import {
  FILTROS_PAINEL_VAZIOS,
  FILTROS_URL,
  filtrarRecorte,
  filtrosDaUrl,
  movimentosPorMes,
  opcoesFiltro,
  resumoPorCategoria,
  urlComFiltros,
  type FiltrosPainel,
  type MovimentoPainelDb,
} from "@/lib/cadastros/painel-insumos";
import {
  faixasCobertura,
  montarAlertas,
  resumirAlertas,
  resumirDecisao,
  textoResumoAlertas,
  valorPorCategoria,
  type Alerta,
  type InsumoDecisao,
  type LotePainelDb,
  type LoteVencendo,
  type TomAlerta,
} from "@/lib/cadastros/painel-decisao";
import { formatCompactCurrency, formatCurrency, formatInteger } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { LINHA_EIXO, MARCA_EIXO, tituloEixoX, tituloEixoY } from "@/components/common/eixos-grafico";
import { TabelaDoGrafico } from "@/components/common/TabelaDoGrafico";

const COR = {
  ok: "#008a00",
  critico: "#b91c1c",
  ambar: "#d97706",
  semMinimo: "#94a3b8",
  entradas: "#008a00",
  saidas: "#01489d",
  valor: "#01489d",
};

const COR_FAIXA = { vermelho: COR.critico, ambar: COR.ambar, verde: COR.ok, cinza: COR.semMinimo };

const TOM_ALERTA: Record<TomAlerta, { borda: string; selo: string; rotulo: string }> = {
  vermelho: { borda: "border-l-danger-strong", selo: "bg-danger-soft text-danger-strong", rotulo: "Urgente" },
  ambar: { borda: "border-l-warning-strong", selo: "bg-warning-soft text-warning-strong", rotulo: "Atenção" },
  azul: { borda: "border-l-info-strong", selo: "bg-info-soft text-info-strong", rotulo: "Acompanhar" },
  cinza: { borda: "border-l-muted-foreground", selo: "bg-muted text-muted-foreground", rotulo: "Cadastro" },
};

const ITENS_POR_ALERTA = 5;

/**
 * Painel único de situação do estoque (D1 e L1 da revisão de 11/11): os 14
 * quadros de alerta e os gráficos. Fica em Estoque › Situação do estoque;
 * o Início e Cadastros mostram só a contagem e levam até aqui. Desde a
 * organização de 11/11/2026 a tela tem três visões: os quadros ficam na
 * visão por insumo e os gráficos na visão Gráficos (`mostrar`).
 */
export function PainelSituacaoEstoque({
  insumos,
  lotesVencendo,
  lotes,
  movimentos,
  movimentosCompletos,
  graficosIncompletos,
  hojeIso,
  erro,
  mostrar,
}: {
  /** "quadros": os quadros de alerta; "graficos": os quatro gráficos */
  mostrar: "quadros" | "graficos";
  insumos: InsumoDecisao[];
  lotesVencendo: LoteVencendo[];
  lotes: LotePainelDb[];
  movimentos: MovimentoPainelDb[];
  movimentosCompletos: boolean;
  graficosIncompletos: { cobertura: boolean; categorias: boolean; valores: boolean; movimentos: boolean };
  hojeIso: string;
  erro?: string | null;
}) {
  const [filtros, setFiltros] = useState<FiltrosPainel>(FILTROS_PAINEL_VAZIOS);
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    // gráficos do recharts só no cliente (medem o contêiner); os filtros vêm
    // da URL para voltar da ficha do insumo (ou abrir um link) no mesmo recorte
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMontado(true);
    const params = new URLSearchParams(window.location.search);
    if (Object.values(FILTROS_URL).some((chave) => params.has(chave))) setFiltros(filtrosDaUrl(window.location.search));
  }, []);

  useEffect(() => {
    if (!montado) return;
    const destino = `${window.location.pathname}${urlComFiltros(window.location.search, filtros)}${window.location.hash}`;
    if (destino !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, "", destino);
    }
  }, [filtros, montado]);

  const recorte = useMemo(
    () => filtrarRecorte(insumos, { ...filtros, busca: "", codigoFabricante: "" }) as InsumoDecisao[],
    [insumos, filtros],
  );
  const idsRecorte = useMemo(() => new Set(recorte.map((item) => item.id)), [recorte]);
  const resumo = useMemo(() => resumirDecisao(recorte), [recorte]);
  const alertas = useMemo(
    () =>
      montarAlertas({
        itens: recorte,
        lotesVencendo: lotesVencendo.filter((lote) => idsRecorte.has(lote.insumoId)),
        lotes,
        movimentos,
        movimentosCompletos,
        hojeIso,
      }),
    [recorte, lotesVencendo, idsRecorte, lotes, movimentos, movimentosCompletos, hojeIso],
  );
  const ativos = alertas.filter((alerta) => alerta.itens.length > 0);
  const emOrdem = erro ? [] : alertas.filter((alerta) => alerta.itens.length === 0);
  const filtrosDeSelecao = Boolean(filtros.categoriaCompra || filtros.categoriaCurta);
  const campoCategoria = filtros.categoriaCurta ? "categoriaCompra" : "categoriaCurta";
  const porCategoria = useMemo(
    () => resumoPorCategoria(recorte.filter((item) => item.estadoSaldo === "saldo_sistema"), campoCategoria, 8),
    [recorte, campoCategoria],
  );
  const valores = useMemo(() => valorPorCategoria(recorte, campoCategoria), [recorte, campoCategoria]);
  const cobertura = useMemo(() => faixasCobertura(recorte), [recorte]);
  const movimentosMes = useMemo(
    // sempre só os insumos do painel (ativos), mesmo sem filtro
    () => graficosIncompletos.movimentos
      ? []
      : movimentosPorMes(movimentos, filtrosDeSelecao ? idsRecorte : new Set(insumos.map((item) => item.id)), hojeIso),
    [movimentos, graficosIncompletos.movimentos, idsRecorte, insumos, filtrosDeSelecao, hojeIso],
  );
  const temMovimento = movimentosMes.some((mes) => mes.entradas + mes.saidas > 0);
  const temCobertura = cobertura.some((faixa) => faixa.insumos > 0);
  const urgentes = ativos.filter((alerta) => alerta.tom === "vermelho").length;

  const opcoesCompra = useMemo(() => opcoesFiltro(insumos, filtros, "categoriaCompra"), [insumos, filtros]);
  const opcoesCurta = useMemo(() => opcoesFiltro(insumos, filtros, "categoriaCurta"), [insumos, filtros]);

  function mudar(campo: keyof FiltrosPainel, valor: string) {
    setFiltros((atual) => ({ ...atual, [campo]: valor }));
  }

  return (
    <section aria-labelledby="painel-situacao-titulo" className="space-y-4">
      <h2 id="painel-situacao-titulo" className="sr-only">
        {mostrar === "graficos" ? "Gráficos do estoque" : "Alertas do estoque"}
      </h2>

      {erro ? (
        <p role="alert" className="rounded-md border border-danger-strong/30 bg-danger-soft px-3 py-2 text-sm text-danger-strong">
          {erro}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">Saldo registrado no sistema · Conferência física não comprovada.</p>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
        <label className="grid min-w-48 flex-1 gap-1 text-xs font-medium text-muted-foreground sm:flex-none">
          Categoria de compra
          <Select value={filtros.categoriaCompra} onChange={(e) => mudar("categoriaCompra", e.target.value)}>
            <option value="">Todas</option>
            {opcoesCompra.map((valor) => (
              <option key={valor} value={valor}>
                {valor}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid min-w-48 flex-1 gap-1 text-xs font-medium text-muted-foreground sm:flex-none">
          Categoria curta
          <Select value={filtros.categoriaCurta} onChange={(e) => mudar("categoriaCurta", e.target.value)}>
            <option value="">Todas</option>
            {opcoesCurta.map((valor) => (
              <option key={valor} value={valor}>
                {valor}
              </option>
            ))}
          </Select>
        </label>
        {filtrosDeSelecao ? (
          <button
            type="button"
            onClick={() => setFiltros(FILTROS_PAINEL_VAZIOS)}
            className="h-9 rounded-md border border-input px-3 text-sm font-medium text-foreground hover:bg-muted"
          >
            Limpar filtros
          </button>
        ) : null}
        <dl className="ml-auto flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div>
            {/* o mesmo texto do cartão de contagem do Início e de Cadastros (D1) */}
            <dt className="text-xs text-muted-foreground">{erro ? "Itens em alerta (leitura parcial)" : "Itens em alerta"}</dt>
            <dd className={urgentes > 0 ? "font-semibold text-danger-strong" : "font-semibold"} data-testid="resumo-situacao">
              {textoResumoAlertas(resumirAlertas(alertas))}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Insumos ativos</dt>
            <dd className="font-semibold tabular-nums">{formatInteger(resumo.insumos)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Valor em estoque</dt>
            <dd className="font-semibold tabular-nums">
              {graficosIncompletos.valores ? "Indisponível" : formatCompactCurrency(resumo.valorEstoque)}
            </dd>
          </div>
        </dl>
      </div>

      {mostrar === "graficos" ? null : ativos.length > 0 ? (
        <div className="grid min-w-0 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ativos.map((alerta) => (
            <QuadroAlerta key={alerta.chave} alerta={alerta} />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground shadow-sm">
          {erro ? "A leitura incompleta não permite concluir se há alertas neste recorte." : "Nenhum alerta neste recorte."}
        </p>
      )}

      {mostrar === "quadros" && emOrdem.length > 0 ? (
        <section aria-labelledby="em-ordem-titulo" className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
          <h3 id="em-ordem-titulo" className="text-xs font-semibold text-muted-foreground">
            Sem alerta agora
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2 text-xs">
            {emOrdem.map((alerta) => (
              <li key={alerta.chave} className="rounded-full bg-success-soft px-2 py-0.5 font-medium text-success-strong">
                ✓ {alerta.titulo}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {mostrar === "graficos" && (
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Grafico titulo="Cobertura estimada do estoque" subtitulo="Estimativa em dias com base no saldo disponível e no ritmo das saídas registradas.">
          {graficosIncompletos.cobertura ? (
            <SemDados texto="Cobertura indisponível nesta leitura." />
          ) : montado && temCobertura ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={cobertura} margin={{ top: 8, right: 8, left: 4, bottom: 22 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="faixa" fontSize={11} tickLine={MARCA_EIXO} axisLine={LINHA_EIXO} interval={0} label={tituloEixoX("Cobertura estimada")} />
                <YAxis allowDecimals={false} fontSize={12} tickLine={MARCA_EIXO} axisLine={LINHA_EIXO} width={52} label={tituloEixoY("Insumos")} />
                <Tooltip cursor={{ fill: "rgba(148, 163, 184, 0.12)" }} />
                <Bar dataKey="insumos" name="Insumos" radius={[4, 4, 0, 0]}>
                  {cobertura.map((faixa) => (
                    <Cell key={faixa.faixa} fill={COR_FAIXA[faixa.tom]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <SemDados texto="Sem saldo para estimar a cobertura" />
          )}
          {!graficosIncompletos.cobertura && temCobertura && (
            <TabelaDoGrafico
              titulo="Cobertura estimada do estoque"
              colunas={[
                { rotulo: "Faixa", valor: (l) => l.faixa },
                { rotulo: "Insumos", valor: (l) => formatInteger(l.insumos) },
              ]}
              linhas={cobertura}
              chave={(l) => l.faixa}
            />
          )}
        </Grafico>

        <Grafico
          titulo={filtros.categoriaCurta ? "Situação por categoria de compra" : "Situação por categoria curta"}
          subtitulo="Saldos conhecidos no sistema por situação. As categorias com mais itens críticos vêm primeiro."
        >
          {graficosIncompletos.categorias ? (
            <SemDados texto="Situação por categoria indisponível nesta leitura." />
          ) : montado && porCategoria.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={porCategoria} layout="vertical" maxBarSize={22} margin={{ top: 4, left: 8, right: 16, bottom: 22 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} fontSize={12} tickLine={MARCA_EIXO} axisLine={LINHA_EIXO} label={tituloEixoX("Insumos")} />
                <YAxis type="category" dataKey="categoria" width={140} fontSize={11} tickLine={MARCA_EIXO} axisLine={LINHA_EIXO} label={tituloEixoY("Categoria")} />
                <Tooltip cursor={{ fill: "rgba(148, 163, 184, 0.12)" }} />
                <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="critico" name="Crítico no sistema" stackId="s" fill={COR.critico} />
                <Bar dataKey="ok" name="Acima do mínimo" stackId="s" fill={COR.ok} />
                <Bar dataKey="semMinimo" name="Sem mínimo" stackId="s" fill={COR.semMinimo} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <SemDados texto="Nenhum saldo de sistema no recorte" />
          )}
          {!graficosIncompletos.categorias && (
            <TabelaDoGrafico
              titulo="Situação por categoria"
              colunas={[
                { rotulo: "Categoria", valor: (l) => l.categoria },
                { rotulo: "Crítico no sistema", valor: (l) => formatInteger(l.critico) },
                { rotulo: "Acima do mínimo", valor: (l) => formatInteger(l.ok) },
                { rotulo: "Sem mínimo", valor: (l) => formatInteger(l.semMinimo) },
              ]}
              linhas={porCategoria}
              chave={(l) => l.categoria}
            />
          )}
        </Grafico>

        <Grafico titulo="Onde está o valor em estoque" subtitulo="Lotes liberados, pelo custo do lote; as categorias de maior valor.">
          {graficosIncompletos.valores ? (
            <SemDados texto="Valor por categoria indisponível nesta leitura." />
          ) : montado && valores.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={valores} layout="vertical" maxBarSize={22} margin={{ top: 8, left: 8, right: 16, bottom: 22 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" fontSize={11} tickLine={MARCA_EIXO} axisLine={LINHA_EIXO} tickFormatter={(v: number) => formatCompactCurrency(v)} label={tituloEixoX("Valor em estoque (R$)")} />
                <YAxis type="category" dataKey="categoria" width={140} fontSize={11} tickLine={MARCA_EIXO} axisLine={LINHA_EIXO} label={tituloEixoY("Categoria")} />
                <Tooltip cursor={{ fill: "rgba(148, 163, 184, 0.12)" }} formatter={(v) => formatCurrency(Number(v))} />
                <Bar dataKey="valor" name="Valor" fill={COR.valor} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <SemDados texto="Sem valor de estoque com custo nos lotes" />
          )}
          {!graficosIncompletos.valores && (
            <TabelaDoGrafico
              titulo="Valor em estoque por categoria"
              colunas={[
                { rotulo: "Categoria", valor: (l) => l.categoria },
                { rotulo: "Valor", valor: (l) => formatCurrency(l.valor) },
              ]}
              linhas={valores}
              chave={(l) => l.categoria}
            />
          )}
        </Grafico>

        <Grafico titulo="Entradas e saídas por mês" subtitulo="Registros nos últimos 12 meses (cada insumo tem sua unidade, então conta registros).">
          {graficosIncompletos.movimentos ? (
            <SemDados texto="Histórico indisponível. A leitura de movimentos ou insumos está incompleta." />
          ) : montado && temMovimento ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={movimentosMes} maxBarSize={16} margin={{ top: 4, right: 8, left: 4, bottom: 22 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="rotulo" fontSize={11} tickLine={MARCA_EIXO} axisLine={LINHA_EIXO} label={tituloEixoX("Mês")} />
                <YAxis allowDecimals={false} fontSize={12} tickLine={MARCA_EIXO} axisLine={LINHA_EIXO} width={52} label={tituloEixoY("Registros")} />
                <Tooltip cursor={{ fill: "rgba(148, 163, 184, 0.12)" }} />
                <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="entradas" name="Entradas" fill={COR.entradas} radius={[4, 4, 0, 0]} />
                <Bar dataKey="saidas" name="Saídas" fill={COR.saidas} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <SemDados texto="Sem entradas ou saídas nos últimos 12 meses" />
          )}
          {!graficosIncompletos.movimentos && temMovimento && (
            <TabelaDoGrafico
              titulo="Entradas e saídas por mês"
              colunas={[
                { rotulo: "Mês", valor: (l) => l.rotulo },
                { rotulo: "Entradas", valor: (l) => formatInteger(l.entradas) },
                { rotulo: "Saídas", valor: (l) => formatInteger(l.saidas) },
              ]}
              linhas={movimentosMes}
              chave={(l) => l.rotulo}
            />
          )}
        </Grafico>
      </div>
      )}

      {mostrar === "quadros" && (
        <p className="text-center text-sm text-muted-foreground">
          A lista completa dos insumos, com busca e edição, fica em{" "}
          <Link href="/cadastros/insumos" className="font-medium text-primary hover:underline">
            Cadastros → Insumos
          </Link>
          .
        </p>
      )}
    </section>
  );
}

function QuadroAlerta({ alerta }: { alerta: Alerta }) {
  const [aberto, setAberto] = useState(false);
  const tom = TOM_ALERTA[alerta.tom];
  const mostrados = aberto ? alerta.itens : alerta.itens.slice(0, ITENS_POR_ALERTA);
  const tituloId = `alerta-${alerta.chave}`;
  return (
    <section aria-labelledby={tituloId} className={cn("flex min-w-0 flex-col rounded-lg border border-l-4 border-border bg-card shadow-sm", tom.borda)}>
      <div className="flex items-start justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          <h3 id={tituloId} className="text-sm font-semibold">
            {alerta.titulo}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{alerta.descricao}</p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold tabular-nums", tom.selo)} title={tom.rotulo}>
          {formatInteger(alerta.itens.length)}
        </span>
      </div>
      <ul className="mt-2 flex-1 divide-y divide-border text-sm">
        {mostrados.map((item) => (
          <li key={item.chave} className="px-4 py-1.5">
            <Link href={item.href} className="block truncate font-medium hover:text-primary hover:underline">
              {item.titulo}
            </Link>
            <span className="block break-words text-xs text-muted-foreground">
              {item.detalhe}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs">
        {alerta.itens.length > ITENS_POR_ALERTA ? (
          <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} className="font-medium text-primary hover:underline">
            {aberto ? "Mostrar menos" : `Ver todos (${formatInteger(alerta.itens.length)})`}
          </button>
        ) : (
          <span />
        )}
        {alerta.acao ? (
          <Link href={alerta.acao.href} className="font-medium text-primary hover:underline">
            {alerta.acao.rotulo} →
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function Grafico({ titulo, subtitulo, children }: { titulo: string; subtitulo: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-4 shadow-sm">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      <p className="text-xs text-muted-foreground">{subtitulo}</p>
      <div className="mt-3 h-60 min-w-0">{children}</div>
    </section>
  );
}

function SemDados({ texto }: { texto: string }) {
  return <div className="flex h-full items-center justify-center rounded-md bg-muted/50 px-3 text-center text-xs text-muted-foreground">{texto}</div>;
}
