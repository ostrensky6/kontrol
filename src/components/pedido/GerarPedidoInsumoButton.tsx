"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ShoppingCart } from "lucide-react";

import type { FormState } from "@/lib/actions/cadastros";
import { gerarPedidoReposicaoInsumo } from "@/lib/actions/pedidos-internos";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

/**
 * Pedido de reposição de um insumo só, em rascunho. Fica na ficha do insumo
 * (antes ficava no cartão do Controle de Estoque); a reposição de todos os
 * insumos de uma vez é o botão da Situação do estoque (D6).
 */
export function GerarPedidoInsumoButton({ insumoId }: { insumoId: number }) {
  const [state, action, pending] = useActionState<FormState & { pedidoId?: number }, FormData>(
    gerarPedidoReposicaoInsumo,
    { ok: false },
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={action} {...formularioSemPerda(state)}>
        <input type="hidden" name="insumo_id" value={insumoId} />
        <button
          disabled={pending}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          <ShoppingCart className="h-4 w-4" aria-hidden="true" />
          {pending ? "Abrindo…" : "Pedir reposição"}
        </button>
      </form>
      {state.message && (
        <p role="status" className={`max-w-64 text-right text-xs ${state.ok ? "text-success-strong" : "text-danger-strong"}`}>
          {state.message}
          {state.ok && state.pedidoId ? (
            <>
              {" "}
              <Link href={`/pedido/${state.pedidoId}`} className="font-semibold underline">
                Ver pedido
              </Link>
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}
