"use client";

import { Pencil } from "lucide-react";

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
import { editarItemPedidoInterno } from "@/lib/actions/pedidos-internos";
import { PedidoItemCamposAssistidos, type PedidoItemCatalogo } from "./PedidoItemCamposAssistidos";

export type PedidoItemEdit = {
  id: number;
  tipo: string;
  especificacao: string;
  modelo: string | null;
  volume: string | null;
  quantidade: number;
  unidade: string | null;
  orcamento_previo: number | null;
  fornecedor_sugerido: string | null;
  observacao: string | null;
  caracteristicas?: string | null;
  exigencia_tecnica?: string | null;
  exclusividade?: string | null;
  outros_fornecedores?: string | null;
  insumo_id: number | null;
};

export function PedidoItemEditar({
  pedidoId,
  item,
  catalogo,
  fornecedores = [],
}: {
  pedidoId: number;
  item: PedidoItemEdit;
  catalogo: PedidoItemCatalogo[];
  fornecedores?: string[];
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Editar item</DialogTitle>
          <DialogDescription>Atualize a especificação, quantidade e demais dados.</DialogDescription>
        </DialogHeader>
        <form action={editarItemPedidoInterno} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="item_id" value={item.id} />
          <input type="hidden" name="pedido_interno_id" value={pedidoId} />
          <PedidoItemCamposAssistidos
            catalogo={catalogo}
            fornecedores={fornecedores}
            layout="dialog"
            idPrefix={`editar-item-${item.id}`}
            defaults={{
              tipo: item.tipo,
              insumoId: item.insumo_id,
              especificacao: item.especificacao,
              modelo: item.modelo,
              volume: item.volume,
              quantidade: item.quantidade,
              unidade: item.unidade,
              orcamentoPrevio: item.orcamento_previo,
              fornecedorSugerido: item.fornecedor_sugerido,
              observacao: item.observacao,
              caracteristicas: item.caracteristicas,
              exigenciaTecnica: item.exigencia_tecnica,
              exclusividade: item.exclusividade,
              outrosFornecedores: item.outros_fornecedores,
            }}
          />
          <DialogFooter className="sm:col-span-2">
            <DialogClose asChild>
              <button type="button" className="rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
                Cancelar
              </button>
            </DialogClose>
            <DialogClose asChild>
              <button type="submit" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500">
                Salvar item
              </button>
            </DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
