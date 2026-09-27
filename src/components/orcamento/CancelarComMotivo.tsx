"use client";

import { useActionState, useId, useState, type ReactNode } from "react";

import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ESTADO_INICIAL, type EstadoAcao } from "@/lib/erros";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

/**
 * Cancelamento com motivo digitado (UI-9). O motivo vai para o histórico;
 * a recusa do banco aparece dentro do diálogo e o motivo não se perde.
 */
export function CancelarComMotivo({
  action,
  fields,
  trigger,
  titulo,
  mensagem,
  confirmLabel,
  triggerClassName = "text-xs text-danger-strong hover:underline",
}: {
  action: (estado: EstadoAcao, formData: FormData) => Promise<EstadoAcao>;
  fields: Record<string, string | number>;
  trigger: ReactNode;
  titulo: string;
  mensagem: ReactNode;
  confirmLabel: string;
  triggerClassName?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [estado, enviar] = useActionState(async (anterior: EstadoAcao, formData: FormData) => {
    const resultado = await action(anterior, formData);
    if (resultado.ok) setAberto(false);
    return resultado;
  }, ESTADO_INICIAL);
  const idMotivo = useId();

  return (
    <>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogTrigger asChild>
          <button type="button" className={triggerClassName}>
            {trigger}
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-md text-left" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
            <DialogDescription asChild>
              <div>{mensagem}</div>
            </DialogDescription>
          </DialogHeader>
          <form action={enviar} {...formularioSemPerda(estado)} className="grid gap-2">
            {Object.entries(fields).map(([chave, valor]) => (
              <input key={chave} type="hidden" name={chave} value={String(valor)} />
            ))}
            <label htmlFor={idMotivo} className="text-xs font-medium text-muted-foreground">
              Motivo do cancelamento
            </label>
            <textarea
              id={idMotivo}
              name="motivo"
              required
              minLength={3}
              rows={3}
              className="rounded-md border border-input bg-card px-3 py-2 text-sm"
            />
            <MensagemAcao estado={estado} />
            <DialogFooter>
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
              >
                Voltar
              </button>
              <SubmitButton variant="destructive" size="sm" pendingLabel="Cancelando…">
                {confirmLabel}
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {estado.ok && <MensagemAcao estado={estado} className="mt-1" />}
    </>
  );
}
