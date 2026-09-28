"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { MensagemAcao } from "@/components/common/MensagemAcao";
import { ESTADO_INICIAL, type EstadoAcao } from "@/lib/erros";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

/**
 * Formulário ligado a uma Server Action que devolve `EstadoAcao`. A recusa
 * aparece ao lado do botão (MensagemAcao) em vez de derrubar a tela no
 * `error.tsx`, e o que foi digitado continua no formulário.
 */
export function FormEstado({
  action,
  children,
  className,
  mensagemClassName,
  seguirPara,
  "aria-label": ariaLabel,
}: {
  action: (estado: EstadoAcao, formData: FormData) => Promise<EstadoAcao>;
  children: ReactNode;
  className?: string;
  mensagemClassName?: string;
  /** depois de um retorno ok, abre este endereço (ex.: a próxima etapa da proposta) */
  seguirPara?: string;
  "aria-label"?: string;
}) {
  const [estado, enviar] = useActionState(action, ESTADO_INICIAL);
  const router = useRouter();
  useEffect(() => {
    if (seguirPara && estado.ok && estado !== ESTADO_INICIAL) router.push(seguirPara);
  }, [estado, seguirPara, router]);
  return (
    <form action={enviar} {...formularioSemPerda(estado)} className={className} aria-label={ariaLabel}>
      {children}
      <MensagemAcao estado={estado} className={mensagemClassName} />
    </form>
  );
}
