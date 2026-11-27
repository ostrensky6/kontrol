"use client";

import { Trash2 } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SubmitButton } from "@/components/common/SubmitButton";
import { excluirPedidoInterno } from "@/lib/actions/pedidos-internos";
import { FormComMensagem } from "./FormComMensagem";
import { cn } from "@/lib/utils";

/** Status em que o pedido já anda no fluxo: o diálogo lembra que Cancelar guarda o histórico. */
const EM_ANDAMENTO = (status: string) => status !== "rascunho";

/**
 * Apagar pedido (Antonio, 27/11/2026: "um botão de apagar ao longo de todo o
 * processo"). Vale em qualquer etapa; o banco só recusa quando já chegou
 * material no estoque (0186). O mesmo diálogo na lista e na tela do pedido.
 */
export function ApagarPedido({
  pedidoId,
  numero,
  titulo,
  status,
  voltar = "/pedido",
  compacto = false,
  className,
}: {
  pedidoId: number;
  numero: string;
  titulo?: string;
  status: string;
  /** lista para onde a pessoa volta depois de apagar */
  voltar?: string;
  /** só a lixeira (na lista, para a tabela caber sem rolar para o lado) */
  compacto?: boolean;
  className?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Apagar ${numero}`}
          title={compacto ? `Apagar ${numero}` : undefined}
          className={cn(
            "toque inline-flex items-center gap-1 rounded-md border border-danger-strong/30 px-2 py-1 text-xs font-medium text-danger-strong hover:bg-danger-soft",
            className,
          )}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          {!compacto && "Apagar"}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apagar o pedido {numero}?</DialogTitle>
          <DialogDescription>
            {titulo ? (
              <>
                O pedido <b>{titulo}</b> sai do Kontrol
              </>
            ) : (
              "O pedido sai do Kontrol"
            )}{" "}
            com os itens, documentos, orçamentos e a compra ligada. Não dá para desfazer.
          </DialogDescription>
        </DialogHeader>
        {EM_ANDAMENTO(status) && (
          <p className="text-sm text-muted-foreground">
            Para encerrar guardando o histórico, use <b>Reprovar</b> ou <b>Cancelar</b>. Se já chegou material no
            estoque, o pedido não pode ser apagado.
          </p>
        )}
        <FormComMensagem action={excluirPedidoInterno} className="space-y-3">
          <input type="hidden" name="pedido_interno_id" value={pedidoId} />
          <input type="hidden" name="voltar" value={voltar} />
          <div>
            <label htmlFor={`apagar-motivo-${pedidoId}`} className="block text-sm font-medium text-foreground">
              Motivo (opcional)
            </label>
            <input
              id={`apagar-motivo-${pedidoId}`}
              name="motivo"
              maxLength={300}
              placeholder="Ex.: pedido de teste, duplicado"
              className="mt-1 h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                className="rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                Voltar
              </button>
            </DialogClose>
            <SubmitButton
              pendingLabel="Apagando…"
              className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
            >
              Apagar pedido
            </SubmitButton>
          </DialogFooter>
        </FormComMensagem>
      </DialogContent>
    </Dialog>
  );
}
