"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { CircleHelp } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Ajuda sob demanda: um "?" discreto ao lado do rótulo/título que abre uma
 * caixa curta. Explicações longas saem da tela e vêm para cá.
 *
 * Regras de conteúdo: 1 a 3 frases, linguagem do usuário (sem nome de tabela
 * ou jargão interno) e, quando ajudar, um exemplo curto com <HelpExample>.
 *
 * Acessibilidade: abre por clique, toque, Enter ou Espaço; Esc fecha e devolve
 * o foco ao "?" (Radix). A área de toque tem 44 px sem aumentar o ícone nem
 * deslocar o texto ao redor, e a caixa é nomeada pelo título (aria-labelledby).
 */
export function HelpTip({
  title,
  children,
  side = "top",
  align = "center",
  className,
  label,
}: {
  title: string;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  className?: string;
  /** Texto acessível do botão; padrão: "Ajuda: {title}". */
  label?: string;
}) {
  const tituloId = React.useId();
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={label ?? `Ajuda: ${title}`}
          data-help-tip=""
          className={cn(
            // botão visual de 32 px com ícone de 16 px; o ::before amplia a área
            // de toque para 44 px sem deslocar o texto ao redor
            "before:absolute before:-inset-1.5 before:rounded-full before:content-['']",
            "relative -my-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground/80 transition-colors",
            "hover:text-primary focus-visible:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "data-[state=open]:text-primary",
            className,
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <CircleHelp className="h-4 w-4" aria-hidden />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          aria-labelledby={tituloId}
          className={cn(
            "z-50 w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-popover p-3.5 text-sm text-popover-foreground shadow-lg outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          <p id={tituloId} className="flex items-center gap-1.5 font-semibold text-foreground">
            <CircleHelp className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            {title}
          </p>
          {/* alinhado à esquerda: texto justificado abre vãos e atrapalha a leitura */}
          <div className="mt-1.5 space-y-2 text-left leading-relaxed text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground [&_strong]:font-semibold [&_strong]:text-foreground">
            {children}
          </div>
          <PopoverPrimitive.Arrow className="fill-popover" width={12} height={6} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** Caixa de exemplo dentro do HelpTip. */
export function HelpExample({
  children,
  title = "Exemplo",
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="rounded-md border border-info-strong/20 bg-info-soft px-2.5 py-2 text-left text-xs leading-relaxed text-foreground">
      <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-info-strong">
        {title}
      </p>
      {children}
    </div>
  );
}

type Tom = "ok" | "atencao" | "critico" | "info" | "neutro";

const tomClasse: Record<Tom, string> = {
  ok: "bg-success-soft text-success-strong",
  atencao: "bg-warning-soft text-warning-strong",
  critico: "bg-danger-soft text-danger-strong",
  info: "bg-info-soft text-info-strong",
  neutro: "bg-muted text-foreground",
};

/** Legenda colorida: explica o significado de cada cor/estado de um gráfico ou tabela. */
export function HelpLegend({
  items,
}: {
  items: { tom: Tom; rotulo: string; texto: React.ReactNode }[];
}) {
  return (
    <ul className="space-y-1.5 text-xs">
      {items.map((item) => (
        <li key={item.rotulo} className="flex items-start gap-2">
          <span
            className={cn(
              "mt-px inline-flex shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold",
              tomClasse[item.tom],
            )}
          >
            {item.rotulo}
          </span>
          <span className="text-left text-muted-foreground">{item.texto}</span>
        </li>
      ))}
    </ul>
  );
}

/** Conta curta "a × b = c" destacada, para explicar um cálculo. */
export function HelpFormula({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs text-foreground">
      {children}
    </p>
  );
}

/** Texto simples com **negrito** (usado nas ajudas declaradas como string, ex.: campos de cadastro). */
export function TextoAjuda({ texto }: { texto: string }) {
  const partes = texto.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {partes.map((parte, i) =>
        parte.startsWith("**") && parte.endsWith("**") ? <b key={i}>{parte.slice(2, -2)}</b> : parte,
      )}
    </>
  );
}
