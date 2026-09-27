"use client";

import type { ReactNode } from "react";
import { toast } from "sonner";

import type { EstadoAcao } from "@/lib/erros";

/** Action de formulário do editor: pode devolver a recusa em vez de lançar (item 12). */
export type AcaoFormulario = (formData: FormData) => void | Promise<void | EstadoAcao>;

/**
 * Formulário que chama uma Server Action e mostra o resultado em aviso (toast),
 * sem trocar a tela inteira pela página de erro quando a ação recusa o pedido.
 * Como todo `<form action={função}>` do React 19, os campos não controlados voltam
 * ao valor inicial depois do envio (que já chega atualizado pelo servidor).
 */
export function FormAcao({
  action,
  children,
  className,
  sucesso,
  aoConcluir,
  "aria-label": ariaLabel,
}: {
  action: AcaoFormulario;
  children: ReactNode;
  className?: string;
  sucesso?: string;
  aoConcluir?: () => void;
  "aria-label"?: string;
}) {
  async function enviar(formData: FormData) {
    try {
      const resultado = await action(formData);
      if (resultado && !resultado.ok) {
        toast.error(resultado.message ?? "Não foi possível salvar. Tente novamente.");
        return;
      }
    } catch (erro) {
      const mensagem = erro instanceof Error && erro.message ? erro.message : "Tente novamente.";
      toast.error(`Não foi possível salvar. ${mensagem}`);
      return;
    }
    if (sucesso) toast.success(sucesso);
    aoConcluir?.();
  }

  return (
    <form action={enviar} className={className} aria-label={ariaLabel}>
      {children}
    </form>
  );
}
