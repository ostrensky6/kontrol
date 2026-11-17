"use client";

import { useActionState, useEffect, useState } from "react";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HelpTip } from "@/components/common/HelpTip";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import { DarBaixaDialog } from "@/components/estoque/DarBaixaDialog";
import type { LoteBaixa } from "@/lib/estoque/baixa";
import { type FormState } from "@/lib/actions/cadastros";
import { corrigirQuantidadeEmbalagens } from "@/lib/actions/estoque";
import { cn } from "@/lib/utils";
import { formatDate, formatNumber } from "@/lib/formatters";

const ROTULO_STATUS_LOTE: Record<string, string> = {
  quarentena: "Quarentena",
  aceito: "Disponível",
  em_uso: "Em uso",
  bloqueado: "Bloqueado",
};

/** Seção "Lotes" da edição do insumo: saldo por lote, entrada de novo lote e saída. */
export function LotesInsumoResumo({
  insumoId,
  especificacao,
  unidade,
  quantidadeAtual,
  podeCorrigirQuantidade,
  podeMovimentar,
  lotes,
}: {
  insumoId: number;
  especificacao: string;
  unidade: string | null;
  quantidadeAtual: number;
  /** modelo de embalagens e permissão "estoque.lote.gerir" */
  podeCorrigirQuantidade: boolean;
  /** permissão "estoque.movimentar": + Entrada e Dar baixa */
  podeMovimentar: boolean;
  lotes: LoteBaixa[];
}) {
  const [corrigindo, setCorrigindo] = useState(false);

  return (
    <section className="mt-4 rounded-md border border-border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-semibold">Lotes em estoque</h3>
          <HelpTip title="Lotes do insumo">
            <p>
              Cada chegada vira um lote, com número, validade e saldo próprios. O uso segue{" "}
              <b>FEFO</b>: o lote que vence primeiro sai primeiro.
            </p>
            <p>
              <b>Registrar chegada</b> cria um lote novo. <b>Dar baixa</b> retira material com motivo,
              que fica no histórico do lote.
            </p>
          </HelpTip>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {podeMovimentar && (
            <>
              <Button asChild size="sm" variant="outline">
                <a href={`/estoque?entrada=${insumoId}`}>Registrar chegada</a>
              </Button>
              <DarBaixaDialog
                lotes={lotes}
                unidade={unidade ?? ""}
                especificacao={especificacao}
                mostrarIndisponivel={false}
                triggerClassName="inline-flex h-8 items-center rounded-md border border-danger-strong/40 bg-card px-3 text-xs font-medium text-danger-strong hover:bg-danger-soft"
              />
            </>
          )}
          {podeCorrigirQuantidade && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setCorrigindo(true)}>
              Corrigir quantidade
            </Button>
          )}
        </div>
      </div>

      {lotes.length > 0 ? (
        <ul className="mt-2 divide-y divide-border rounded-md border border-border bg-card text-xs">
          {lotes.slice(0, 6).map((lote) => (
            <li key={lote.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2.5 py-1.5">
              <a
                href={`/estoque/lotes/${lote.id}`}
                className="font-medium text-brand-700 hover:underline dark:text-brand-300"
              >
                Lote {lote.codigoLote}
              </a>
              <span className="text-muted-foreground">
                validade {lote.validade ? formatDate(lote.validade) : "—"}
              </span>
              <span className="tabular-nums">
                {formatNumber(lote.quantidadeAtual)} {lote.modeloQuantidade === "EMBALAGEM_FECHADA" ? "emb." : unidade ?? ""}
              </span>
              <Badge variant="muted">{ROTULO_STATUS_LOTE[lote.status] ?? lote.status}</Badge>
            </li>
          ))}
          {lotes.length > 6 && (
            <li className="px-2.5 py-1.5 text-muted-foreground">
              +{lotes.length - 6} lote(s) — veja todos em Estoque.
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Nenhum lote com saldo. Quantidade atual: {quantidadeAtual}.
        </p>
      )}

      {podeCorrigirQuantidade && corrigindo && (
        <CorrigirQuantidadeDialog
          open={corrigindo}
          onOpenChange={setCorrigindo}
          insumoId={insumoId}
          quantidadeAtual={quantidadeAtual}
        />
      )}
    </section>
  );
}

function CorrigirQuantidadeDialog({
  open,
  onOpenChange,
  insumoId,
  quantidadeAtual,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  insumoId: number;
  quantidadeAtual: number;
}) {
  const router = useRouter();
  // o diálogo monta a cada abertura: cada correção é uma operação nova
  const [operacaoId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState<FormState, FormData>(
    corrigirQuantidadeEmbalagens,
    { ok: false },
  );

  useEffect(() => {
    if (!state.ok) return;
    router.refresh();
    onOpenChange(false);
  }, [state.ok, router, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-w-sm" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Corrigir quantidade</DialogTitle>
          <DialogDescription>
            Requer papel coordenador ou superior. A diferença fica registrada com o motivo informado
            — não sobrescreve o histórico.
          </DialogDescription>
        </DialogHeader>

        <form action={action} {...formularioSemPerda(state)} className="mt-2 grid gap-3">
          <input type="hidden" name="insumo_id" value={insumoId} />
          <input type="hidden" name="operacao_id" value={operacaoId} />
          <div>
            <Label htmlFor="corrigir-quantidade_alvo" className="block">Quantidade correta (embalagens fechadas)</Label>
            <Input
              id="corrigir-quantidade_alvo"
              name="quantidade_alvo"
              type="number"
              min={0}
              step="1"
              defaultValue={quantidadeAtual}
              className={cn(
                "mt-1",
                state.errors?.quantidade_alvo && "border-destructive focus-visible:ring-destructive",
              )}
            />
            {state.errors?.quantidade_alvo && (
              <p className="mt-1 text-xs text-destructive">{state.errors.quantidade_alvo}</p>
            )}
          </div>
          <div>
            <Label htmlFor="corrigir-motivo" className="block">Motivo</Label>
            <Input
              id="corrigir-motivo"
              name="motivo"
              required
              placeholder="Ex.: contagem física divergente do cadastro"
              className={cn(
                "mt-1",
                state.errors?.motivo && "border-destructive focus-visible:ring-destructive",
              )}
            />
            {state.errors?.motivo && (
              <p className="mt-1 text-xs text-destructive">{state.errors.motivo}</p>
            )}
          </div>

          <MensagemAcao estado={state.ok ? null : state} className="rounded-md bg-destructive/10 px-3 py-2 text-xs" />

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Voltar
            </Button>
            <SubmitButton size="sm" pendingLabel="Corrigindo…">
              Corrigir
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
