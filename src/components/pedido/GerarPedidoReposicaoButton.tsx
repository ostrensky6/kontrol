"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { FilePlus2 } from "lucide-react";

import { gerarPedidosReposicaoEstoque } from "@/lib/actions/pedidos-internos";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/common/HelpTip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { FormState } from "@/lib/actions/cadastros";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

type PedidoReposicaoState = FormState & { pedidoId?: number };

const initialState: PedidoReposicaoState = { ok: true, message: "" };

export function GerarPedidoReposicaoButton() {
  const [state, action, pending] = useActionState(gerarPedidosReposicaoEstoque, initialState);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog open={open} onOpenChange={(nextOpen) => !pending && setOpen(nextOpen)}>
        <DialogTrigger asChild>
          <Button type="button" size="sm" disabled={pending}>
            <FilePlus2 className={pending ? "animate-pulse" : undefined} />
            Gerar pedidos de reposição
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md" showCloseButton={!pending}>
          <DialogHeader>
            <div className="flex items-center gap-1">
              <DialogTitle>Gerar pedido de reposição?</DialogTitle>
              <HelpTip title="Pedido de reposição">
                <p>
                  O pedido nasce como <b>rascunho</b>. Antes de virar compra, revise os itens, informe o
                  projeto e a fonte de recurso e envie para validação.
                </p>
              </HelpTip>
            </div>
            <DialogDescription>
              Cria um pedido interno em rascunho com os insumos abaixo do ponto de reposição.
            </DialogDescription>
          </DialogHeader>
          <form action={action} {...formularioSemPerda(state)} onSubmit={() => setOpen(false)}>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                <FilePlus2 className={pending ? "animate-pulse" : undefined} />
                Gerar pedido
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {state.message && (
        <span
          aria-live="polite"
          className={`text-xs ${state.ok ? "text-brand-700 dark:text-brand-300" : "text-danger-strong"}`}
        >
          {state.message}
          {state.ok && state.pedidoId ? (
            <>
              {" "}
              <Link href={`/pedido/${state.pedidoId}`} className="font-semibold underline">
                Abrir pedido
              </Link>
            </>
          ) : null}
        </span>
      )}
    </div>
  );
}
