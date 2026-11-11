"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

/**
 * A lista é o que se consulta todo dia; criar é eventual (revisão de 11/11,
 * L14). O formulário de criação fica atrás de um botão no cabeçalho e abre
 * logo abaixo dele, com o foco no primeiro campo. Fechado, o formulário segue
 * montado: mensagem de retorno e senha provisória não se perdem.
 */
export function CriarPorBotao({
  rotulo,
  cabecalho,
  children,
  abertoInicial = false,
}: {
  /** texto do botão, sem o "+": "Novo plano" */
  rotulo: string;
  /** título e ajuda da página, à esquerda do botão */
  cabecalho: React.ReactNode;
  children: React.ReactNode;
  abertoInicial?: boolean;
}) {
  const [aberto, setAberto] = useState(abertoInicial);
  const painelId = useId();
  const painel = useRef<HTMLDivElement>(null);
  const abriuPeloBotao = useRef(false);

  useEffect(() => {
    if (!aberto || !abriuPeloBotao.current) return;
    painel.current
      ?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])")
      ?.focus();
  }, [aberto]);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {cabecalho}
        <button
          type="button"
          aria-expanded={aberto}
          aria-controls={painelId}
          aria-label={aberto ? `Fechar: ${rotulo}` : undefined}
          onClick={() => {
            abriuPeloBotao.current = true;
            setAberto((valor) => !valor);
          }}
          className={
            aberto
              ? "inline-flex min-h-9 items-center gap-1.5 rounded-md border border-input bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
              : "inline-flex min-h-9 items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          }
        >
          {aberto ? <X className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          {aberto ? "Fechar" : rotulo}
        </button>
      </div>
      <div id={painelId} ref={painel} hidden={!aberto} className="mt-4">
        {children}
      </div>
    </>
  );
}
