"use client";

import { useActionState, useState } from "react";

import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import { FormEstado } from "@/components/orcamento/FormEstado";
import { ESTADO_INICIAL, type EstadoAcao } from "@/lib/erros";
import { formatDateTime } from "@/lib/formatters";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

export type EstadoLinkPublico = EstadoAcao & { caminho?: string };

export type LinkPublicoResumo = {
  id: number;
  criado_em: string;
  revogado: boolean;
  aprovado_em: string | null;
  aprovado_por: string | null;
};

/**
 * Link público de aprovação da proposta (funcionalidade do app antigo,
 * restaurada — ORC-2). O endereço completo só aparece uma vez, ao criar: o
 * banco guarda apenas o resumo (hash) do código.
 */
export function LinkPublicoPainel({
  versaoId,
  links,
  podeCriar,
  motivoSemLink,
  criar,
  revogar,
}: {
  versaoId: number;
  links: LinkPublicoResumo[];
  podeCriar: boolean;
  motivoSemLink?: string | null;
  criar: (estado: EstadoLinkPublico, formData: FormData) => Promise<EstadoLinkPublico>;
  revogar: (estado: EstadoAcao, formData: FormData) => Promise<EstadoAcao>;
}) {
  const [estado, enviar] = useActionState(criar, ESTADO_INICIAL as EstadoLinkPublico);
  const [copiado, setCopiado] = useState(false);
  const endereco = estado.caminho && typeof window !== "undefined" ? `${window.location.origin}${estado.caminho}` : estado.caminho;

  async function copiar() {
    if (!endereco) return;
    try {
      await navigator.clipboard.writeText(endereco);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <div className="grid gap-3">
      {podeCriar ? (
        <form action={enviar} {...formularioSemPerda(estado)} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="versao_id" value={versaoId} />
          <SubmitButton size="sm" pendingLabel="Criando…">Criar link de aprovação</SubmitButton>
          <MensagemAcao estado={estado.ok ? { ok: true } : estado} />
        </form>
      ) : (
        motivoSemLink && <p className="text-xs text-muted-foreground">{motivoSemLink}</p>
      )}

      {estado.ok && endereco && (
        <div className="grid gap-2 rounded-md border border-brand-200 bg-brand-50 p-3 text-sm dark:border-brand-900 dark:bg-brand-950/30">
          <p className="font-medium">Link criado. Copie agora: por segurança ele não aparece de novo.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={endereco}
              aria-label="Endereço do link de aprovação"
              className="min-w-0 flex-1 rounded-md border border-input bg-card px-2 py-1 font-mono text-xs"
              onFocus={(evento) => evento.currentTarget.select()}
            />
            <button type="button" onClick={copiar} className="rounded-md border border-input px-3 py-1 text-xs font-medium hover:bg-muted">
              {copiado ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>
      )}

      {links.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {links.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div>
                <p className="font-medium">Link #{link.id}</p>
                <p className="text-xs text-muted-foreground">
                  Criado em {formatDateTime(link.criado_em)}
                  {link.aprovado_em
                    ? ` · aprovado por ${link.aprovado_por ?? "cliente"} em ${formatDateTime(link.aprovado_em)}`
                    : link.revogado
                      ? " · revogado"
                      : " · ativo"}
                </p>
              </div>
              {!link.revogado && !link.aprovado_em && (
                <FormEstado action={revogar} className="flex items-center gap-2" mensagemClassName="text-xs">
                  <input type="hidden" name="versao_id" value={versaoId} />
                  <input type="hidden" name="link_id" value={link.id} />
                  <SubmitButton size="sm" variant="outline" pendingLabel="Revogando…">Revogar</SubmitButton>
                </FormEstado>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
