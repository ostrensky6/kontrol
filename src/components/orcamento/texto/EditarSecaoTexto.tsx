"use client";

import { Pencil } from "lucide-react";
import { useActionState, useEffect, useState, type ReactNode } from "react";

import { SubmitButton } from "@/components/common/SubmitButton";
import { Button } from "@/components/ui/button";
import { ESTADO_INICIAL, type EstadoAcao } from "@/lib/erros";
import type { DocTexto } from "@/lib/orcamento/texto-rico";
import type { TextosProposta } from "@/lib/orcamento/textos-proposta";
import { EditorTextoRico } from "./EditorTextoRico";

export type DestinoTextos = {
  action: (estado: EstadoAcao, formData: FormData) => Promise<EstadoAcao>;
  /** campos ocultos: versao_id ou demanda_id */
  campos: Record<string, string | number>;
  textos: TextosProposta;
  /** texto sob o editor: onde o texto fica salvo e o que o cliente vê */
  aviso: string;
};

/** Bloco de texto do documento com "Editar": troca só a parte `alvo` e salva o conjunto. */
export function EditarSecaoTexto({
  alvo,
  titulo,
  destino,
  children,
}: {
  alvo: { tipo: "descricao" } | { tipo: "secao"; chave: string };
  titulo: string;
  destino: DestinoTextos;
  children: ReactNode;
}) {
  const atual =
    alvo.tipo === "descricao"
      ? destino.textos.descricao
      : destino.textos.secoes.find((s) => s.chave === alvo.chave)?.texto ?? null;
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState<DocTexto | null>(atual);
  const [estado, enviar] = useActionState(destino.action, ESTADO_INICIAL);

  useEffect(() => {
    // salvo: o servidor revalida a página e o bloco volta ao modo leitura
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (estado.ok) setEditando(false);
  }, [estado]);

  const novosTextos: TextosProposta =
    alvo.tipo === "descricao"
      ? { ...destino.textos, descricao: rascunho }
      : {
          ...destino.textos,
          secoes: destino.textos.secoes.map((s) => (s.chave === alvo.chave ? { ...s, texto: rascunho } : s)),
        };

  if (!editando) {
    return (
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setRascunho(atual);
            setEditando(true);
          }}
          className="no-print mt-1 h-7 shrink-0 gap-1 px-2 text-xs"
          aria-label={`Editar ${titulo.toLocaleLowerCase("pt-BR")}`}
        >
          <Pencil className="h-3 w-3" /> Editar
        </Button>
      </div>
    );
  }

  return (
    <form action={enviar} className="no-print space-y-2">
      {Object.entries(destino.campos).map(([nome, valor]) => (
        <input key={nome} type="hidden" name={nome} value={valor} />
      ))}
      <input type="hidden" name="textos" value={JSON.stringify(novosTextos)} />
      <EditorTextoRico valor={rascunho} onChange={setRascunho} rotulo={titulo} autoFocus />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{destino.aviso}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditando(false)}>
            Cancelar
          </Button>
          <SubmitButton size="sm">Salvar</SubmitButton>
        </div>
      </div>
      {estado.message && !estado.ok && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger-strong">
          {estado.message}
        </p>
      )}
    </form>
  );
}
