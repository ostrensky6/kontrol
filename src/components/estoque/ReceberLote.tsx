"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { entradaEmbalagens, entradaInventario } from "@/lib/actions/estoque";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import type { FormState } from "@/lib/actions/cadastros";
import { enviarSemReset } from "@/lib/formulario-sem-perda";

/**
 * 2.4 — Entrada de inventário / ajuste (porta avulsa, separada do recebimento
 * de compra). O recebimento normal acontece no item do pedido de compra.
 */
export function AjusteInventarioButton({
  insumoId,
  especificacao,
  unidade,
  abertoInicial = false,
  embalagemFechada = false,
  emFrascos = false,
  triggerLabel = "+ Entrada",
  triggerClassName,
}: {
  insumoId: number;
  especificacao?: string;
  unidade?: string | null;
  abertoInicial?: boolean;
  /** insumo contado em embalagens fechadas: o lote entra liberado, em número inteiro */
  embalagemFechada?: boolean;
  /** insumo contado em frascos (ainda sem lote de frascos): a entrada vai em quarentena, em frascos inteiros */
  emFrascos?: boolean;
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(abertoInicial);
  const [state, setState] = useState<FormState>({ ok: false });
  const [pending, startTransition] = useTransition();
  const [operacaoId, setOperacaoId] = useState(() => crypto.randomUUID());

  function fechar() {
    setAberto(false);
    setState({ ok: false });
    setOperacaoId(crypto.randomUUID());
    if (abertoInicial) router.replace("/estoque");
  }

  function action(formData: FormData) {
    startTransition(async () => {
      const res = embalagemFechada
        ? await entradaEmbalagens({ ok: false }, formData)
        : await entradaInventario({ ok: false }, formData);
      setState(res);
      if (res.ok && !abertoInicial) router.refresh();
    });
  }

  const inp =
    "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className={
          triggerClassName ??
          "rounded px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/30"
        }
      >
        {triggerLabel}
      </button>

      {aberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 text-left">
          <div className="absolute inset-0 bg-black/40" onClick={() => !pending && fechar()} />
          <div className="relative w-full max-w-md rounded-xl bg-card p-5 shadow-xl">
            <div className="flex items-center gap-1">
              <h3 className="text-base font-semibold">{embalagemFechada ? "Entrada de lote" : "Entrada de inventário"}</h3>
              <HelpTip title="Quando usar esta entrada">
                <p>
                  Para contagem, doação ou correção de inventário. Material comprado deve ser recebido
                  pelo item do pedido, em <b>Compras</b>, para fechar o pedido.
                </p>
                <p>
                  {embalagemFechada
                    ? "O lote entra liberado para uso, contado em embalagens fechadas."
                    : "O lote entra em quarentena e só fica disponível depois de aceito."}
                </p>
                <HelpExample>
                  Doação de 2 kits → quantidade 2, motivo “doação” e o número do lote impresso no kit.
                </HelpExample>
              </HelpTip>
            </div>
            {(especificacao || unidade) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {especificacao}
                {unidade ? ` · ${unidade}` : ""}
              </p>
            )}

            {state.ok ? (
              <div className="mt-4 space-y-4">
                <div
                  role="status"
                  aria-live="polite"
                  className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-800 dark:bg-brand-950/50 dark:text-brand-300"
                >
                  <p>{state.message ?? "Entrada registrada em quarentena."}</p>
                  {!embalagemFechada && (
                    <p className="mt-1 text-xs">Falta aceitar o lote para liberar o uso.</p>
                  )}
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={fechar}
                    className="min-h-11 rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
                  >
                    Fechar
                  </button>
                  <Link
                    href="/estoque"
                    className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
                  >
                    Revisar no Estoque
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={enviarSemReset(action)} className="mt-4 grid grid-cols-2 gap-3">
                <input type="hidden" name="insumo_id" value={insumoId} />
                <input type="hidden" name="operacao_id" value={operacaoId} />
                <div className="col-span-1">
                  <label htmlFor={`entrada-qtd-${insumoId}`} className="block text-xs font-medium text-muted-foreground">
                    {embalagemFechada ? "Embalagens" : emFrascos ? "Frascos" : "Quantidade"} <span className="text-danger-strong">*</span>
                  </label>
                  <input
                    id={`entrada-qtd-${insumoId}`}
                    name="quantidade"
                    type="number"
                    inputMode={embalagemFechada || emFrascos ? "numeric" : "decimal"}
                    step={embalagemFechada || emFrascos ? "1" : "any"}
                    min="0"
                    className={inp}
                  />
                  {state.errors?.quantidade && (
                    <p className="mt-1 text-xs text-danger-strong">{state.errors.quantidade}</p>
                  )}
                </div>
                <div className="col-span-1">
                  <label htmlFor={`entrada-val-${insumoId}`} className="block text-xs font-medium text-muted-foreground">
                    Validade
                  </label>
                  <input id={`entrada-val-${insumoId}`} name="validade" type="date" className={inp} />
                  {state.errors?.validade && (
                    <p className="mt-1 text-xs text-danger-strong">{state.errors.validade}</p>
                  )}
                </div>
                <div className="col-span-1">
                  <label htmlFor={`entrada-custo-${insumoId}`} className="block text-xs font-medium text-muted-foreground">
                    {embalagemFechada ? "Custo por embalagem (R$)" : emFrascos ? "Custo por frasco (R$)" : "Custo unitário (R$)"}
                    {embalagemFechada && <span className="text-danger-strong"> *</span>}
                  </label>
                  <input
                    id={`entrada-custo-${insumoId}`}
                    name="custo"
                    type="number"
                    inputMode="decimal"
                    step="0.0001"
                    min="0"
                    className={inp}
                  />
                  {state.errors?.custo && (
                    <p className="mt-1 text-xs text-danger-strong">{state.errors.custo}</p>
                  )}
                </div>
                <div className="col-span-1">
                  <label htmlFor={`entrada-lote-${insumoId}`} className="block text-xs font-medium text-muted-foreground">
                    Número do lote
                  </label>
                  <input
                    id={`entrada-lote-${insumoId}`}
                    name="codigo"
                    type="text"
                    maxLength={80}
                    placeholder="Ex.: 24B1187"
                    autoComplete="off"
                    className={inp}
                  />
                </div>
                <div className="col-span-2">
                  <label htmlFor={`entrada-forn-${insumoId}`} className="block text-xs font-medium text-muted-foreground">
                    Fornecedor
                  </label>
                  <input id={`entrada-forn-${insumoId}`} name="fornecedor" type="text" className={inp} />
                </div>
                <div className="col-span-2">
                  <label htmlFor={`entrada-motivo-${insumoId}`} className="block text-xs font-medium text-muted-foreground">
                    Motivo {embalagemFechada && <span className="text-danger-strong">*</span>}
                  </label>
                  <input
                    id={`entrada-motivo-${insumoId}`}
                    name="motivo"
                    type="text"
                    placeholder="Ex.: contagem cíclica, doação, correção"
                    className={inp}
                  />
                  {state.errors?.motivo && (
                    <p className="mt-1 text-xs text-danger-strong">{state.errors.motivo}</p>
                  )}
                </div>

                {state.message && (
                  <p
                    role="alert"
                    className="col-span-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong"
                  >
                    {state.message}
                  </p>
                )}

                <div className="col-span-2 mt-1 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={fechar}
                    className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                  >
                    Cancelar
                  </button>
                  <button
                    disabled={pending}
                    aria-busy={pending || undefined}
                    className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
                  >
                    {pending ? "Registrando…" : "Registrar entrada"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
