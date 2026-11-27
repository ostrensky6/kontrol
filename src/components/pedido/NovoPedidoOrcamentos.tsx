"use client";

import { useState } from "react";
import { HelpTip } from "@/components/common/HelpTip";
import { NumeroPasso } from "@/components/common/NumeroPasso";
import { Button } from "@/components/ui/button";
import { ORCAMENTOS_EXIGIDOS } from "@/lib/pedido/orcamentos";
import {
  campoOrcamentoNovoPedido,
  MAXIMO_ORCAMENTOS_NOVO_PEDIDO,
  ORCAMENTOS_INICIAIS_NOVO_PEDIDO,
} from "@/lib/pedido/orcamentos-novo-pedido";
import { CampoArquivosAnexo } from "./CampoArquivosAnexo";

const campoCls = "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm";
const rotuloCls = "block text-xs text-muted-foreground/80";

/**
 * Os orçamentos vão junto com o pedido (Antonio e Rafaela, 27/11/2026): três
 * linhas de saída, cada uma com fornecedor, valor e o documento, e o botão
 * para mais. No envio, o de menor valor fica escolhido; quem aprova pode
 * trocar, com justificativa.
 */
export function NovoPedidoOrcamentos({ fornecedores, passo }: { fornecedores: string[]; passo: number }) {
  const [indices, setIndices] = useState<number[]>(() => Array.from({ length: ORCAMENTOS_INICIAIS_NOVO_PEDIDO }, (_, i) => i));
  const [proximo, setProximo] = useState(ORCAMENTOS_INICIAIS_NOVO_PEDIDO);
  const listaId = "novo-pedido-orcamentos-fornecedores";

  return (
    <section className="grid gap-3 rounded-lg border border-border p-4" aria-labelledby="novo-pedido-orcamentos-titulo">
      <div className="flex items-center gap-1.5">
        <h3 id="novo-pedido-orcamentos-titulo" className="flex items-center gap-2 text-sm font-semibold">
          <NumeroPasso n={passo} />
          Orçamentos
        </h3>
        <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-strong">
          {ORCAMENTOS_EXIGIDOS} para enviar
        </span>
        <HelpTip title="Orçamentos do pedido">
          O pedido vai com pelo menos {ORCAMENTOS_EXIGIDOS} orçamentos de fornecedores diferentes, cada um com o documento do
          fornecedor. No envio, o de menor valor fica escolhido; quem aprova pode trocar, com justificativa. Para guardar o
          rascunho, os orçamentos podem ficar para depois.
        </HelpTip>
      </div>
      <input type="hidden" name="orcamentos_indices" value={indices.join(",")} />
      <datalist id={listaId}>
        {fornecedores.map((nome) => (
          <option key={nome} value={nome} />
        ))}
      </datalist>
      {indices.map((indice, posicao) => {
        const id = (campo: Parameters<typeof campoOrcamentoNovoPedido>[1]) => `novo-pedido-${campoOrcamentoNovoPedido(indice, campo)}`;
        const nome = (campo: Parameters<typeof campoOrcamentoNovoPedido>[1]) => campoOrcamentoNovoPedido(indice, campo);
        return (
          <div
            key={indice}
            role="group"
            aria-label={`Orçamento ${posicao + 1}`}
            data-testid="novo-pedido-orcamento"
            className="grid gap-3 rounded-lg border border-border bg-muted/30 p-3 md:grid-cols-12"
          >
            <div className="md:col-span-6">
              <label htmlFor={id("fornecedor_nome")} className={rotuloCls}>
                Fornecedor do orçamento {posicao + 1}
              </label>
              <input
                id={id("fornecedor_nome")}
                name={nome("fornecedor_nome")}
                list={listaId}
                maxLength={200}
                autoComplete="off"
                className={campoCls}
              />
            </div>
            <div className="md:col-span-3">
              <label htmlFor={id("valor")} className={rotuloCls}>
                Valor total (R$)
              </label>
              <input id={id("valor")} name={nome("valor")} inputMode="decimal" placeholder="0,00" className={campoCls} />
            </div>
            <div className="md:col-span-3">
              <label htmlFor={id("prazo")} className={rotuloCls}>
                Entrega (dias)
              </label>
              <input id={id("prazo")} name={nome("prazo")} type="number" min="0" step="1" inputMode="numeric" className={campoCls} />
            </div>
            <CampoArquivosAnexo
              id={id("arquivo")}
              name={nome("arquivo")}
              label={`Documento do orçamento ${posicao + 1}`}
              somaNoFormulario
              className="md:col-span-12"
            />
            {indices.length > ORCAMENTOS_EXIGIDOS && (
              <div className="md:col-span-12">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIndices((atuais) => atuais.filter((i) => i !== indice))}
                >
                  Remover orçamento {posicao + 1}
                </Button>
              </div>
            )}
          </div>
        );
      })}
      {indices.length < MAXIMO_ORCAMENTOS_NOVO_PEDIDO && (
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setIndices((atuais) => [...atuais, proximo]);
              setProximo((n) => n + 1);
            }}
          >
            Adicionar outro orçamento
          </Button>
        </div>
      )}
    </section>
  );
}
