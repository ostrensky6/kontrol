"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, ChevronRight } from "lucide-react";

import { totalPendencias } from "@/components/dashboard/aguardando";
import { useAvisos } from "@/components/layout/AvisosContexto";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

/**
 * Sino da barra do topo: junta "Aguardando você" e as notificações não lidas
 * num lugar só, visível em todas as telas (revisão de 11/11, L2, F8 e F9).
 */
export function SinoAvisos({ className }: { className?: string }) {
  const { dados, atualizar } = useAvisos();
  const [aberto, setAberto] = useState(false);
  const pendentes = totalPendencias(dados.pendencias);
  const total = pendentes + dados.naoLidos;
  const fechar = () => setAberto(false);

  const rotulo =
    total === 0
      ? "Avisos: nada esperando você"
      : `Avisos: ${plural(pendentes, "pendência", "pendências")} e ${plural(dados.naoLidos, "notificação não lida", "notificações não lidas")}`;

  return (
    <Popover
      open={aberto}
      onOpenChange={(proximo) => {
        setAberto(proximo);
        if (proximo) atualizar();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={rotulo}
          title="Aguardando você e notificações"
          className={cn("relative h-9 w-9 text-muted-foreground hover:text-foreground", className)}
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
          {total > 0 && (
            <span
              aria-hidden="true"
              data-testid="sino-contador"
              className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger-strong px-1 text-[11px] font-semibold leading-none text-white"
            >
              {total > 99 ? "99+" : total}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1.5rem))]">
        <div className="max-h-[70vh] overflow-y-auto">
          <section aria-labelledby="sino-aguardando" className="p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 id="sino-aguardando" className="text-sm font-semibold text-foreground">Aguardando você</h2>
              {pendentes > 0 && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold tabular-nums text-primary-foreground">
                  {pendentes}
                </span>
              )}
            </div>
            {dados.pendencias.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Nada esperando a sua ação agora.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {dados.pendencias.map((p) => (
                  <li key={p.chave} className="rounded-md border border-border/70">
                    <Link
                      href={p.href}
                      onClick={fechar}
                      className="flex items-center justify-between gap-3 rounded-t-md px-3 py-2 hover:bg-primary/5"
                      aria-label={`${p.titulo}: ${p.quantidade}. Ver a lista`}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">{p.titulo}</span>
                        <span className="block text-xs text-muted-foreground">{p.acao}</span>
                      </span>
                      <span className="shrink-0 text-lg font-semibold tabular-nums text-foreground">{p.quantidade}</span>
                    </Link>
                    {p.itens.length > 0 && (
                      <ul className="border-t border-border/60 py-1">
                        {p.itens.map((item) => (
                          <li key={`${item.id}-${item.rotulo}`}>
                            <Link
                              href={item.href}
                              onClick={fechar}
                              title={item.rotulo}
                              className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-primary/5 hover:text-primary"
                            >
                              <span className="min-w-0 truncate">{item.rotulo}</span>
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="sino-notificacoes" className="border-t border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 id="sino-notificacoes" className="text-sm font-semibold text-foreground">Notificações</h2>
              {dados.naoLidos > 0 && (
                <span className="text-xs text-muted-foreground">{plural(dados.naoLidos, "não lida", "não lidas")}</span>
              )}
            </div>
            {dados.avisos.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Nenhum aviso novo.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {dados.avisos.map((aviso) => (
                  <li key={aviso.id}>
                    <Link
                      href={aviso.href ?? "/notificacoes"}
                      onClick={fechar}
                      className="block rounded-md px-3 py-2 hover:bg-primary/5"
                    >
                      <span className="block text-sm font-medium text-foreground">{aviso.titulo}</span>
                      {aviso.corpo && <span className="line-clamp-2 block text-xs text-muted-foreground">{aviso.corpo}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/notificacoes"
              onClick={fechar}
              className="mt-2 inline-flex min-h-9 items-center text-sm font-medium text-primary hover:underline"
            >
              Ver todas as notificações
            </Link>
          </section>
        </div>
      </PopoverContent>
    </Popover>
  );
}
