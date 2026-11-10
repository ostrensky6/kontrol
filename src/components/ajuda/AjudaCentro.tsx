"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  CircleCheck,
  ListOrdered,
  Search,
  Target,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { gravarFiltroNaUrl } from "@/components/common/FiltroChips";
import { ancoraDaSecao, tipoDaSecao, type TipoSecaoAjuda } from "@/lib/ajuda/secao";
import { AJUDA_GRUPOS, AJUDA_TOPICOS, topicoCasa, type AjudaTopico } from "@/lib/ajuda/topics";
import { cn } from "@/lib/utils";

const ICONE_SECAO: Record<TipoSecaoAjuda, LucideIcon> = {
  passos: ListOrdered,
  praticas: CircleCheck,
  atencao: TriangleAlert,
  serve: Target,
  info: BookOpen,
};

/** Seção que já abre sozinha: para que serve, passo a passo e cuidados. O resto abre com um clique. */
function abertaDeInicio(topico: AjudaTopico) {
  return new Set(
    topico.secoes.flatMap((secao, index) => {
      const tipo = tipoDaSecao(secao.titulo);
      return topico.secoes.length <= 3 || tipo === "serve" || tipo === "passos" || tipo === "atencao" ? [index] : [];
    }),
  );
}

/** Uma seção do tópico em cartão que abre e fecha: passos numerados, cuidados em destaque, o resto em lista. */
function SecaoAjuda({
  id,
  titulo,
  itens,
  aberta,
  aoAlternar,
}: {
  id: string;
  titulo: string;
  itens: string[];
  aberta: boolean;
  aoAlternar: () => void;
}) {
  const tipo = tipoDaSecao(titulo);
  const Icone = ICONE_SECAO[tipo];
  const tituloId = `${id}-titulo`;
  const corpoId = `${id}-corpo`;
  return (
    <section
      id={id}
      aria-labelledby={tituloId}
      className={cn(
        "scroll-mt-20 rounded-lg border",
        tipo === "atencao" ? "border-warning-strong/30 bg-warning-soft/40" : "border-border bg-background/60",
      )}
    >
      <h3 id={tituloId} className="text-sm font-semibold text-foreground">
        <button
          type="button"
          aria-expanded={aberta}
          aria-controls={corpoId}
          onClick={aoAlternar}
          className="flex min-h-11 w-full items-center gap-2 rounded-lg px-4 py-2 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icone
            aria-hidden
            className={cn("h-4 w-4 shrink-0", tipo === "atencao" ? "text-warning-strong" : "text-brand-600 dark:text-brand-300")}
          />
          <span className="flex-1">{titulo}</span>
          <span aria-hidden className="text-xs font-normal tabular-nums text-muted-foreground">
            {itens.length}
          </span>
          <ChevronDown aria-hidden className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", aberta && "rotate-180")} />
        </button>
      </h3>
      <div id={corpoId} hidden={!aberta} className="px-4 pb-4">
        {tipo === "passos" ? (
          <ol className="space-y-2.5">
            {itens.map((item, index) => (
              <li key={index} className="flex gap-3 text-sm leading-6 text-foreground">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[11px] font-semibold text-white"
                >
                  {index + 1}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        ) : (
          <ul className="space-y-2">
            {itens.map((item, index) => (
              <li key={index} className="flex gap-2.5 text-sm leading-6 text-foreground">
                {tipo === "praticas" ? (
                  <CircleCheck aria-hidden className="mt-1 h-4 w-4 shrink-0 text-success-strong" />
                ) : (
                  <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                )}
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Índice "Nesta página" e as seções do tópico. Com busca ativa, tudo abre para o termo aparecer. */
function SecoesDoTopico({ topico, tudoAberto }: { topico: AjudaTopico; tudoAberto: boolean }) {
  const [abertas, setAbertas] = useState<Set<number>>(() => abertaDeInicio(topico));
  const todas = tudoAberto || abertas.size === topico.secoes.length;

  function alternar(index: number) {
    setAbertas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(index)) proximo.delete(index);
      else proximo.add(index);
      return proximo;
    });
  }

  return (
    <>
      {topico.secoes.length > 2 && (
        <nav aria-label="Nesta página" className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Nesta página:</span>
          {topico.secoes.map((secao, index) => (
            <a
              key={secao.titulo}
              href={`#${ancoraDaSecao(topico.id, index)}`}
              onClick={() => setAbertas((atual) => new Set(atual).add(index))}
              className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground hover:border-primary/50 hover:bg-primary/5 lg:min-h-8"
            >
              {secao.titulo}
            </a>
          ))}
          {!tudoAberto && (
            <button
              type="button"
              onClick={() => setAbertas(todas ? new Set() : new Set(topico.secoes.map((_, index) => index)))}
              className="ml-auto inline-flex min-h-11 items-center px-1 text-xs font-medium text-primary hover:underline lg:min-h-8"
            >
              {todas ? "Fechar tudo" : "Abrir tudo"}
            </button>
          )}
        </nav>
      )}

      <div className="mt-5 max-w-3xl space-y-3">
        {topico.secoes.map((secao, index) => (
          <SecaoAjuda
            key={secao.titulo}
            id={ancoraDaSecao(topico.id, index)}
            titulo={secao.titulo}
            itens={secao.itens}
            aberta={tudoAberto || abertas.has(index)}
            aoAlternar={() => alternar(index)}
          />
        ))}
      </div>
    </>
  );
}

export function AjudaCentro({ topicoInicial }: { topicoInicial?: string }) {
  const [busca, setBusca] = useState("");
  const [selecionadoId, setSelecionadoId] = useState<string>(topicoInicial ?? AJUDA_TOPICOS[0].id);
  // Em telas pequenas, alterna entre a lista e o conteúdo. Quem chega por link direto já vê o tópico.
  const [mostrarDetalheMobile, setMostrarDetalheMobile] = useState(Boolean(topicoInicial));
  // Para onde o foco vai depois de escolher um tópico ou voltar à lista.
  const focoAlvo = useRef<"titulo" | "lista" | null>(null);
  const [pedidoFoco, setPedidoFoco] = useState(0);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const listaRef = useRef<HTMLElement>(null);

  const filtrados = useMemo(
    () => AJUDA_TOPICOS.filter((topico) => topicoCasa(topico, busca)),
    [busca],
  );

  const porGrupo = useMemo(
    () =>
      AJUDA_GRUPOS.map((grupo) => ({
        grupo,
        topicos: filtrados.filter((topico) => topico.grupo === grupo),
      })).filter((bloco) => bloco.topicos.length > 0),
    [filtrados],
  );

  // Garante que o selecionado esteja entre os resultados; senão, cai no primeiro.
  const selecionado =
    filtrados.find((topico) => topico.id === selecionadoId) ?? filtrados[0] ?? null;

  function escolher(id: string) {
    setSelecionadoId(id);
    gravarFiltroNaUrl("topico", id, "");
    setMostrarDetalheMobile(true);
    focoAlvo.current = "titulo";
    setPedidoFoco((n) => n + 1);
  }

  function voltarParaLista() {
    setMostrarDetalheMobile(false);
    focoAlvo.current = "lista";
    setPedidoFoco((n) => n + 1);
  }

  // Leva o foco ao título do tópico aberto (quem usa leitor de tela ou teclado
  // não fica perdido na lista) e, ao voltar, devolve ao tópico escolhido.
  useEffect(() => {
    const alvo = focoAlvo.current;
    focoAlvo.current = null;
    if (alvo === "titulo") tituloRef.current?.focus();
    if (alvo === "lista") {
      listaRef.current?.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus();
    }
  }, [pedidoFoco]);

  return (
    <div className="grid gap-5 lg:grid-cols-[19rem_1fr]">
      {/* Lista navegável */}
      <aside className={`${mostrarDetalheMobile ? "hidden lg:block" : "block"} lg:sticky lg:top-6 lg:self-start`}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/80" />
          <input
            type="search"
            aria-label="Buscar na ajuda"
            aria-controls="ajuda-topicos"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar ajuda..."
            className="w-full rounded-lg border border-input bg-card py-2.5 pl-10 pr-3 text-sm shadow-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-950"
          />
        </div>

        <p className="sr-only" aria-live="polite">
          {busca ? `${filtrados.length} tópico(s) encontrado(s)` : ""}
        </p>

        <nav
          id="ajuda-topicos"
          ref={listaRef}
          aria-label="Tópicos da ajuda"
          className="mt-4 max-h-[70vh] space-y-5 overflow-y-auto pr-1"
        >
          {porGrupo.length === 0 && (
            <p className="px-1 text-sm text-muted-foreground/80">Nada encontrado para “{busca}”.</p>
          )}
          {porGrupo.map((bloco) => (
            <div key={bloco.grupo}>
              <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                {bloco.grupo}
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {bloco.topicos.map((topico) => {
                  const ativo = selecionado?.id === topico.id;
                  return (
                    <li key={topico.id}>
                      <button
                        type="button"
                        onClick={() => escolher(topico.id)}
                        aria-current={ativo ? "true" : undefined}
                        className={`min-h-11 w-full rounded-md px-2.5 py-2 text-left text-sm transition-colors lg:min-h-0 ${
                          ativo
                            ? "bg-brand-50 font-medium text-brand-800 dark:bg-brand-950/40 dark:text-brand-200"
                            : "text-foreground hover:bg-muted"
                        }`}
                      >
                        {topico.titulo}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      {/* Conteúdo do tópico selecionado */}
      <section className={`${mostrarDetalheMobile ? "block" : "hidden lg:block"}`}>
        {selecionado ? (
          <article className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
            <button
              type="button"
              onClick={voltarParaLista}
              className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:underline lg:hidden"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Voltar à lista
            </button>

            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
                  {selecionado.grupo}
                </p>
                <h2 ref={tituloRef} tabIndex={-1} className="mt-1 text-xl font-semibold tracking-tight outline-none">
                  {selecionado.titulo}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{selecionado.resumo}</p>
              </div>
              {selecionado.href && (
                <Link
                  href={selecionado.href}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500"
                >
                  Abrir módulo
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              )}
            </div>

            <p className="mt-5 max-w-3xl rounded-lg bg-muted/50 px-4 py-3 text-sm leading-6 text-foreground">
              {selecionado.intro}
            </p>

            <SecoesDoTopico key={selecionado.id} topico={selecionado} tudoAberto={busca.trim() !== ""} />
          </article>
        ) : (
          <p className="rounded-2xl border border-dashed border-input px-4 py-16 text-center text-sm text-muted-foreground/80">
            Selecione um tópico na lista para ver as orientações.
          </p>
        )}
      </section>
    </div>
  );
}
