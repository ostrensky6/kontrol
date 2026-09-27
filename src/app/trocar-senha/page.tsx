"use client";

import { useActionState } from "react";
import { KontrolLogo } from "@/components/brand/KontrolLogo";
import { definirSenhaDefinitiva, sair } from "@/lib/actions/auth";
import type { FormState } from "@/lib/actions/cadastros";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

export default function TrocarSenhaPage() {
  const [state, action, pending] = useActionState<FormState, FormData>(definirSenhaDefinitiva, {
    ok: false,
  });

  return (
    <div className="app-canvas flex min-h-dvh items-center justify-center px-6 font-sans">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-lg ring-1 ring-foreground/5">
        <div className="flex justify-center">
          <KontrolLogo
            className="h-auto w-52 object-contain"
            fetchPriority="high"
          />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-foreground">Defina sua senha</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Você entrou com uma senha provisória. Crie uma senha definitiva para continuar.
        </p>

        <form action={action} {...formularioSemPerda(state)} className="mt-6 space-y-4">
          <div>
            <label htmlFor="nova-senha" className="block text-xs font-medium text-muted-foreground">Nova senha</label>
            <input
              id="nova-senha"
              name="senha"
              type="password"
              autoComplete="new-password"
              className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="confirmar-senha" className="block text-xs font-medium text-muted-foreground">Confirmar senha</label>
            <input
              id="confirmar-senha"
              name="confirmar"
              type="password"
              autoComplete="new-password"
              className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
            />
          </div>

          <MensagemAcao estado={state} />

          <button
            disabled={pending}
            aria-busy={pending || undefined}
            className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {pending ? "Salvando…" : "Salvar e continuar"}
          </button>
        </form>

        <form action={sair} className="mt-4">
          <button className="w-full text-xs text-muted-foreground hover:text-foreground">
            Sair
          </button>
        </form>
      </div>
    </div>
  );
}
