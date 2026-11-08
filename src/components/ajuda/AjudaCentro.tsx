"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Search } from "lucide-react";

import { AJUDA_GRUPOS, AJUDA_TOPICOS, topicoCasa } from "@/lib/ajuda/topics";

export function AjudaCentro() {
  const [busca, setBusca] = useState("");
  const [selecionadoId, setSelecionadoId] = useState<string>(AJUDA_TOPICOS[0].id);
  // Em telas pequenas, alterna entre a lista e o conteúdo.
  const [mostrarDetalheMobile, setMostrarDetalheMobile] = useState(false);

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
    setMostrarDetalheMobile(true);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[19rem_1fr]">
      {/* Lista navegável */}
      <aside className={`${mostrarDetalheMobile ? "hidden lg:block" : "block"} lg:sticky lg:top-6 lg:self-start`}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/80" />
          <input
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar ajuda..."
            className="w-full rounded-lg border border-input bg-card py-2.5 pl-10 pr-3 text-sm shadow-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-950"
          />
        </div>

        <nav className="mt-4 max-h-[70vh] space-y-5 overflow-y-auto pr-1">
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
                        className={`w-full rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
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
              onClick={() => setMostrarDetalheMobile(false)}
              className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline lg:hidden"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Voltar à lista
            </button>

            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-500">
                  {selecionado.grupo}
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">{selecionado.titulo}</h2>
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

            <p className="mt-5 max-w-3xl text-sm leading-7 text-foreground">
              {selecionado.intro}
            </p>

            <div className="mt-6 space-y-6">
              {selecionado.secoes.map((secao) => (
                <div key={secao.titulo}>
                  <h3 className="text-sm font-semibold text-foreground">{secao.titulo}</h3>
                  <ul className="mt-2 space-y-2">
                    {secao.itens.map((item, index) => (
                      <li key={index} className="flex gap-2.5 text-sm leading-6 text-foreground">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
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
