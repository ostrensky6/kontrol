"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { formatCurrency as brl } from "@/lib/formatters";
import {
  ROTULO_TIPO_OPERACIONAL,
  type GrupoCustoId,
  type GrupoInterno,
  type LinhaFundo,
  type VisaoInterna,
} from "@/lib/orcamento/visao-interna";
import { EditorPercentuais, type EdicaoPercentuais } from "./EditorPercentuais";
import { TabelaFundos, TabelaItens, TabelaOperacionais, pct } from "./tabelas";

type SubAba = "resumo" | GrupoCustoId | "operacionais" | "fundos";

export type FundosPainel = {
  linhas: LinhaFundo[];
  percentualRecebido: number | null;
  hrefFundos: string;
};

/**
 * Modo interno (28/09): quadro de totais fixo (custos efetivos × operacionais)
 * e subabas — Resumo, uma por rubrica com itens, impostos/taxas/margem, fundos.
 */
export function PainelInterno({
  visao,
  fundos,
  subInicial,
  percentuais,
  motivoSemPercentuais,
}: {
  visao: VisaoInterna;
  fundos: FundosPainel;
  subInicial?: string | null;
  /** ausente = sem permissão ou versão que não aceita alteração */
  percentuais?: EdicaoPercentuais | null;
  motivoSemPercentuais?: string | null;
}) {
  const temFundos = fundos.linhas.some((l) => l.previsto > 0) || fundos.percentualRecebido != null;
  const abas = useMemo(() => {
    const lista: Array<{ id: SubAba; rotulo: string }> = [{ id: "resumo", rotulo: "Resumo" }];
    for (const g of visao.grupos) lista.push({ id: g.id, rotulo: rotuloAba(g) });
    lista.push({ id: "operacionais", rotulo: "Impostos, taxas e margem" });
    if (temFundos) lista.push({ id: "fundos", rotulo: "Fundos" });
    return lista;
  }, [visao.grupos, temFundos]);
  const inicial = abas.find((a) => a.id === subInicial)?.id ?? "resumo";
  const [aba, setAba] = useState<SubAba>(inicial);
  const [editando, setEditando] = useState(false);
  const [busca, setBusca] = useState("");

  function abrir(id: SubAba) {
    setAba(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("sub", id);
      window.history.replaceState(null, "", url);
    } catch {
      // só conveniência: a aba continua trocando sem a URL
    }
  }

  const gruposFiltrados = useMemo(() => filtrar(visao.grupos, busca), [visao.grupos, busca]);
  const grupoAtivo = visao.grupos.find((g) => g.id === aba);
  const operacionaisVisiveis = visao.operacionais.filter((o) => o.percentualInformado > 0 || o.valorLimpo > 0);
  const percentual = (valor: number) => (visao.total > 0 ? (valor / visao.total) * 100 : 0);

  return (
    <div className="space-y-3">
      <section aria-label="Totais da proposta" className="rounded-lg border border-border bg-muted/30 p-3">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <CabecalhoColuna titulo="Custos efetivos" valor={visao.custosEfetivos} percentual={percentual(visao.custosEfetivos)} />
            {visao.grupos.length === 0 && <p className="px-1.5 py-1 text-sm text-muted-foreground">Nenhum custo lançado.</p>}
            {visao.grupos.map((g) => (
              <LinhaQuadro
                key={g.id}
                ativa={aba === g.id}
                onClick={() => abrir(g.id)}
                rotulo={g.rotulo}
                valor={g.custoTotal}
                detalhe={pct(Math.round(g.percentualDoTotal * 10) / 10)}
              />
            ))}
          </div>
          <div>
            <CabecalhoColuna
              titulo="Custos operacionais"
              valor={visao.custosOperacionais}
              percentual={percentual(visao.custosOperacionais)}
              acao={
                percentuais && !editando ? (
                  <button type="button" onClick={() => setEditando(true)} className="text-xs font-medium text-primary hover:underline">
                    Alterar percentuais
                  </button>
                ) : null
              }
            />
            {operacionaisVisiveis.length === 0 && (
              <p className="px-1.5 py-1 text-sm text-muted-foreground">Sem impostos, taxas, fundos nem margem.</p>
            )}
            {operacionaisVisiveis.map((o) => (
              <LinhaQuadro
                key={o.chave}
                ativa={aba === (o.tipo === "fundo" && temFundos ? "fundos" : "operacionais")}
                onClick={() => abrir(o.tipo === "fundo" && temFundos ? "fundos" : "operacionais")}
                rotulo={
                  <>
                    <span className="mr-1 text-[11px] text-muted-foreground">{ROTULO_TIPO_OPERACIONAL[o.tipo]}</span>
                    {o.rotulo} {pct(o.percentualInformado)}
                  </>
                }
                valor={o.valorLimpo}
              />
            ))}
          </div>
        </div>
        <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
          <span className="text-sm font-semibold text-brand-800 dark:text-brand-200">Total da proposta</span>
          <span className="text-xl font-semibold tabular-nums text-brand-800 dark:text-brand-200">{brl(visao.total)}</span>
        </div>
      </section>

      {editando && percentuais && (
        <EditorPercentuais edicao={percentuais} totalAtual={visao.total} onCancelar={() => setEditando(false)} />
      )}
      {!percentuais && motivoSemPercentuais && (
        <p className="text-xs text-muted-foreground">{motivoSemPercentuais}</p>
      )}

      <div role="tablist" aria-label="Detalhamento" className="flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]">
        {abas.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={aba === a.id}
            onClick={() => abrir(a.id)}
            className={`whitespace-nowrap border-b-2 px-3 py-1.5 text-sm transition-colors ${
              aba === a.id
                ? "border-brand-600 font-medium text-brand-800 dark:border-brand-400 dark:text-brand-200"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {aba === "resumo" && (
          <div className="space-y-2">
            {visao.grupos.length > 0 && (
              <div className="relative max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar item"
                  aria-label="Buscar item"
                  className="h-8 pl-8 text-sm"
                />
              </div>
            )}
            {gruposFiltrados.length > 0 ? (
              <TabelaItens grupos={gruposFiltrados} agrupar />
            ) : (
              <p className="py-4 text-sm text-muted-foreground">
                {busca ? "Nenhum item com esse texto." : "Nenhum custo lançado."}
              </p>
            )}
          </div>
        )}
        {grupoAtivo && <TabelaItens grupos={[grupoAtivo]} agrupar={false} />}
        {aba === "operacionais" && <TabelaOperacionais visao={visao} />}
        {aba === "fundos" && (
          <TabelaFundos linhas={fundos.linhas} percentualRecebido={fundos.percentualRecebido} hrefFundos={fundos.hrefFundos} />
        )}
      </div>
    </div>
  );
}

function rotuloAba(g: GrupoInterno) {
  return g.id === "laboratorio" || g.id === "analises_projeto" ? g.rotulo : g.rotulo.replace(" · ", " ");
}

function filtrar(grupos: GrupoInterno[], busca: string) {
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  if (!termo) return grupos;
  return grupos
    .map((g) => ({
      ...g,
      itens: g.itens.filter((i) =>
        [i.descricao, i.codigo, i.detalhe].some((t) => t?.toLocaleLowerCase("pt-BR").includes(termo)),
      ),
    }))
    .filter((g) => g.itens.length > 0);
}

function CabecalhoColuna({
  titulo,
  valor,
  percentual,
  acao,
}: {
  titulo: string;
  valor: number;
  percentual: number;
  acao?: React.ReactNode;
}) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-2 border-b border-border px-1.5 pb-1">
      <span className="flex items-baseline gap-2 text-sm font-semibold">
        {titulo}
        {acao}
      </span>
      <span className="text-sm font-semibold tabular-nums">
        {brl(valor)} <span className="text-xs font-normal text-muted-foreground">{pct(Math.round(percentual * 10) / 10)}</span>
      </span>
    </div>
  );
}

function LinhaQuadro({
  rotulo,
  valor,
  detalhe,
  ativa,
  onClick,
}: {
  rotulo: React.ReactNode;
  valor: number;
  detalhe?: string;
  ativa: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-baseline justify-between gap-2 rounded px-1.5 py-0.5 text-left text-sm hover:bg-background ${
        ativa ? "bg-background font-medium" : ""
      }`}
    >
      <span className="min-w-0 truncate">{rotulo}</span>
      <span className="shrink-0 tabular-nums">
        {brl(valor)}
        {detalhe && <span className="ml-1 text-xs text-muted-foreground">{detalhe}</span>}
      </span>
    </button>
  );
}
