"use client";

import { useActionState } from "react";
import { Archive, CheckCircle2, Loader2, PlusCircle } from "lucide-react";
import {
  arquivarTriagemCodigoDesconhecido,
  criarInsumoMinimoDaTriagem,
  resolverTriagemComEntidadeExistente,
} from "@/lib/actions/cadastros-triagem";
import { Button } from "@/components/ui/button";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

type Opcao = {
  id: number;
  label: string;
};

export type TriagemPendenteView = {
  id: number;
  codigo: string;
  formato: string | null;
  tipo_sugerido: string | null;
  criado_em: string;
};

function ErrorMessage({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="rounded-md border border-danger-strong/30 bg-danger-soft px-3 py-2 text-sm text-danger-strong">
      {message}
    </p>
  );
}

const initialState = { ok: false, message: "" };

export function TriagemResolucaoCard({
  triagem,
  insumos,
  lotes,
  locais,
}: {
  triagem: TriagemPendenteView;
  insumos: Opcao[];
  lotes: Opcao[];
  locais: Opcao[];
}) {
  const [existenteState, existenteAction, existentePending] = useActionState(
    resolverTriagemComEntidadeExistente,
    initialState,
  );
  const [insumoState, insumoAction, insumoPending] = useActionState(
    criarInsumoMinimoDaTriagem,
    initialState,
  );
  const [arquivarState, arquivarAction, arquivarPending] = useActionState(
    arquivarTriagemCodigoDesconhecido,
    initialState,
  );

  return (
    <article className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-semibold text-foreground">
            {triagem.codigo}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Formato: {triagem.formato === "kontrol_interno" ? "código do Kontrol" : triagem.formato === "url_kontrol" ? "link do Kontrol" : "não reconhecido"} · Sugestão:{" "}
            {triagem.tipo_sugerido ? triagem.tipo_sugerido.replaceAll("_", " ") : "não identificado"}
          </p>
        </div>
        <span className="rounded-md bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning-strong">
          Pendente
        </span>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <form
          action={existenteAction}
          {...formularioSemPerda(existenteState)}
          className="grid gap-3 rounded-md border border-border p-3"
        >
          <input type="hidden" name="triagem_id" value={triagem.id} />
          <h2 className="text-sm font-semibold text-foreground">
            Vincular a cadastro existente
          </h2>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-foreground">Tipo</span>
            <select
              name="entidade_tipo"
              className="h-9 rounded-md border border-border bg-card px-2 text-sm"
            >
              <option value="insumo">Insumo</option>
              <option value="lote">Lote existente</option>
              <option value="local">Local</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-foreground">ID da entidade</span>
            <input
              name="entidade_id"
              type="number"
              min="1"
              className="h-9 rounded-md border border-border bg-card px-2 text-sm"
              list={`entidades-${triagem.id}`}
              required
            />
          </label>
          <datalist id={`entidades-${triagem.id}`}>
            {insumos.map((opcao) => (
              <option key={`insumo-${opcao.id}`} value={opcao.id} label={`Insumo: ${opcao.label}`} />
            ))}
            {lotes.map((opcao) => (
              <option key={`lote-${opcao.id}`} value={opcao.id} label={`Lote: ${opcao.label}`} />
            ))}
            {locais.map((opcao) => (
              <option key={`local-${opcao.id}`} value={opcao.id} label={`Local: ${opcao.label}`} />
            ))}
          </datalist>
          <Button type="submit" disabled={existentePending}>
            {existentePending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Resolver vinculo
          </Button>
          <ErrorMessage message={existenteState.message} />
        </form>

        <form
          action={insumoAction}
          {...formularioSemPerda(insumoState)}
          className="grid gap-3 rounded-md border border-border p-3"
        >
          <input type="hidden" name="triagem_id" value={triagem.id} />
          <h2 className="text-sm font-semibold text-foreground">
            Criar novo insumo
          </h2>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-foreground">Especificação</span>
            <input
              name="especificacao"
              className="h-9 rounded-md border border-border bg-card px-2 text-sm"
              required
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-foreground">Un. estoque</span>
              <input
                name="unidade"
                className="h-9 rounded-md border border-border bg-card px-2 text-sm"
                required
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-foreground">Un. consumo</span>
              <input
                name="unidade_consumo"
                className="h-9 rounded-md border border-border bg-card px-2 text-sm"
                required
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-foreground">Fator</span>
              <input
                name="fator_conversao"
                type="number"
                min="0.000001"
                step="any"
                className="h-9 rounded-md border border-border bg-card px-2 text-sm"
                required
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-foreground">Qtd. embalagem</span>
              <input
                name="quantidade_embalagem"
                type="number"
                min="0.000001"
                step="any"
                className="h-9 rounded-md border border-border bg-card px-2 text-sm"
                required
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-foreground">Valor embalagem</span>
              <input
                name="custo_total_embalagem"
                type="number"
                min="0"
                step="any"
                className="h-9 rounded-md border border-border bg-card px-2 text-sm"
              />
            </label>
          </div>
          <Button type="submit" disabled={insumoPending}>
            {insumoPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlusCircle className="h-4 w-4" />
            )}
            Criar e resolver
          </Button>
          <ErrorMessage message={insumoState.message} />
        </form>
      </div>

      <form action={arquivarAction} {...formularioSemPerda(arquivarState)} className="mt-4 flex flex-wrap items-center gap-3">
        <input type="hidden" name="triagem_id" value={triagem.id} />
        <Button type="submit" variant="outline" disabled={arquivarPending}>
          {arquivarPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Archive className="h-4 w-4" />
          )}
          Arquivar triagem
        </Button>
        <ErrorMessage message={arquivarState.message} />
      </form>
    </article>
  );
}
