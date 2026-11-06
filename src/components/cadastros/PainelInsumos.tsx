"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  FILTROS_PAINEL_VAZIOS,
  META_SITUACAO_PAINEL,
  filtrarLista,
  filtrarRecorte,
  movimentosPorMes,
  opcoesFiltro,
  resumirPainel,
  resumoPorCategoria,
  type FiltrosPainel,
  type InsumoPainel,
  type MovimentoPainelDb,
  type SituacaoPainel,
} from "@/lib/cadastros/painel-insumos";
import { formatInteger, formatNumber, formatPercent } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const COR = {
  ok: "#008a00",
  critico: "#b91c1c",
  semMinimo: "#94a3b8",
  entradas: "#008a00",
  saidas: "#01489d",
};

const CLASSE_SITUACAO: Record<SituacaoPainel, string> = {
  em_falta: "bg-danger-soft text-danger-strong",
  abaixo_minimo: "bg-warning-soft text-warning-strong",
  sem_minimo: "bg-muted text-muted-foreground",
  ok: "bg-success-soft text-success-strong",
};

const PAGINA = 50;

type Indicador = {
  chave: string;
  titulo: string;
  valor: string;
  detalhe?: string;
  tom: "neutro" | "verde" | "vermelho" | "ambar";
  /** clicar aplica este filtro de situação na lista */
  situacao?: string;
};

const TOM_INDICADOR: Record<Indicador["tom"], string> = {
  neutro: "border-border bg-card text-foreground",
  verde: "border-transparent bg-[#0a6b0a] text-white",
  vermelho: "border-transparent bg-[#b91c1c] text-white",
  ambar: "border-warning-strong/30 bg-warning-soft text-warning-strong",
};

export function PainelInsumos({
  insumos,
  movimentos,
  hojeIso,
  erro,
}: {
  insumos: InsumoPainel[];
  movimentos: MovimentoPainelDb[];
  hojeIso: string;
  erro?: string | null;
}) {
  const [filtros, setFiltros] = useState<FiltrosPainel>(FILTROS_PAINEL_VAZIOS);
  const [visiveis, setVisiveis] = useState(PAGINA);
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    // gráficos do recharts só no cliente (medem o contêiner)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMontado(true);
  }, []);

  const recorte = useMemo(() => filtrarRecorte(insumos, filtros), [insumos, filtros]);
  const lista = useMemo(() => filtrarLista(insumos, filtros), [insumos, filtros]);
  const resumo = useMemo(() => resumirPainel(recorte), [recorte]);
  const porCategoria = useMemo(
    () => resumoPorCategoria(recorte, filtros.categoriaCurta ? "categoriaCompra" : "categoriaCurta"),
    [recorte, filtros.categoriaCurta],
  );
  const filtrosDeSelecao = Boolean(filtros.categoriaCompra || filtros.categoriaCurta || filtros.codigoFabricante || filtros.busca);
  const movimentosMes = useMemo(
    // sempre só os insumos do painel (ativos), mesmo sem filtro
    () => movimentosPorMes(movimentos, new Set((filtrosDeSelecao ? recorte : insumos).map((item) => item.id)), hojeIso),
    [movimentos, recorte, insumos, filtrosDeSelecao, hojeIso],
  );
  const temMovimento = movimentosMes.some((mes) => mes.entradas + mes.saidas > 0);

  const opcoesCompra = useMemo(() => opcoesFiltro(insumos, filtros, "categoriaCompra"), [insumos, filtros]);
  const opcoesCurta = useMemo(() => opcoesFiltro(insumos, filtros, "categoriaCurta"), [insumos, filtros]);
  const opcoesCodigo = useMemo(() => opcoesFiltro(insumos, filtros, "codigoFabricante"), [insumos, filtros]);

  function mudar(campo: keyof FiltrosPainel, valor: string) {
    setFiltros((atual) => ({ ...atual, [campo]: valor }));
    setVisiveis(PAGINA);
  }

  const algumFiltro = filtrosDeSelecao || filtros.situacao !== "todos";

  const indicadores: Indicador[] = [
    { chave: "cadastrados", titulo: "Insumos cadastrados", valor: formatInteger(resumo.cadastrados), detalhe: "ativos no recorte", tom: "neutro", situacao: "todos" },
    { chave: "com-estoque", titulo: "Com estoque", valor: formatInteger(resumo.comEstoque), detalhe: "disponível maior que zero", tom: "neutro" },
    { chave: "acima", titulo: "Acima do mínimo", valor: formatInteger(resumo.acimaMinimo), detalhe: resumo.saude === null ? "nenhum mínimo cadastrado" : `${formatPercent(resumo.saude * 100, 0)} dos que têm mínimo`, tom: "verde", situacao: "ok" },
    { chave: "critico", titulo: "Nível crítico", valor: formatInteger(resumo.critico), detalhe: `${formatInteger(resumo.emFalta)} em falta · ${formatInteger(resumo.abaixoMinimo)} abaixo do mínimo`, tom: "vermelho", situacao: "critico" },
    { chave: "sem-minimo", titulo: "Sem mínimo definido", valor: formatInteger(resumo.semMinimo), detalhe: "completar o ponto de reposição", tom: "ambar", situacao: "sem_minimo" },
  ];

  const tituloCategoria = filtros.categoriaCurta ? "Situação por categoria de compra" : "Situação por categoria curta";

  return (
    <section aria-labelledby="painel-insumos-titulo" className="mt-4 space-y-4">
      <h2 id="painel-insumos-titulo" className="sr-only">
        Painel de insumos
      </h2>

      {erro ? (
        <p role="alert" className="rounded-md border border-danger-strong/30 bg-danger-soft px-3 py-2 text-sm text-danger-strong">
          {erro}
        </p>
      ) : null}

      <div className="grid gap-3 rounded-lg border border-border bg-card p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.3fr)]">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
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
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
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
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Código do fabricante
          <Select value={filtros.codigoFabricante} onChange={(e) => mudar("codigoFabricante", e.target.value)}>
            <option value="">Todos</option>
            {opcoesCodigo.map((valor) => (
              <option key={valor} value={valor}>
                {valor}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Situação
          <Select value={filtros.situacao} onChange={(e) => mudar("situacao", e.target.value)}>
            <option value="todos">Todas</option>
            <option value="critico">Nível crítico</option>
            <option value="em_falta">{META_SITUACAO_PAINEL.em_falta.rotulo}</option>
            <option value="abaixo_minimo">{META_SITUACAO_PAINEL.abaixo_minimo.rotulo}</option>
            <option value="ok">{META_SITUACAO_PAINEL.ok.rotulo}</option>
            <option value="sem_minimo">{META_SITUACAO_PAINEL.sem_minimo.rotulo}</option>
          </Select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Item específico
          <div className="flex gap-2">
            <Input
              type="search"
              value={filtros.busca}
              onChange={(e) => mudar("busca", e.target.value)}
              placeholder="Nome, marca ou código"
              className="h-9"
            />
            {algumFiltro ? (
              <button
                type="button"
                onClick={() => {
                  setFiltros(FILTROS_PAINEL_VAZIOS);
                  setVisiveis(PAGINA);
                }}
                className="shrink-0 rounded-md border border-input px-2 text-xs font-medium text-foreground hover:bg-muted"
              >
                Limpar
              </button>
            ) : null}
          </div>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {indicadores.map((indicador) => {
          const ativo = indicador.situacao !== undefined && indicador.situacao !== "todos" && filtros.situacao === indicador.situacao;
          const conteudo = (
            <>
              <span className="text-sm font-semibold">{indicador.titulo}</span>
              <span className="mt-1 block text-3xl font-bold sm:text-4xl tabular-nums leading-none">{indicador.valor}</span>
              {indicador.detalhe ? <span className="mt-2 block text-xs">{indicador.detalhe}</span> : null}
            </>
          );
          const classe = cn(
            "rounded-lg border p-3 text-left shadow-sm sm:p-4",
            indicador.chave === "sem-minimo" && "col-span-2 sm:col-span-1",
            TOM_INDICADOR[indicador.tom],
            ativo && "ring-2 ring-ring ring-offset-2 ring-offset-background",
          );
          return indicador.situacao !== undefined ? (
            <button
              key={indicador.chave}
              type="button"
              aria-pressed={ativo}
              onClick={() => mudar("situacao", ativo ? "todos" : indicador.situacao!)}
              className={cn(classe, "transition-opacity hover:opacity-90")}
            >
              {conteudo}
            </button>
          ) : (
            <div key={indicador.chave} className={classe}>
              {conteudo}
            </div>
          );
        })}
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <section className="min-w-0 rounded-lg border border-border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold">{tituloCategoria}</h3>
          <p className="text-xs text-muted-foreground">Quantidade de insumos; as categorias com mais itens críticos vêm primeiro.</p>
          <div className="mt-3 h-72 min-w-0">
            {montado && porCategoria.length > 0 ? (
              <ResponsiveContainer width="100%" height={288}>
                <BarChart data={porCategoria} layout="vertical" maxBarSize={28} margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="categoria" width={130} fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: "rgba(148, 163, 184, 0.12)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="critico" name="Nível crítico" stackId="s" fill={COR.critico} />
                  <Bar dataKey="ok" name="Acima do mínimo" stackId="s" fill={COR.ok} />
                  <Bar dataKey="semMinimo" name="Sem mínimo" stackId="s" fill={COR.semMinimo} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <SemDados texto="Nenhum insumo no recorte" />
            )}
          </div>
        </section>

        <section className="min-w-0 rounded-lg border border-border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold">Entradas e saídas por mês</h3>
          <p className="text-xs text-muted-foreground">Registros nos últimos 12 meses (cada insumo tem sua unidade, então conta registros, não quantidades).</p>
          <div className="mt-3 h-72 min-w-0">
            {montado && temMovimento ? (
              <ResponsiveContainer width="100%" height={288}>
                <BarChart data={movimentosMes} maxBarSize={18} margin={{ right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="rotulo" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} width={36} />
                  <Tooltip cursor={{ fill: "rgba(148, 163, 184, 0.12)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="entradas" name="Entradas" fill={COR.entradas} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="saidas" name="Saídas" fill={COR.saidas} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <SemDados texto="Sem entradas ou saídas nos últimos 12 meses" />
            )}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Lista de insumos</h3>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {formatInteger(lista.length)} {lista.length === 1 ? "insumo" : "insumos"}
            {algumFiltro ? " no filtro" : ""} · críticos primeiro
          </span>
        </div>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Item específico</th>
                <th scope="col" className="px-3 py-2 font-medium">Categoria curta</th>
                <th scope="col" className="px-3 py-2 font-medium">Categoria de compra</th>
                <th scope="col" className="px-3 py-2 font-medium">Fabricante · código</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Disponível</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Mínimo</th>
                <th scope="col" className="px-3 py-2 font-medium">Situação</th>
                <th scope="col" className="relative px-4 py-2 text-right font-medium">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lista.slice(0, visiveis).map((item) => (
                <tr key={item.id} className="border-t border-border align-top hover:bg-muted/30">
                  <td className="px-4 py-2">
                    <Link href={`/cadastros/insumos?focus=${item.id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                      {item.especificacao}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <FiltroRapido valor={item.categoriaCurta} onClick={() => mudar("categoriaCurta", item.categoriaCurta)} />
                  </td>
                  <td className="px-3 py-2">
                    <FiltroRapido valor={item.categoriaCompra} onClick={() => mudar("categoriaCompra", item.categoriaCompra)} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {item.fabricante || "—"}
                    {item.codigoFabricante ? (
                      <>
                        {" · "}
                        <FiltroRapido valor={item.codigoFabricante} onClick={() => mudar("codigoFabricante", item.codigoFabricante)} />
                      </>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatNumber(item.disponivel)} <span className="text-xs text-muted-foreground">{item.unidade}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{item.minimo > 0 ? formatNumber(item.minimo) : "—"}</td>
                  <td className="px-3 py-2">
                    <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", CLASSE_SITUACAO[item.situacao])}>
                      {META_SITUACAO_PAINEL[item.situacao].rotulo}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-xs">
                    <Link href={`/estoque?entrada=${item.id}`} className="font-medium text-primary hover:underline">
                      + Entrada
                    </Link>
                  </td>
                </tr>
              ))}
              {lista.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhum insumo neste filtro.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {lista.length > visiveis ? (
          <div className="border-t border-border px-4 py-3 text-center">
            <button
              type="button"
              onClick={() => setVisiveis((atual) => atual + PAGINA * 2)}
              className="rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Mostrar mais ({formatInteger(lista.length - visiveis)} restantes)
            </button>
          </div>
        ) : null}
      </section>
    </section>
  );
}

function FiltroRapido({ valor, onClick }: { valor: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Filtrar por ${valor}`}
      className="text-left text-foreground underline-offset-2 hover:text-primary hover:underline"
    >
      {valor}
    </button>
  );
}

function SemDados({ texto }: { texto: string }) {
  return <div className="flex h-full items-center justify-center rounded-md bg-muted/50 text-xs text-muted-foreground">{texto}</div>;
}
