"use client";

import { useActionState } from "react";
import { KontrolLogo } from "@/components/brand/KontrolLogo";
import { entrar, solicitarRedefinicaoSenha } from "@/lib/actions/auth";
import { SENHA_PROVISORIA } from "@/lib/auth/senha-provisoria";
import type { FormState } from "@/lib/actions/cadastros";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

export default function LoginPage() {
  const [state, action, pending] = useActionState<FormState, FormData>(entrar, {
    ok: false,
  });
  const [resetState, resetAction, resetPending] = useActionState<FormState, FormData>(
    solicitarRedefinicaoSenha,
    { ok: false },
  );

  return (
    <main className="app-canvas flex min-h-dvh items-center justify-center px-4 py-8 font-sans sm:px-6">
      <div className="w-full max-w-sm">
        <div className="mb-3 flex justify-end">
          <ThemeToggle />
        </div>
        <section
          aria-labelledby="login-title"
          className="rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-xl shadow-slate-950/10 dark:shadow-black/30"
        >
          <div className="flex justify-center">
            <KontrolLogo
              className="h-auto w-52 max-w-full object-contain"
              fetchPriority="high"
            />
          </div>
          <h1
            id="login-title"
            className="mt-6 text-center text-xl font-semibold tracking-tight text-foreground"
          >
            Acesse sua conta
          </h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">
            Entre com o e-mail cadastrado e sua senha.
          </p>

          <div
            id="senha-provisoria"
            className="mt-5 rounded-xl bg-info-soft px-4 py-3 text-info-strong"
          >
            <p className="text-xs font-semibold">Primeiro acesso</p>
            <p className="mt-1 text-sm leading-5">
              Se o administrador cadastrou seu usuário, entre com a senha provisória{" "}
              <code className="rounded bg-card px-1.5 py-0.5 font-mono font-semibold">
                {SENHA_PROVISORIA}
              </code>
              . Ela deixa de valer depois que você define sua senha pessoal.
            </p>
          </div>

          <form action={action} {...formularioSemPerda(state)} aria-busy={pending} className="mt-5 space-y-4">
            <div>
              <label
                htmlFor="login-email"
                className="block text-xs font-medium text-muted-foreground"
              >
                E-mail
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                inputMode="email"
                spellCheck={false}
                disabled={pending}
                required
                className="mt-1.5 h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div>
              <label
                htmlFor="login-senha"
                className="block text-xs font-medium text-muted-foreground"
              >
                Senha
              </label>
              <input
                id="login-senha"
                name="senha"
                type="password"
                autoComplete="current-password"
                aria-describedby="senha-provisoria"
                disabled={pending}
                required
                className="mt-1.5 h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            {state.message && (
              <p
                role="alert"
                className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong"
              >
                {state.message}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              aria-busy={pending}
              className="h-11 w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Entrando…" : "Entrar"}
            </button>
          </form>

          <form
            action={resetAction}
            {...formularioSemPerda(resetState)}
            aria-busy={resetPending}
            className="mt-5 rounded-xl border border-border bg-muted/50 p-4"
          >
            <label
              htmlFor="reset-email"
              className="block text-xs font-medium text-muted-foreground"
            >
              Recuperar acesso
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                id="reset-email"
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                inputMode="email"
                spellCheck={false}
                disabled={resetPending}
                placeholder="seu@email.com"
                className="h-11 min-w-0 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:flex-1"
              />
              <button
                type="submit"
                disabled={resetPending}
                aria-busy={resetPending}
                className="h-11 rounded-md border border-input bg-card px-4 py-2 text-xs font-semibold text-foreground shadow-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {resetPending ? "Enviando…" : "Enviar link"}
              </button>
            </div>
            {resetState.message && (
              <p
                role={resetState.ok ? "status" : "alert"}
                className={
                  resetState.ok
                    ? "mt-2 text-xs text-brand-700 dark:text-brand-300"
                    : "mt-2 text-xs text-danger-strong"
                }
              >
                {resetState.message}
              </p>
            )}
          </form>
        </section>
      </div>
    </main>
  );
}
