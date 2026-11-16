"use client";

import { useState } from "react";
import { ListChecks } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatCurrency as brl, formatNumber as fmt } from "@/lib/formatters";

export type PedidoItemView = {
  id: number;
  tipo: string;
  especificacao: string;
  modelo: string | null;
  volume: string | null;
  quantidade: number;
  unidade: string | null;
  orcamento_previo: number | null;
  fornecedor_sugerido: string | null;
};

export function PedidoItensQuickView({
  numero,
  titulo,
  itens,
}: {
  numero: string;
  titulo: string;
  itens: PedidoItemView[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
        title="Ver itens solicitados"
      >
        <ListChecks className="h-3.5 w-3.5" />
        Itens ({itens.length})
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {numero} · {titulo}
            </DialogTitle>
            <DialogDescription>Itens solicitados neste pedido.</DialogDescription>
          </DialogHeader>

          {itens.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground/80">
              Nenhum material ou serviço informado.
            </p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-border bg-card text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-right">Qtd</th>
                    <th className="px-3 py-2 text-right">Prévio un.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {itens.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.especificacao}</span>
                          <Badge className="bg-muted text-muted-foreground">
                            {item.tipo === "servico" ? "Serviço" : "Material"}
                          </Badge>
                        </div>
                        {(item.modelo || item.volume || item.fornecedor_sugerido) && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {[item.modelo, item.volume, item.fornecedor_sugerido]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmt(item.quantidade)} {item.unidade ?? ""}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {brl(item.orcamento_previo)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
