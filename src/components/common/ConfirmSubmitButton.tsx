"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MOTIVO_MIN_PADRAO, erroMotivo, normalizarMotivo, type MotivoConfirmacao } from "./motivo";

/**
 * Botão de envio que pede confirmação antes de submeter o formulário em que está.
 * Diferente de `ConfirmActionButton`, preserva os campos visíveis do formulário
 * (validade, responsável, status…) e a validação nativa do navegador.
 * Use em ações irreversíveis: emitir, bloquear edição, cancelar.
 *
 * `motivo` (opcional): o diálogo pede um texto obrigatório; ao confirmar, o
 * valor (sem espaços nas pontas) é gravado num campo oculto `motivo.name`
 * deste formulário antes do envio.
 */
export function ConfirmSubmitButton({
  children,
  titulo,
  mensagem,
  confirmLabel,
  destrutivo = false,
  disabled = false,
  className,
  motivo,
}: {
  children: ReactNode;
  titulo: string;
  mensagem: ReactNode;
  confirmLabel: string;
  destrutivo?: boolean;
  disabled?: boolean;
  className?: string;
  motivo?: MotivoConfirmacao;
}) {
  const botao = useRef<HTMLButtonElement>(null);
  const campoMotivo = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const { pending } = useFormStatus();
  const motivoId = useId();
  const minimo = motivo?.minLength ?? MOTIVO_MIN_PADRAO;

  function confirmar() {
    if (motivo) {
      const problema = erroMotivo(texto, minimo);
      if (problema) {
        setErro(problema);
        return;
      }
      // grava direto no DOM: o requestSubmit abaixo lê o formulário antes de
      // qualquer nova renderização do React
      if (campoMotivo.current) campoMotivo.current.value = normalizarMotivo(texto);
    }
    setAberto(false);
    botao.current?.form?.requestSubmit(botao.current);
  }

  return (
    <>
      {motivo && <input ref={campoMotivo} type="hidden" name={motivo.name} defaultValue="" />}
      <button
        ref={botao}
        type="submit"
        disabled={disabled || pending}
        aria-busy={pending || undefined}
        className={className}
        onClick={(evento) => {
          evento.preventDefault();
          const form = botao.current?.form;
          if (form && !form.reportValidity()) return;
          setErro(null);
          setAberto(true);
        }}
      >
        {pending ? "Processando…" : children}
      </button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          className="max-w-sm text-left"
          showCloseButton={false}
          onCloseAutoFocus={(evento) => {
            // Sem DialogTrigger o Radix não sabe de onde o diálogo veio: devolve o foco ao botão.
            evento.preventDefault();
            botao.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
            <DialogDescription asChild>
              <div>{mensagem}</div>
            </DialogDescription>
          </DialogHeader>
          {motivo && (
            <div>
              <Label htmlFor={motivoId} className="block">
                {motivo.label}
                <span className="text-destructive"> *</span>
              </Label>
              <Textarea
                id={motivoId}
                value={texto}
                required
                minLength={minimo}
                rows={3}
                aria-invalid={erro ? true : undefined}
                aria-describedby={erro ? `${motivoId}-erro` : undefined}
                onChange={(evento) => {
                  setTexto(evento.target.value);
                  if (erro) setErro(null);
                }}
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
            <button
              type="button"
              onClick={confirmar}
              className={`rounded-md px-4 py-1.5 text-sm font-medium text-white ${
                destrutivo ? "bg-destructive hover:bg-destructive/90" : "bg-brand-600 hover:bg-brand-500"
              }`}
            >
              {confirmLabel}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
