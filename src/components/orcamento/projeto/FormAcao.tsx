"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
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
  irPara,
  "aria-label": ariaLabel,
}: {
  action: AcaoFormulario;
  children: ReactNode;
  className?: string;
  sucesso?: string;
  aoConcluir?: () => void;
  /** depois do sucesso, abre este endereço (ex.: a próxima etapa da proposta) */
  irPara?: string;
  "aria-label"?: string;
}) {
  const router = useRouter();
  async function enviar(formData: FormData) {
    let mensagem = sucesso;
    try {
      const resultado = await action(formData);
      if (resultado && !resultado.ok) {
        toast.error(resultado.message ?? "Não foi possível salvar. Tente novamente.");
        return;
      }
      // A ação pode devolver um texto de sucesso mais preciso (ex.: resumo do catálogo).
      if (resultado?.ok && resultado.message) mensagem = resultado.message;
    } catch (erro) {
      const texto = erro instanceof Error && erro.message ? erro.message : "Tente novamente.";
      toast.error(`Não foi possível salvar. ${texto}`);
      return;
    }
    if (mensagem) toast.success(mensagem);
    aoConcluir?.();
    if (irPara) router.push(irPara);
  }

  return (
    <form action={enviar} className={className} aria-label={ariaLabel}>
      {children}
    </form>
  );
}
