"use client";

import { useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { LockOpen } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormAcao, type AcaoFormulario } from "./FormAcao";

function Reabrir({ reformulacao }: { reformulacao: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-60"
    >
      {pending ? "Reabrindo…" : reformulacao ? "Reabrir para reformular" : "Reabrir revisão"}
    </button>
  );
}

/**
 * Reabre a revisão dos custos (0139, DC4). Com proposta aprovada é reformulação: pede o motivo
 * (cliente ou órgão concedente) e avisa que a nova versão, aprovada, substitui a atual.
 */
export function ReabrirRevisaoDialog({
  orcamentoProjetoId,
  demandaId,
  versaoAprovada,
  action,
}: {
  orcamentoProjetoId: number;
  demandaId: number;
  /** Número da versão aprovada da proposta, se houver (reabrir vira reformulação). */
  versaoAprovada: string | null;
  action: AcaoFormulario;
}) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  const reformulacao = Boolean(versaoAprovada);

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          <LockOpen className="size-4" aria-hidden />
          {reformulacao ? "Reformular (reabrir)" : "Reabrir revisão"}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg text-left">
        <DialogHeader>
          <DialogTitle>{reformulacao ? "Reformular a proposta aprovada" : "Reabrir a revisão dos custos"}</DialogTitle>
          <DialogDescription>
            {reformulacao
              ? `A proposta ${versaoAprovada} está aprovada. Os custos voltam para edição; depois de concluir, emita a nova versão. Quando ela for aprovada, substitui a ${versaoAprovada}, que fica no histórico.`
              : "Os custos voltam para edição. Depois é preciso concluir a revisão de novo."}
          </DialogDescription>
        </DialogHeader>
        <FormAcao action={action} aoConcluir={() => setAberto(false)} className="grid gap-3">
          <input type="hidden" name="orcamento_projeto_id" value={orcamentoProjetoId} />
          <input type="hidden" name="demanda_id" value={demandaId} />
          <div>
            <label htmlFor={`${id}-motivo`} className="block text-xs font-medium text-muted-foreground">
              Motivo {reformulacao ? <span className="text-danger-strong">*</span> : "(opcional)"}
            </label>
            <textarea
              id={`${id}-motivo`}
              name="motivo"
              required={reformulacao}
              minLength={reformulacao ? 5 : undefined}
              placeholder={reformulacao ? "Ex.: órgão concedente pediu corte de 10% em viagens" : undefined}
              className="mt-1 block min-h-16 w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm"
            />
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="rounded-md border border-input px-4 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Cancelar
            </button>
            <Reabrir reformulacao={reformulacao} />
          </DialogFooter>
        </FormAcao>
      </DialogContent>
    </Dialog>
  );
}
