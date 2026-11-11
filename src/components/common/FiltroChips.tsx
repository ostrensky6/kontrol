"use client";

import { cn } from "@/lib/utils";

export type OpcaoChip<T extends string> = {
  valor: T;
  rotulo: string;
  contagem?: number;
  /** destaca a contagem quando há algo a tratar */
  tom?: "red" | "amber" | "neutro";
};

/** Botões de filtro com contagem (um só ativo), usados nas listas de Compras e do Estoque. */
export function FiltroChips<T extends string>({
  opcoes,
  valor,
  aoMudar,
  rotulo,
  className,
}: {
  opcoes: readonly OpcaoChip<T>[];
  valor: T;
  aoMudar: (valor: T) => void;
  rotulo: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={rotulo} className={cn("flex flex-wrap gap-2", className)}>
      {opcoes.map((opcao) => {
        const ativo = opcao.valor === valor;
        const destaque = !ativo && (opcao.contagem ?? 0) > 0 && opcao.tom && opcao.tom !== "neutro";
        return (
          <button
            key={opcao.valor}
            type="button"
            aria-pressed={ativo}
            onClick={() => aoMudar(opcao.valor)}
            className={cn(
              "inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors",
              ativo
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-primary/5",
            )}
          >
            {opcao.rotulo}
            {opcao.contagem != null && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs tabular-nums",
                  ativo
                    ? "bg-primary-foreground/20"
                    : destaque && opcao.tom === "red"
                      ? "bg-danger-soft text-danger-strong"
                      : destaque
                        ? "bg-warning-soft text-warning-strong"
                        : "bg-muted text-muted-foreground",
                )}
              >
                {opcao.contagem}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export type OpcaoCartao<T extends string> = OpcaoChip<T> & {
  /** uma linha curta dizendo o que o filtro mostra */
  descricao?: string;
};

/**
 * Filtro em cartões com contagem (um só ativo): o usuário escolhe o que quer
 * ver antes de a lista aparecer. O nome acessível de cada cartão começa pelo
 * rótulo, como nos botões de FiltroChips.
 */
export function FiltroCartoes<T extends string>({
  opcoes,
  valor,
  aoMudar,
  rotulo,
  className,
}: {
  opcoes: readonly OpcaoCartao<T>[];
  valor: T;
  aoMudar: (valor: T) => void;
  rotulo: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={rotulo}
      className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6", className)}
    >
      {opcoes.map((opcao) => {
        const ativo = opcao.valor === valor;
        const contagem = opcao.contagem ?? 0;
        const destaque = contagem > 0 && opcao.tom && opcao.tom !== "neutro";
        return (
          <button
            key={opcao.valor}
            type="button"
            aria-pressed={ativo}
            onClick={() => aoMudar(opcao.valor)}
            className={cn(
              "flex min-h-[4.5rem] flex-col justify-between gap-1 rounded-lg border p-3 text-left transition-colors",
              ativo
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border bg-card hover:border-primary/50 hover:bg-primary/5",
            )}
          >
            <span className="flex items-start justify-between gap-2">
              <span className={cn("text-sm font-medium leading-5", ativo ? "text-primary" : "text-foreground")}>
                {opcao.rotulo}
              </span>
              {opcao.contagem != null && (
                <span
                  className={cn(
                    "text-xl font-semibold leading-6 tabular-nums",
                    destaque && opcao.tom === "red"
                      ? "text-danger-strong"
                      : destaque
                        ? "text-warning-strong"
                        : contagem > 0
                          ? "text-foreground"
                          : "text-muted-foreground",
                  )}
                >
                  {opcao.contagem}
                </span>
              )}
            </span>
            {opcao.descricao && (
              <span className="hidden text-xs leading-4 text-muted-foreground sm:block">{opcao.descricao}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Guarda o filtro na URL (sem recarregar a página), para o link e o voltar do navegador. */
export function gravarFiltroNaUrl(chave: string, valor: string, padrao: string) {
  try {
    const url = new URL(window.location.href);
    if (valor === padrao) url.searchParams.delete(chave);
    else url.searchParams.set(chave, valor);
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    // sem history (ambiente restrito): o filtro continua valendo na tela
  }
}
