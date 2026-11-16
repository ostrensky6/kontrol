import Link from "next/link";

import { LIMITE_ENCERRADOS } from "@/lib/supabase/lista-recente";
import { cn } from "@/lib/utils";

const numero = new Intl.NumberFormat("pt-BR");

/**
 * Uma linha sob a lista dizendo que ela traz só os encerrados mais recentes,
 * com o caminho para trazer todos (e o de volta). Não aparece quando a lista
 * está completa e cabe no limite.
 */
export function ListaParcial({
  mostrados,
  total,
  oQue,
  feminino = false,
  hrefTodos,
  hrefRecentes,
  limite = LIMITE_ENCERRADOS,
  className,
}: {
  mostrados: number;
  total: number;
  /** o que a contagem conta, no plural: "pedidos concluídos ou cancelados" */
  oQue: string;
  feminino?: boolean;
  hrefTodos: string;
  /** volta para a lista curta, quando a pessoa pediu todos */
  hrefRecentes?: string;
  limite?: number;
  className?: string;
}) {
  const artigo = feminino ? "as" : "os";
  const link = "toque-texto font-medium text-primary underline underline-offset-2";
  if (mostrados < total) {
    return (
      <p role="status" className={cn("text-sm text-muted-foreground", className)}>
        Mostrando {artigo} {numero.format(mostrados)} {oQue} mais recentes, de {numero.format(total)}.{" "}
        <Link href={hrefTodos} className={link}>
          Mostrar {feminino ? "todas" : "todos"}
        </Link>
      </p>
    );
  }
  if (hrefRecentes && total > limite) {
    return (
      <p role="status" className={cn("text-sm text-muted-foreground", className)}>
        Mostrando {feminino ? "todas as" : "todos os"} {numero.format(total)} {oQue}.{" "}
        <Link href={hrefRecentes} className={link}>
          Mostrar só {artigo} mais recentes
        </Link>
      </p>
    );
  }
  return null;
}
