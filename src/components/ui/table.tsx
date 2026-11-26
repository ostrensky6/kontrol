import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Tabela padrão do Kontrol: é a única tabela do app (auditoria de 16/11, item 9).
 * Tela nenhuma escreve `<table>` à mão. A exceção (documento impresso com
 * desenho de papel, tabela que vira cartão no celular) declara o motivo num
 * comentário logo acima: `tabela-fora-do-padrao: motivo`. A guarda está em
 * src/config/padrao-visual.test.ts.
 *
 * `densidade="compacta"` baixa as linhas (tabela de conferência, tabela dentro
 * de diálogo), `rente` encosta a primeira e a última coluna na moldura e
 * `grade` desenha a ficha com linha em volta de cada célula. As células leem
 * as medidas daqui; classe posta na própria célula continua valendo.
 *
 * As células ficam centradas na altura da linha porque herdam o alinhamento:
 * `align-top` na linha (`TableRow`) alinha a linha inteira pelo topo. Recuo
 * próprio na primeira coluna pede `first:pl-…` (e `last:pr-…` na última),
 * senão a margem padrão da borda prevalece.
 */
type TableProps = React.ComponentProps<"table"> & {
  densidade?: "normal" | "compacta";
  /** Primeira e última coluna rentes à moldura (tabela dentro de um quadro que já tem margem). */
  rente?: boolean;
  /** Ficha em grade: largura do conteúdo, centrada, com linha em volta de cada célula (fichas de análise). */
  grade?: boolean;
};

const GRADE =
  "mx-auto w-auto border border-foreground/70 text-xs [--tabela-borda:0.625rem] [--tabela-px:0.625rem] [--tabela-py:0.375rem] [--tabela-th:auto] " +
  "[&_td]:border [&_td]:border-foreground/60 [&_th]:border [&_th]:border-foreground/60 " +
  "[&_thead]:bg-transparent [&_thead_th]:whitespace-nowrap [&_thead_th]:bg-muted/45 [&_thead_th]:py-2 [&_thead_th]:text-center [&_thead_th]:font-bold [&_thead_th]:text-foreground";

function Table({ className, densidade = "normal", rente = false, grade = false, ...props }: TableProps) {
  return (
    <table
      data-densidade={densidade}
      className={cn(
        "w-full caption-bottom text-sm",
        densidade === "compacta" && "[--tabela-py:0.375rem] [--tabela-th:2rem]",
        rente && "[--tabela-borda:0px]",
        grade && GRADE,
        className,
      )}
      {...props}
    />
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  // faixa clara igual em todas as tabelas (rodada 10): antes umas tinham e outras não
  return <thead className={cn("bg-muted/60 [&_tr]:border-b [&_tr]:border-border [&_tr]:hover:bg-transparent", className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      className={cn("border-t border-border bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn("border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted", className)}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        // títulos de coluna em frase normal: maiúsculas só em siglas (revisão de 11/11, 10.4)
        "h-[var(--tabela-th,2.5rem)] px-[var(--tabela-px,0.75rem)] text-left text-xs font-medium leading-tight text-muted-foreground [text-wrap:balance] first:pl-[var(--tabela-borda,1rem)] last:pr-[var(--tabela-borda,1rem)] [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      className={cn(
        "px-[var(--tabela-px,0.75rem)] py-[var(--tabela-py,0.625rem)] first:pl-[var(--tabela-borda,1rem)] last:pr-[var(--tabela-borda,1rem)] [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

/** Título da linha (`<th scope="row">`): papel de cabeçalho, aparência de célula. */
function TableRowHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      scope="row"
      className={cn(
        "px-[var(--tabela-px,0.75rem)] py-[var(--tabela-py,0.625rem)] text-left font-normal first:pl-[var(--tabela-borda,1rem)] last:pr-[var(--tabela-borda,1rem)]",
        className,
      )}
      {...props}
    />
  );
}

export {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHead,
};
