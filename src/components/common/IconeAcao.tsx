import type { LucideIcon } from "lucide-react";

/**
 * Conteúdo de um botão de ação em lista (pedido do dono, 28/09): só o ícone na tela,
 * o nome ao passar o mouse (title) e para o leitor de tela (sr-only). Usar como
 * `trigger` de ConfirmActionButton/CancelarComMotivo ou `children` de SubmitButton,
 * com CLASSE_BOTAO_ICONE (ou _PERIGO para arquivar, excluir e cancelar).
 *
 * Ícones do módulo: editar = Pencil, arquivar = Archive, excluir/remover = Trash2,
 * duplicar = Copy, cancelar = Ban, reativar = ArchiveRestore.
 */
export function IconeAcao({ icone: Icone, rotulo }: { icone: LucideIcon; rotulo: string }) {
  return (
    <span className="inline-flex" title={rotulo}>
      <Icone className="size-4" aria-hidden />
      <span className="sr-only">{rotulo}</span>
    </span>
  );
}

export const CLASSE_BOTAO_ICONE =
  "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";

export const CLASSE_BOTAO_ICONE_PERIGO =
  "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-danger-soft hover:text-danger-strong disabled:cursor-not-allowed disabled:opacity-50";
