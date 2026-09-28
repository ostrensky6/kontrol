"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Linha de lista com o essencial à vista e o detalhe sob demanda: o botão
 * "Detalhes" fica na própria linha (última coluna) e o painel abre logo
 * abaixo. O painel continua montado quando fechado (`hidden`), para os
 * formulários dentro dele não perderem o que foi digitado.
 */
export function LinhaExpansivel({
  linha,
  detalhe,
  colunas,
  rotulo = "Detalhes",
}: {
  linha: ReactNode;
  detalhe: ReactNode;
  /** Template de colunas da linha no desktop; a última coluna é a do botão. */
  colunas: string;
  rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  return (
    <>
      <div className={cn("grid gap-x-4 gap-y-2 px-4 py-3 md:items-center", colunas)}>
        {linha}
        <button
          type="button"
          aria-expanded={aberto}
          aria-controls={id}
          onClick={() => setAberto((valor) => !valor)}
          className="inline-flex min-h-9 items-center gap-1 justify-self-start rounded-md px-2 text-xs font-medium text-primary hover:bg-accent md:justify-self-end"
        >
          {aberto ? "Ocultar" : rotulo}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", aberto && "rotate-180")} aria-hidden />
        </button>
      </div>
      <div id={id} hidden={!aberto} className="border-t border-border">
        {detalhe}
      </div>
    </>
  );
}
