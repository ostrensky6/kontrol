"use client";

import { useState } from "react";
import { PackagePlus } from "lucide-react";

import { SubmitButton } from "@/components/common/SubmitButton";
import { FormComMensagem } from "@/components/pedido/FormComMensagem";
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
import { cadastrarInsumoDoItemPedido } from "@/lib/actions/pedido-item-insumo";
import { formatNumber as fmt } from "@/lib/formatters";
import { sugerirInsumoDoItem } from "@/lib/pedido/item-novo";

const campoCls = "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm";
const rotuloCls = "block text-xs text-muted-foreground/80";

export type ItemNovoDoPedido = {
  id: number;
  especificacao: string;
  modelo: string | null;
  volume: string | null;
  quantidade: number;
  unidade: string | null;
  orcamento_previo: number | null;
};

export type InsumoParecido = { id: number; especificacao: string; fabricante: string | null; codigoFabricante: string | null };

/**
 * Item novo do pedido (algo nunca comprado): quem conduz a compra confere os
 * dados, cadastra o insumo e o item fica ligado a ele, sem sair do pedido. Se
 * o item já existe no cadastro com outro nome, "Ligar a este" evita o cadastro
 * repetido. Decisão de Antonio em 19/11/2026.
 */
export function PedidoItemCadastrarInsumo({
  pedidoId,
  item,
  parecidos,
}: {
  pedidoId: number;
  item: ItemNovoDoPedido;
  parecidos: InsumoParecido[];
}) {
  const [aberto, setAberto] = useState(false);
  const sugestao = sugerirInsumoDoItem(item);
  const [quantidadeEmbalagem, setQuantidadeEmbalagem] = useState(sugestao.quantidadeEmbalagem);
  const [unidade, setUnidade] = useState(sugestao.unidade);
  const id = (campo: string) => `cadastrar-insumo-${item.id}-${campo}`;
  const embalagens = Number(item.quantidade) === 1 ? "1 embalagem" : `${fmt(item.quantidade)} embalagens`;

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <PackagePlus className="h-3.5 w-3.5" aria-hidden="true" />
          Cadastrar insumo<span className="sr-only"> de {item.especificacao}</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Cadastrar item novo</DialogTitle>
          <DialogDescription>
            “{item.especificacao}” ainda não está no cadastro de insumos. Confira os dados e cadastre: o item fica ligado ao insumo e o
            pedido pode ser formalizado.
          </DialogDescription>
        </DialogHeader>

        {parecidos.length > 0 && (
          <section aria-label="Parecidos no cadastro" data-testid="insumos-parecidos" className="rounded-md border border-border bg-muted/40 p-3">
            <h3 className="text-xs font-semibold">Parecidos no cadastro</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Se for um destes, ligue o item a ele em vez de cadastrar de novo.</p>
            <ul className="mt-2 grid gap-2">
              {parecidos.map((insumo) => (
                <li key={insumo.id}>
                  <FormComMensagem action={cadastrarInsumoDoItemPedido} onSuccess={() => setAberto(false)} className="flex flex-wrap items-center justify-between gap-2">
                    <input type="hidden" name="item_id" value={item.id} />
                    <input type="hidden" name="pedido_interno_id" value={pedidoId} />
                    <input type="hidden" name="ligar_insumo_id" value={insumo.id} />
                    <span className="min-w-0 text-sm">
                      {insumo.especificacao}
                      {[insumo.fabricante, insumo.codigoFabricante ? `cód. ${insumo.codigoFabricante}` : null].some(Boolean) && (
                        <span className="block text-xs text-muted-foreground">
                          {[insumo.fabricante, insumo.codigoFabricante ? `cód. ${insumo.codigoFabricante}` : null].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </span>
                    <SubmitButton variant="outline" size="sm" pendingLabel="Ligando…">
                      Ligar a este<span className="sr-only"> ({insumo.especificacao})</span>
                    </SubmitButton>
                  </FormComMensagem>
                </li>
              ))}
            </ul>
          </section>
        )}

        <FormComMensagem action={cadastrarInsumoDoItemPedido} onSuccess={() => setAberto(false)} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="item_id" value={item.id} />
          <input type="hidden" name="pedido_interno_id" value={pedidoId} />
          <div className="sm:col-span-2">
            <label htmlFor={id("especificacao")} className={rotuloCls}>Item específico / SKU</label>
            <input id={id("especificacao")} name="insumo_especificacao" required maxLength={300} defaultValue={sugestao.especificacao} className={campoCls} />
          </div>
          <div>
            <label htmlFor={id("fabricante")} className={rotuloCls}>Marca / fabricante</label>
            <input id={id("fabricante")} name="insumo_fabricante" maxLength={200} defaultValue={sugestao.fabricante} className={campoCls} />
          </div>
          <div>
            <label htmlFor={id("codigo")} className={rotuloCls}>Código do fabricante</label>
            <input id={id("codigo")} name="insumo_codigo_fabricante" maxLength={120} placeholder="Catálogo / part number" className={campoCls} />
          </div>
          <div>
            <label htmlFor={id("quantidade")} className={rotuloCls}>Quantidade na embalagem</label>
            <input
              id={id("quantidade")}
              name="insumo_quantidade_embalagem"
              type="number"
              required
              min="0.000001"
              step="any"
              value={quantidadeEmbalagem}
              onChange={(event) => setQuantidadeEmbalagem(event.target.value)}
              aria-describedby={id("embalagem-ajuda")}
              className={campoCls}
            />
          </div>
          <div>
            <label htmlFor={id("unidade")} className={rotuloCls}>Unidade da embalagem</label>
            <input
              id={id("unidade")}
              name="insumo_unidade"
              required
              maxLength={40}
              placeholder="mL, g, un…"
              value={unidade}
              onChange={(event) => setUnidade(event.target.value)}
              aria-describedby={id("embalagem-ajuda")}
              className={campoCls}
            />
          </div>
          <p id={id("embalagem-ajuda")} className="text-xs text-muted-foreground sm:col-span-2">
            Frasco de 500 mL: 500 e mL. Caixa com 100 unidades: 100 e un.
          </p>
          <div>
            <label htmlFor={id("custo")} className={rotuloCls}>Valor da embalagem (R$)</label>
            <input
              id={id("custo")}
              name="insumo_custo_embalagem"
              type="number"
              required
              min="0"
              step="0.01"
              defaultValue={sugestao.custoEmbalagem}
              aria-describedby={id("custo-ajuda")}
              className={campoCls}
            />
            <p id={id("custo-ajuda")} className="mt-1 text-xs text-muted-foreground">Use 0 se ainda não souber; a cotação corrige depois.</p>
          </div>
          <p data-testid="item-novo-quantidade" className="self-center rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            O pedido pede {fmt(item.quantidade)} {item.unidade ?? ""}. Depois do cadastro, o item conta{" "}
            <b>
              {embalagens} de {quantidadeEmbalagem || "?"} {unidade || "?"}
            </b>
            . Se não for isso, ajuste a quantidade em “Editar”.
          </p>
          <DialogFooter className="sm:col-span-2">
            <DialogClose asChild>
              <button type="button" className="rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
                Cancelar
              </button>
            </DialogClose>
            <SubmitButton pendingLabel="Cadastrando…" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500">
              Cadastrar e ligar ao item
            </SubmitButton>
          </DialogFooter>
        </FormComMensagem>
      </DialogContent>
    </Dialog>
  );
}
