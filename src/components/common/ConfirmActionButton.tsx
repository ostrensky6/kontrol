"use client";

import { useId, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MOTIVO_MIN_PADRAO, erroMotivo, normalizarMotivo, type MotivoConfirmacao } from "./motivo";

function BotaoConfirmar({ label, destrutivo }: { label: string; destrutivo: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      aria-busy={pending || undefined}
      className={`rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60 ${
        destrutivo ? "bg-destructive hover:bg-destructive/90" : "bg-brand-600 hover:bg-brand-500"
      }`}
    >
      {pending ? "Processando…" : label}
    </button>
  );
}

/**
 * Botão que abre um diálogo de confirmação antes de submeter uma Server Action.
 * A action é passada como prop (padrão suportado pelo Next: `<form action={...}>`)
 * e recebe os `fields` como inputs ocultos. Use para exclusões de entidades-raiz
 * e ações irreversíveis (emitir, revisar, cancelar) onde um clique acidental seria custoso.
 * O diálogo (Radix) prende o foco, fecha com Esc e devolve o foco ao botão.
 *
 * `motivo` (opcional): mostra um campo de texto obrigatório no diálogo; o valor
 * (sem espaços nas pontas) chega à action no FormData com a chave `motivo.name`.
 */
export function ConfirmActionButton({
  action,
  fields,
  trigger,
  titulo,
  mensagem,
  confirmLabel = "Excluir",
  destrutivo = true,
  disabled = false,
  triggerClassName = "text-xs text-muted-foreground/80 hover:text-danger-strong",
  motivo,
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields: Record<string, string | number>;
  trigger: ReactNode;
  titulo: string;
  mensagem: ReactNode;
  confirmLabel?: string;
  destrutivo?: boolean;
  disabled?: boolean;
  triggerClassName?: string;
  motivo?: MotivoConfirmacao;
}) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const motivoId = useId();
  const minimo = motivo?.minLength ?? MOTIVO_MIN_PADRAO;

  async function confirmar(formData: FormData) {
    if (motivo) {
      const texto = formData.get(motivo.name);
      const problema = erroMotivo(texto, minimo);
      if (problema) {
        setErro(problema);
        return;
      }
      formData.set(motivo.name, normalizarMotivo(texto));
    }
    await action(formData);
    setAberto(false);
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(proximo) => {
        setAberto(proximo);
        if (!proximo) setErro(null);
      }}
    >
      <DialogTrigger asChild>
        <button type="button" disabled={disabled} className={triggerClassName}>
          {trigger}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm text-left" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription asChild>
            <div>{mensagem}</div>
          </DialogDescription>
        </DialogHeader>
        <form action={confirmar} className="grid gap-4">
          {Object.entries(fields).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={String(v)} />
          ))}
          {motivo && (
            <div>
              <Label htmlFor={motivoId} className="block">
                {motivo.label}
                <span className="text-destructive"> *</span>
              </Label>
              <Textarea
                id={motivoId}
                name={motivo.name}
                required
                minLength={minimo}
                rows={3}
                aria-invalid={erro ? true : undefined}
                aria-describedby={erro ? `${motivoId}-erro` : undefined}
                onChange={() => erro && setErro(null)}
                className="mt-1"
              />
              {erro && (
                <p id={`${motivoId}-erro`} role="alert" className="mt-1 text-xs text-destructive">
                  {erro}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            >
              Voltar
            </button>
            <BotaoConfirmar label={confirmLabel} destrutivo={destrutivo} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
