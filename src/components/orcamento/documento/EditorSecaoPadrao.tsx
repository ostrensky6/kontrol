"use client";

import { useActionState, useState } from "react";

import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import { Input } from "@/components/ui/input";
import { ESTADO_INICIAL, type EstadoAcao } from "@/lib/erros";
import { normalizarTexto, type DocTexto } from "@/lib/orcamento/texto-rico";
import { EditorTextoRico } from "../texto/EditorTextoRico";

export type SecaoPadraoTela = {
  chave: string;
  titulo: string;
  texto: unknown;
  ordem: number;
  ativo: boolean;
};

/** Uma seção padrão (ou uma nova, sem `secao`) de uma empresa emissora. */
export function EditorSecaoPadrao({
  empresa,
  secao,
  action,
  podeEditar,
}: {
  empresa: "ATGC" | "GIA";
  secao?: SecaoPadraoTela;
  action: (estado: EstadoAcao, formData: FormData) => Promise<EstadoAcao>;
  podeEditar: boolean;
}) {
  const [texto, setTexto] = useState<DocTexto | null>(normalizarTexto(secao?.texto));
  const [estado, enviar] = useActionState(action, ESTADO_INICIAL);
  const nova = !secao;
  const id = `${empresa}-${secao?.chave ?? "nova"}`;

  return (
    <form action={enviar} className="space-y-2 rounded-md border border-border bg-card p-3">
      <input type="hidden" name="empresa_codigo" value={empresa} />
      <input type="hidden" name="texto" value={JSON.stringify(texto ?? { type: "doc", content: [] })} />
      {!nova && <input type="hidden" name="chave" value={secao.chave} />}
      <div className="grid gap-2 sm:grid-cols-12">
        <div className="sm:col-span-6">
          <label htmlFor={`${id}-titulo`} className="text-xs font-medium text-muted-foreground">Título da seção</label>
          <Input id={`${id}-titulo`} name="titulo" defaultValue={secao?.titulo ?? ""} required disabled={!podeEditar} className="mt-1 h-8" />
        </div>
        {nova && (
          <div className="sm:col-span-3">
            <label htmlFor={`${id}-chave`} className="text-xs font-medium text-muted-foreground">Identificador</label>
            <Input id={`${id}-chave`} name="chave" placeholder="garantia_resultados" required disabled={!podeEditar} className="mt-1 h-8" />
          </div>
        )}
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-ordem`} className="text-xs font-medium text-muted-foreground">Ordem</label>
          <Input
            id={`${id}-ordem`}
            name="ordem"
            type="number"
            min={0}
            max={1000}
            defaultValue={secao?.ordem ?? 50}
            disabled={!podeEditar}
            className="mt-1 h-8 text-right tabular-nums"
          />
        </div>
        <label className="flex items-end gap-2 pb-1.5 text-sm sm:col-span-1">
          <input type="checkbox" name="ativo" defaultChecked={secao?.ativo ?? true} disabled={!podeEditar} className="h-4 w-4" />
          Ativa
        </label>
      </div>
      {podeEditar ? (
        <EditorTextoRico valor={texto} onChange={setTexto} rotulo={`Texto de ${secao?.titulo ?? "nova seção"}`} />
      ) : null}
      {podeEditar && (
        <div className="flex items-center justify-between gap-2">
          <MensagemAcao estado={estado} />
          <SubmitButton size="sm" className="ml-auto">{nova ? "Criar seção" : "Salvar seção"}</SubmitButton>
        </div>
      )}
    </form>
  );
}
