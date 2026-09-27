"use client";

import { useActionState } from "react";
import { Archive } from "lucide-react";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import {
  executarBackupAplicativo,
  type BackupActionState,
} from "@/lib/actions/backups";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

const initialState: BackupActionState = {
  ok: false,
  message: "",
};

export function BackupAplicativoButton() {
  const [state, action, pending] = useActionState(
    executarBackupAplicativo,
    initialState,
  );

  return (
    <div className="space-y-3">
      <form action={action} {...formularioSemPerda(state)}>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending || undefined}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Archive className="h-4 w-4" aria-hidden="true" />
          {pending ? "Gerando backup…" : "Fazer backup do aplicativo"}
        </button>
      </form>

      <MensagemAcao estado={state} />
    </div>
  );
}
