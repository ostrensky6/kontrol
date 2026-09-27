"use client";

import { useLayoutEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { entradaEmbalagens, entradaInventario } from "@/lib/actions/estoque";
import { HelpExample, HelpTip } from "@/components/common/HelpTip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const quantidadeRef = useRef<HTMLInputElement>(null);

  // A linha do saldo existe duas vezes (tabela no computador, cartão no
  // celular) e só uma fica visível. O diálogo vai para um portal: no link
  // direto (?entrada=ID) a cópia escondida abriria por cima da visível.
  // Até medir qual cópia está na tela, nenhuma das duas abre.
  const [copiaMedida, setCopiaMedida] = useState(!abertoInicial);
  useLayoutEffect(() => {
    if (!abertoInicial) return;
    if (triggerRef.current?.getClientRects().length === 0) setAberto(false);
    // medição de layout antes da pintura: é o uso previsto de useLayoutEffect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCopiaMedida(true);
  }, [abertoInicial]);

  function fechar() {
    setAberto(false);
    setState({ ok: false });
    setOperacaoId(crypto.randomUUID());
    if (abertoInicial) router.replace("/estoque");
  }

  function alternar(abrir: boolean) {
    if (abrir) setAberto(true);
    // Esc, clique fora: não fecha no meio do registro
    else if (!pending) fechar();
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
  const erros = state.errors ?? {};
  // liga a mensagem de erro ao campo (leitor de tela anuncia junto com o rótulo)
  const campoComErro = (campo: string, id: string) =>
    erros[campo] ? { "aria-invalid": true, "aria-describedby": `${id}-erro` } : {};
  const temDescricao = Boolean(especificacao || unidade);

  return (
    <Dialog open={aberto && copiaMedida} onOpenChange={alternar}>
      <DialogTrigger asChild>
        <button
          type="button"
          ref={triggerRef}
          className={
            triggerClassName ??
            "rounded px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/30"
          }
        >
          {triggerLabel}
        </button>
      </DialogTrigger>

      <DialogContent
        className="max-h-[92dvh] max-w-md gap-0 overflow-y-auto rounded-xl text-left"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          // foco no primeiro campo, não no "?" de ajuda ao lado do título
          if (!quantidadeRef.current) return;
          event.preventDefault();
          quantidadeRef.current.focus();
        }}
        {...(temDescricao ? {} : { "aria-describedby": undefined })}
      >
        <DialogHeader className="gap-0">
          <div className="flex items-center gap-1">
            <DialogTitle>{embalagemFechada ? "Entrada de lote" : "Entrada de inventário"}</DialogTitle>
            <HelpTip title="Quando usar esta entrada">
              <p>
                Para contagem, doação ou correção de inventário. Material comprado deve ser recebido
                pelo item do pedido, em <b>Compras</b>, para fechar o pedido.
              </p>
              <p>
                {embalagemFechada
                  ? "O lote entra disponível para uso, contado em frascos fechados."
                  : "O lote entra disponível para uso assim que a entrada é registrada."}
              </p>
              <HelpExample>
                Doação de 2 kits → quantidade 2, motivo “doação” e o número do lote impresso no kit.
              </HelpExample>
            </HelpTip>
          </div>
          {temDescricao && (
            <DialogDescription className="mt-1 text-xs">
              {especificacao}
              {unidade ? ` · ${unidade}` : ""}
            </DialogDescription>
          )}
        </DialogHeader>

        {state.ok ? (
          <div className="mt-4 space-y-4">
            <div
              role="status"
              aria-live="polite"
              className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-800 dark:bg-brand-950/50 dark:text-brand-300"
            >
              <p>{state.message ?? "Entrada registrada: o lote já está disponível."}</p>
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
                ref={quantidadeRef}
                id={`entrada-qtd-${insumoId}`}
                name="quantidade"
                type="number"
                inputMode={embalagemFechada || emFrascos ? "numeric" : "decimal"}
                step={embalagemFechada || emFrascos ? "1" : "any"}
                min="0"
                className={inp}
                {...campoComErro("quantidade", `entrada-qtd-${insumoId}`)}
              />
              {erros.quantidade && (
                <p id={`entrada-qtd-${insumoId}-erro`} className="mt-1 text-xs text-danger-strong">
                  {erros.quantidade}
                </p>
              )}
            </div>
            <div className="col-span-1">
              <label htmlFor={`entrada-val-${insumoId}`} className="block text-xs font-medium text-muted-foreground">
                Validade
              </label>
              <input
                id={`entrada-val-${insumoId}`}
                name="validade"
                type="date"
                className={inp}
                {...campoComErro("validade", `entrada-val-${insumoId}`)}
              />
              {erros.validade && (
                <p id={`entrada-val-${insumoId}-erro`} className="mt-1 text-xs text-danger-strong">
                  {erros.validade}
                </p>
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
                {...campoComErro("custo", `entrada-custo-${insumoId}`)}
              />
              {erros.custo && (
                <p id={`entrada-custo-${insumoId}-erro`} className="mt-1 text-xs text-danger-strong">
                  {erros.custo}
                </p>
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
                {...campoComErro("motivo", `entrada-motivo-${insumoId}`)}
              />
              {erros.motivo && (
                <p id={`entrada-motivo-${insumoId}-erro`} className="mt-1 text-xs text-danger-strong">
                  {erros.motivo}
                </p>
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
      </DialogContent>
    </Dialog>
  );
}
