"use client";

import { HelpTip } from "@/components/common/HelpTip";
import { NumeroPasso } from "@/components/common/NumeroPasso";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  campoDocumentoNovoPedido,
  MAXIMO_DOCUMENTOS_NOVO_PEDIDO,
  TIPOS_DOCUMENTO_NOVO_PEDIDO,
} from "@/lib/pedido/anexos";
import { CampoArquivosAnexo } from "./CampoArquivosAnexo";

const campoCls = "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm";
const rotuloCls = "block text-xs text-muted-foreground/80";

/**
 * Cotação prévia e termo de referência no "Novo pedido": os mesmos campos de
 * "Registrar documento" (tipo, título, arquivo, link e observação), um
 * conjunto por documento. Conjunto em branco não é gravado.
 */
export function NovoPedidoDocumentos() {
  const [indices, setIndices] = useState<number[]>([0]);
  const [proximo, setProximo] = useState(1);

  function adicionar() {
    setIndices((atuais) => [...atuais, proximo]);
    setProximo((n) => n + 1);
  }

  return (
    <section className="grid gap-3 rounded-lg border border-border p-4" aria-labelledby="novo-pedido-documentos-titulo">
      <div className="flex items-center gap-1.5">
        <h3 id="novo-pedido-documentos-titulo" className="flex items-center gap-2 text-sm font-semibold"><NumeroPasso n={4} />Cotação prévia e termo de referência</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Opcional</span>
        <HelpTip title="Quando registrar">
          Registre aqui, com o pedido: da Aprovação em diante, esses dois documentos não entram mais.
        </HelpTip>
      </div>
      <input type="hidden" name="documentos_indices" value={indices.join(",")} />
      {indices.map((indice, posicao) => {
        const id = (campo: Parameters<typeof campoDocumentoNovoPedido>[1]) => `novo-pedido-${campoDocumentoNovoPedido(indice, campo)}`;
        const nome = (campo: Parameters<typeof campoDocumentoNovoPedido>[1]) => campoDocumentoNovoPedido(indice, campo);
        return (
          <div
            key={indice}
            role="group"
            aria-label={`Documento ${posicao + 1}`}
            data-testid="novo-pedido-documento"
            className="grid gap-3 rounded-lg border border-border bg-muted/30 p-3 md:grid-cols-2"
          >
            <div>
              <label htmlFor={id("tipo")} className={rotuloCls}>Tipo</label>
              <select id={id("tipo")} name={nome("tipo")} defaultValue={TIPOS_DOCUMENTO_NOVO_PEDIDO[0].valor} className={campoCls}>
                {TIPOS_DOCUMENTO_NOVO_PEDIDO.map((tipo) => (
                  <option key={tipo.valor} value={tipo.valor}>{tipo.rotulo}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={id("titulo")} className={rotuloCls}>Título</label>
              <input id={id("titulo")} name={nome("titulo")} className={campoCls} />
            </div>
            <CampoArquivosAnexo
              id={id("arquivo")}
              name={nome("arquivo")}
              label="Arquivo"
              somaNoFormulario={indices.length > 1}
              className="md:col-span-2"
            />
            <div className="md:col-span-2">
              <label htmlFor={id("url")} className={rotuloCls}>Link ou referência externa (opcional)</label>
              <input id={id("url")} name={nome("url")} placeholder="https://..." className={campoCls} />
            </div>
            <div className="md:col-span-2">
              <label htmlFor={id("observacao")} className={rotuloCls}>Observação</label>
              <input id={id("observacao")} name={nome("observacao")} className={campoCls} />
            </div>
            {indices.length > 1 && (
              <div className="md:col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIndices((atuais) => atuais.filter((i) => i !== indice))}
                >
                  Remover documento {posicao + 1}
                </Button>
              </div>
            )}
          </div>
        );
      })}
      {indices.length < MAXIMO_DOCUMENTOS_NOVO_PEDIDO && (
        <div>
          <Button type="button" variant="outline" onClick={adicionar}>
            Adicionar outro documento
          </Button>
        </div>
      )}
    </section>
  );
}
