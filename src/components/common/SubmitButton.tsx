"use client";

import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

/**
 * Botão de envio padrão: desabilita enquanto o formulário envia (evita o
 * registro em dobro por duplo clique) e troca o texto pelo verbo em andamento.
 */
export function SubmitButton({
  children,
  pendingLabel = "Salvando…",
  disabled,
  ...props
}: Omit<ComponentProps<typeof Button>, "type"> & { children: ReactNode; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending} aria-busy={pending || undefined} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
