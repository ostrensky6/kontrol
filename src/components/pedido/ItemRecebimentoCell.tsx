"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, RotateCcw } from "lucide-react";

import { estornarRecebimentoItem, estornarRecebimentoLancamento } from "@/lib/actions/pedidos-internos";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/formatters";
import { ReceberItemPedidoInterno, type ItemRecebivel } from "./ReceberItemPedidoInterno";

type Insumo = { id: number; especificacao: string | null; unidade: string | null };
export type RecebimentoLancamento = {
  id: number;
  loteId: number | null;
  quantidade: number;
  codigoLote: string | null;
  fornecedor: string | null;
  validade: string | null;
  responsavel: string | null;
  recebidoEm: string;
};

export function ItemRecebimentoCell({
  item,
  insumos,
  podeReceber,
  recebidoEm,
  recebidoPor,
  recebimentos = [],
}: {
  item: ItemRecebivel;
  insumos: Insumo[];
  podeReceber: boolean;
  recebidoEm?: string | null;
  recebidoPor?: string | null;
  recebimentos?: RecebimentoLancamento[];
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Estorno tira o lote do estoque: sempre passa por uma confirmação que diz o que será desfeito.
  const [aEstornar, setAEstornar] = useState<{ recebimentoId?: number; resumo: string } | null>(null);
  const quantidadeRecebida = Number(item.quantidadeRecebida ?? 0);
  const parcial = !recebidoEm && quantidadeRecebida > 0;
  const unidade = item.unidade ?? "";

  function pedirEstorno(recebimentoId?: number) {
    const lancamento = recebimentoId ? recebimentos.find((r) => r.id === recebimentoId) : undefined;
    const resumo = lancamento
      ? `${lancamento.quantidade} ${unidade} recebido(s) em ${formatDate(lancamento.recebidoEm)}${
          lancamento.codigoLote ? `, lote ${lancamento.codigoLote}` : ""
        }`
      : `todo o recebimento deste item${recebidoEm ? `, de ${formatDate(recebidoEm)}` : ""}`;
    setErro(null);
    setAEstornar({ recebimentoId, resumo: resumo.replace(/\s+/g, " ").trim() });
  }

  function estornar(recebimentoId?: number) {
    setErro(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("item_id", String(item.id));
      fd.set("pedido_interno_id", String(item.pedidoId));
      if (recebimentoId) fd.set("recebimento_id", String(recebimentoId));
      const action = recebimentoId ? estornarRecebimentoLancamento : estornarRecebimentoItem;
      const res = await action({ ok: false }, fd);
      if (res.ok) router.refresh();
      else setErro(res.message ?? "Falha ao estornar.");
    });
  }

  const confirmacao = (
    <Dialog open={aEstornar != null} onOpenChange={(aberto) => !aberto && setAEstornar(null)}>
      <DialogContent className="max-w-sm text-left" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Estornar recebimento?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                <span className="font-medium text-foreground">{item.especificacao}</span>: {aEstornar?.resumo}.
              </p>
              <p>O lote sai do estoque e o item volta a ficar pendente de recebimento.</p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            type="button"
            onClick={() => setAEstornar(null)}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={() => {
              const alvo = aEstornar;
              setAEstornar(null);
              if (alvo) estornar(alvo.recebimentoId);
            }}
            className="rounded-md bg-destructive px-4 py-1.5 text-sm font-medium text-white hover:bg-destructive/90"
          >
            Estornar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (recebidoEm) {
    const quando = formatDate(recebidoEm);
    return (
      <div className="flex flex-col items-start gap-0.5">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-leaf-700 dark:text-leaf-300">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Recebido {quando}
        </span>
        {recebidoPor && <span className="text-xs text-muted-foreground/80">{recebidoPor}</span>}
        <button
          type="button"
          onClick={() => pedirEstorno()}
          disabled={pending}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-danger-strong hover:underline disabled:opacity-50"
        >
          {pending ? "Estornando…" : "Estornar"}
        </button>
        {recebimentos.length > 0 && (
          <RecebimentosHistorico
            recebimentos={recebimentos}
            unidade={item.unidade}
            pending={pending}
            onEstornar={pedirEstorno}
          />
        )}
        {erro && <span role="alert" className="text-xs text-danger-strong">{erro}</span>}
        {confirmacao}
      </div>
    );
  }

  if (podeReceber) {
    return (
      <div className="flex flex-col items-start gap-1">
        {parcial && (
          <span className="text-[11px] font-medium text-warning-strong">
            Parcial {quantidadeRecebida}/{item.quantidade} {item.unidade ?? ""}
          </span>
        )}
        {recebimentos.length > 0 && (
          <RecebimentosHistorico
            recebimentos={recebimentos}
            unidade={item.unidade}
            pending={pending}
            onEstornar={pedirEstorno}
          />
        )}
        <ReceberItemPedidoInterno item={item} insumos={insumos} />
        {erro && <span role="alert" className="text-xs text-danger-strong">{erro}</span>}
        {confirmacao}
      </div>
    );
  }

  if (item.compraFormalId) {
    return (
      <Link href={`/compras/${item.compraFormalId}`} className="text-xs font-medium text-primary hover:underline">
        Registrar chegada em Compras
      </Link>
    );
  }

  return <span className="text-xs text-muted-foreground/80">aguardando etapa</span>;
}

function RecebimentosHistorico({
  recebimentos,
  unidade,
  pending,
  onEstornar,
}: {
  recebimentos: RecebimentoLancamento[];
  unidade?: string | null;
  pending: boolean;
  onEstornar: (recebimentoId: number) => void;
}) {
  return (
    <div className="mt-1 min-w-44 space-y-1 rounded-md border border-border/70 bg-muted/30 p-2 text-[11px]">
      {recebimentos.map((recebimento) => {
        const quando = formatDate(recebimento.recebidoEm);
        return (
          <div key={recebimento.id} className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium tabular-nums text-foreground">
                {recebimento.quantidade} {unidade ?? ""}
              </p>
              <p className="truncate text-muted-foreground">
                {quando}
                {recebimento.codigoLote ? ` · lote ${recebimento.codigoLote}` : ""}
              </p>
              {(recebimento.fornecedor || recebimento.responsavel) && (
                <p className="truncate text-muted-foreground/80">
                  {recebimento.fornecedor ?? recebimento.responsavel}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onEstornar(recebimento.id)}
              disabled={pending}
              className="rounded p-1 text-muted-foreground hover:bg-background hover:text-danger-strong disabled:opacity-50"
              title="Estornar este lançamento"
              aria-label={`Estornar o lançamento de ${recebimento.quantidade} ${unidade ?? ""} em ${quando}`.replace(/\s+/g, " ")}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
