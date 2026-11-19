"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency as brl, formatNumber as fmt } from "@/lib/formatters";
import { ehItemNovo } from "@/lib/pedido/item-novo";
import { normalizarItemNovoPedido, type CampoItemNovoPedido } from "@/lib/pedido/itens-novo-pedido";

/** Item já adicionado no "Novo pedido": os campos como foram digitados, mais a chave da linha. */
export type ItemDaLista = { chave: number; campos: Record<CampoItemNovoPedido, string> };

const TIPO_ROTULO: Record<string, string> = { material: "Material", servico: "Serviço", equipamento: "Equipamento" };

/** Lista dos itens já adicionados ao pedido que está sendo criado. */
export function NovoPedidoItensLista({
  itens,
  aoEditar,
  aoRemover,
}: {
  itens: ItemDaLista[];
  aoEditar: (chave: number) => void;
  aoRemover: (chave: number) => void;
}) {
  const linhas = itens.map((item) => ({ chave: item.chave, ...normalizarItemNovoPedido(item.campos) }));
  const total = linhas.reduce((soma, item) => soma + Number(item.quantidade ?? 0) * Number(item.orcamento_previo ?? 0), 0);
  if (linhas.length === 0) {
    return (
      <p data-testid="novo-pedido-itens" className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
        Nenhum item ainda.
      </p>
    );
  }
  return (
    <div data-testid="novo-pedido-itens" className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead className="text-right">Quantidade</TableHead>
            <TableHead className="text-right">Preço estimado (un.)</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map((item) => (
            <TableRow key={item.chave}>
              <TableCell>
                <span className="font-medium">{item.especificacao}</span>
                {ehItemNovo(item) && (
                  <span data-testid="item-novo" className="ml-2 rounded-full border border-info-strong/40 px-1.5 py-0.5 text-xs text-info-strong">
                    Item novo
                  </span>
                )}
                {[item.modelo, item.volume, item.fornecedor_sugerido].some(Boolean) && (
                  <span className="block text-xs text-muted-foreground">
                    {[item.modelo, item.volume, item.fornecedor_sugerido].filter(Boolean).join(" · ")}
                  </span>
                )}
              </TableCell>
              <TableCell>{TIPO_ROTULO[item.tipo] ?? item.tipo}</TableCell>
              <TableCell className="text-right tabular-nums">
                {fmt(Number(item.quantidade ?? 0))} {item.unidade ?? ""}
              </TableCell>
              <TableCell className="text-right tabular-nums">{item.orcamento_previo != null ? brl(item.orcamento_previo) : "—"}</TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-3">
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => aoEditar(item.chave)}>
                    Editar<span className="sr-only"> {item.especificacao}</span>
                  </button>
                  <button type="button" className="text-xs text-danger-strong hover:underline" onClick={() => aoRemover(item.chave)}>
                    Remover<span className="sr-only"> {item.especificacao}</span>
                  </button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {total > 0 && (
        <p className="border-t border-border px-3 py-2 text-right text-xs text-muted-foreground">
          Total estimado: <span className="font-medium text-foreground tabular-nums">{brl(total)}</span>
        </p>
      )}
    </div>
  );
}
