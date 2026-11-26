"use client";

import * as React from "react";
import { Check, type LucideIcon } from "lucide-react";

import { MarcaObrigatorio } from "@/components/common/Campo";
import { cn } from "@/lib/utils";

export type OpcaoEscolha<T extends string = string> = {
  valor: T;
  rotulo: string;
  /** ícone do cartão (só na variante "cartao") */
  icone?: LucideIcon;
  /** uma linha curta embaixo do rótulo (só na variante "cartao") */
  detalhe?: string;
};

/**
 * Escolha visual: as opções ficam à vista como cartões (com ícone) ou pílulas,
 * no lugar de uma lista suspensa. Cada opção é um rádio de verdade, então o
 * formulário envia `name` igual a um <select>, o teclado anda com as setas e o
 * leitor de tela anuncia "botão de opção, 2 de 5".
 *
 * Use quando há até ~12 opções fixas; listas longas ou que vêm do cadastro
 * continuam em lista suspensa ou busca.
 */
export function EscolhaCartoes<T extends string>({
  name,
  legenda,
  opcoes,
  valor,
  valorInicial,
  aoMudar,
  obrigatorio = false,
  variante = "pilula",
  colunas,
  ajuda,
  className,
  id,
  empilhado = false,
  compacto = false,
}: {
  name?: string;
  legenda: string;
  opcoes: readonly OpcaoEscolha<T>[];
  /** controlado */
  valor?: T | "";
  /** não controlado */
  valorInicial?: T | "";
  aoMudar?: (valor: T) => void;
  obrigatorio?: boolean;
  variante?: "cartao" | "pilula";
  /** colunas da grade dos cartões em telas largas (padrão: 3) */
  colunas?: 2 | 3 | 4;
  /** um <HelpTip> ao lado da legenda */
  ajuda?: React.ReactNode;
  className?: string;
  id?: string;
  /** cartão com o ícone em cima do rótulo, para colunas estreitas (no celular, onde o cartão ocupa a linha inteira, o ícone fica ao lado) */
  empilhado?: boolean;
  /** pílulas menores, para caber numa coluna estreita */
  compacto?: boolean;
}) {
  const geradoId = React.useId();
  const base = id ?? geradoId;
  const legendaId = `${base}-legenda`;

  const grade =
    colunas === 2
      ? "sm:grid-cols-2"
      : colunas === 4
        ? "sm:grid-cols-2 lg:grid-cols-4"
        : "sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div className={cn("min-w-0", className)} data-escolha-cartoes="">
      <div className="mb-1.5 flex items-center gap-1">
        <span id={legendaId} className="text-xs font-medium text-muted-foreground">
          {legenda}
          {obrigatorio && <MarcaObrigatorio />}
        </span>
        {ajuda}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={legendaId}
        aria-required={obrigatorio || undefined}
        className={cn(
                    variante === "cartao" ? cn("grid grid-cols-1 gap-2", grade) : "flex flex-wrap gap-1.5",
        )}
      >
        {opcoes.map((opcao, indice) => {
          const Icone = opcao.icone;
          const inputId = `${base}-${indice}`;
          // o visual segue o rádio marcado por CSS (has-[:checked]), então
          // funciona controlado ou não, e o reset() do formulário volta o desenho
          const controle =
            valor !== undefined
              ? { checked: valor === opcao.valor, onChange: () => aoMudar?.(opcao.valor) }
              : { defaultChecked: valorInicial === opcao.valor, onChange: () => aoMudar?.(opcao.valor) };
          return (
            <label
              key={opcao.valor}
              htmlFor={inputId}
              data-opcao={opcao.valor}
              className={cn(
                "group relative cursor-pointer select-none border border-border bg-card text-foreground transition-colors",
                "hover:border-primary/50 hover:bg-primary/[0.04]",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-1",
                variante === "cartao"
                  ? (empilhado ? "flex min-h-12 items-center gap-2.5 rounded-lg p-2.5 pr-7 sm:flex-col sm:items-start sm:gap-1.5 sm:pr-6 " : "flex min-h-12 items-center gap-2.5 rounded-lg py-2 pl-2.5 pr-7 ") + "has-[:checked]:border-primary has-[:checked]:bg-primary/[0.07] has-[:checked]:shadow-xs has-[:checked]:ring-1 has-[:checked]:ring-primary"
                  : (compacto ? "inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium " : "inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-sm font-medium ") + "has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground",
              )}
            >
              <input
                id={inputId}
                type="radio"
                name={name ?? base}
                value={opcao.valor}
                required={obrigatorio}
                {...controle}
                className="sr-only"
              />
              {variante === "cartao" && Icone && (
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:text-primary group-has-[:checked]:bg-primary group-has-[:checked]:text-primary-foreground"
                >
                  <Icone className="h-4 w-4" />
                </span>
              )}
              {variante === "pilula" && (
                <Check aria-hidden className="hidden h-3.5 w-3.5 group-has-[:checked]:inline" />
              )}
              <span className="min-w-0">
                <span className={cn("block leading-snug", variante === "cartao" && "text-sm font-medium")}>
                  {opcao.rotulo}
                </span>
                {variante === "cartao" && opcao.detalhe && (
                  <span className="block text-xs leading-snug text-muted-foreground">{opcao.detalhe}</span>
                )}
              </span>
              {variante === "cartao" && (
                <Check aria-hidden className="absolute right-2 top-2 hidden h-4 w-4 text-primary group-has-[:checked]:block" />
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
