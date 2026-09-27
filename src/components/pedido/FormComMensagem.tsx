"use client";

import { useActionState } from "react";
import type { EstadoAcao } from "@/lib/erros";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

type AcaoComEstado = (prev: EstadoAcao, formData: FormData) => Promise<EstadoAcao>;

/**
 * Formulário que mostra o retorno da server action (`{ ok, message }`) em vez
 * de levar o usuário a uma tela de erro. Pode ser usado dentro de páginas de
 * servidor passando a action como prop. Use `SubmitButton` como botão para
 * travar o duplo clique enquanto envia.
 */
export function FormComMensagem({
  action,
  className,
  children,
  onSuccess,
  encType,
  mostrarSucesso = false,
}: {
  action: AcaoComEstado;
  className?: string;
  children: React.ReactNode;
  onSuccess?: () => void;
  encType?: "multipart/form-data";
  /** mostra também a mensagem de sucesso (padrão: só erros; a página recarrega) */
  mostrarSucesso?: boolean;
}) {
  const [state, formAction] = useActionState(async (prev: EstadoAcao, formData: FormData) => {
    const resultado = await action(prev, formData);
    if (resultado.ok) onSuccess?.();
    return resultado;
  }, { ok: false } as EstadoAcao);

  const visivel = state.ok && !mostrarSucesso ? null : state;
  return (
    <form action={formAction} {...formularioSemPerda(state)} className={className} encType={encType}>
      {children}
      <MensagemAcao estado={visivel} className="basis-full text-xs font-medium md:col-span-2" />
      {!state.ok && state.errors && Object.keys(state.errors).length > 0 && (
        <p className="basis-full text-xs text-danger-strong">{Object.values(state.errors).join(" ")}</p>
      )}
    </form>
  );
}
