"use client";

import { useState } from "react";
import { Flag } from "lucide-react";

import { SubmitButton } from "@/components/common/SubmitButton";
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
import { definirUrgenciaPedido } from "@/lib/actions/pedidos-internos";
import { JUSTIFICATIVA_URGENCIA_MINIMA, ehUrgente } from "@/lib/pedido/ciclo";
import { FormComMensagem } from "./FormComMensagem";

const inputCls = "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm";

/**
 * "Definir urgência" (0183; relatório de ajustes de Compras de 17/11/2026,
 * ajuste 2): só aparece para quem tem a permissão "Definir urgência do pedido".
 * Quem pede não escolhe a urgência, porque ela fura o ciclo do dia 10.
 */
export function PedidoUrgenciaDefinir({
  pedidoId,
  numero,
  urgencia,
  urgenciaJustificativa,
}: {
  pedidoId: number;
  numero: string;
  urgencia: string | null;
  urgenciaJustificativa: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  const [escolhida, setEscolhida] = useState(urgencia ?? "normal");
  const urgente = ehUrgente(escolhida);
  return (
    <Dialog
      open={aberto}
      onOpenChange={(proximo) => {
        // ao abrir, parte do que está gravado no pedido
        if (proximo) setEscolhida(urgencia ?? "normal");
        setAberto(proximo);
      }}
    >
      <DialogTrigger asChild>
        <button className="toque inline-flex items-center gap-1 rounded-md border border-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
          <Flag className="h-3.5 w-3.5" />
          Definir urgência
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Urgência do pedido {numero}</DialogTitle>
          <DialogDescription>
            Alta ou Crítica furam o ciclo de compras do dia 10 e pedem o motivo por escrito. A mudança fica na linha do tempo.
          </DialogDescription>
        </DialogHeader>
        <FormComMensagem action={definirUrgenciaPedido} onSuccess={() => setAberto(false)} className="grid gap-3">
          <input type="hidden" name="pedido_interno_id" value={pedidoId} />
          <div>
            <label htmlFor={`definir-urgencia-${pedidoId}`} className="block text-xs font-medium text-muted-foreground">Urgência</label>
            <select
              id={`definir-urgencia-${pedidoId}`}
              name="urgencia"
              value={escolhida}
              onChange={(evento) => setEscolhida(evento.target.value)}
              className={inputCls}
            >
              <option value="baixa">Baixa</option>
              <option value="normal">Normal</option>
              <option value="alta">Alta (fura o ciclo)</option>
              <option value="critica">Crítica (fura o ciclo)</option>
            </select>
          </div>
          {urgente && (
            <div>
              <label htmlFor={`definir-urgencia-motivo-${pedidoId}`} className="block text-xs font-medium text-muted-foreground">
                Por que é urgente? (obrigatório)
              </label>
              <textarea
                id={`definir-urgencia-motivo-${pedidoId}`}
                name="urgencia_justificativa"
                required
                minLength={JUSTIFICATIVA_URGENCIA_MINIMA}
                maxLength={1000}
                rows={3}
                defaultValue={urgenciaJustificativa ?? ""}
                placeholder="Ex.: amostras chegam dia 15 e o reagente acabou"
                className={inputCls}
              />
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <button type="button" className="rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
                Cancelar
              </button>
            </DialogClose>
            <SubmitButton>Salvar urgência</SubmitButton>
          </DialogFooter>
        </FormComMensagem>
      </DialogContent>
    </Dialog>
  );
}
