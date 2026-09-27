"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  aprovarPedido,
  marcarEnviado,
  cancelarPedido,
  encerrarPedidoComPendencia,
} from "@/lib/actions/compras";
import type { FormState } from "@/lib/actions/cadastros";
import { ConfirmSubmitButton } from "@/components/common/ConfirmSubmitButton";
import { SubmitButton } from "@/components/common/SubmitButton";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;
type Confirmacao = { titulo: string; mensagem: string; confirmLabel: string };

function Botao({
  pedidoId,
  action,
  label,
  cls,
  confirmacao,
  motivo,
}: {
  pedidoId: number;
  action: Action;
  label: string;
  cls: string;
  confirmacao?: Confirmacao;
  /** motivo obrigatório (campo dentro do mesmo formulário da confirmação) */
  motivo?: { rotulo: string; placeholder: string };
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<FormState, FormData>(action, { ok: false });
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  return (
    <div className="flex flex-col gap-1">
      <form action={formAction} {...formularioSemPerda(state)} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="pedido_id" value={pedidoId} />
        {motivo && (
          <div>
            <label htmlFor={`motivo-${label}-${pedidoId}`} className="block text-xs text-muted-foreground">
              {motivo.rotulo}
            </label>
            <textarea
              id={`motivo-${label}-${pedidoId}`}
              name="motivo"
              required
              minLength={3}
              rows={1}
              placeholder={motivo.placeholder}
              className="w-64 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
          </div>
        )}
        {confirmacao ? (
          <ConfirmSubmitButton className={cls} destrutivo {...confirmacao}>
            {label}
          </ConfirmSubmitButton>
        ) : (
          <SubmitButton pendingLabel="Processando…" className={cls}>
            {label}
          </SubmitButton>
        )}
      </form>
      {state.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`text-xs ${state.ok ? "text-brand-700 dark:text-brand-400" : "text-danger-strong"}`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}

const DESTINOS = [
  {
    valor: "nova_compra",
    rotulo: "Comprar de novo",
    descricao: "Cria agora uma compra com o que faltou, ligada a esta, aguardando aprovação.",
  },
  {
    valor: "desistencia",
    rotulo: "Desistir",
    descricao: "Não vamos mais comprar. Se o estoque precisar, a reposição volta a sugerir.",
  },
  {
    valor: "atendido_outra_forma",
    rotulo: "Já foi atendido de outra forma",
    descricao: "Empréstimo, doação, outra compra já feita etc. Explique no motivo.",
  },
] as const;

function EncerrarComPendencia({ pedidoId }: { pedidoId: number }) {
  const router = useRouter();
  const [state, formAction] = useActionState<FormState, FormData>(encerrarPedidoComPendencia, {
    ok: false,
  });
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  return (
    <div className="flex flex-col gap-1">
      <form action={formAction} {...formularioSemPerda(state)} className="flex flex-col gap-2">
        <input type="hidden" name="pedido_id" value={pedidoId} />
        <fieldset className="rounded-md border border-border px-3 py-2">
          <legend className="px-1 text-xs text-muted-foreground">O que fazer com o que faltou?</legend>
          <div className="flex flex-col gap-1.5 text-sm">
            {DESTINOS.map((d) => (
              <label key={d.valor} className="flex items-start gap-2">
                <input type="radio" name="destino" value={d.valor} required className="mt-1" />
                <span>
                  <span className="font-medium">{d.rotulo}</span>
                  <span className="block text-xs text-muted-foreground">{d.descricao}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`motivo-encerrar-${pedidoId}`} className="block text-xs text-muted-foreground">
              Motivo
            </label>
            <input
              id={`motivo-encerrar-${pedidoId}`}
              name="motivo"
              required
              minLength={3}
              placeholder="Ex.: fornecedor sem estoque"
              className="h-9 w-64 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <ConfirmSubmitButton
            className="rounded-md border border-input px-4 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
            titulo={`Encerrar a compra #${pedidoId} com pendência?`}
            mensagem="O que já chegou continua no estoque. O que faltou deixa de ser esperado nesta compra e segue o destino escolhido; a quantidade não atendida fica registrada em cada item."
            confirmLabel="Encerrar com pendência"
          >
            Encerrar com pendência
          </ConfirmSubmitButton>
        </div>
      </form>
      {state.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`text-xs ${state.ok ? "text-brand-700 dark:text-brand-400" : "text-danger-strong"}`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}

export function PedidoAcoes({
  pedidoId,
  status,
  podeAprovar,
  podeCancelar,
  temRecebimento = false,
  pedidoInternoPendente = null,
}: {
  pedidoId: number;
  status: string;
  /** permissão "Aprovar compras": aprovar, enviar e encerrar com pendência */
  podeAprovar: boolean;
  /** permissão "Cancelar compras e pedidos" */
  podeCancelar: boolean;
  /** Já chegou algo: cancelar é recusado; o caminho é encerrar com pendência. */
  temRecebimento?: boolean;
  /** Pedido interno de origem que ainda não chegou a "Aprovado para compra" (0130, D1). */
  pedidoInternoPendente?: { id: number; rotulo: string } | null;
}) {
  if (status === "recebido" || status === "cancelado") return null;
  if (!podeAprovar && !podeCancelar)
    return (
      <p className="text-xs text-muted-foreground/80">
        Aprovar ou cancelar esta compra exige a permissão “Aprovar compras” ou “Cancelar compras e pedidos”.
      </p>
    );

  const seguraPeloPedido = pedidoInternoPendente != null && (status === "solicitado" || status === "aprovado");

  return (
    <div className="flex flex-wrap items-start gap-3">
      {seguraPeloPedido && podeAprovar && (
        <p role="note" className="max-w-md rounded-md border border-warning-strong/30 bg-warning-soft px-3 py-2 text-xs">
          Esta compra vem do{" "}
          <Link href={`/pedido/${pedidoInternoPendente.id}`} className="font-medium text-primary hover:underline">
            pedido interno #{pedidoInternoPendente.id}
          </Link>
          , que está em “{pedidoInternoPendente.rotulo}”. Ela só pode ser {status === "solicitado" ? "aprovada" : "enviada"}{" "}
          depois que o pedido chegar a “Aprovado para compra”.
        </p>
      )}
      {status === "solicitado" && podeAprovar && !seguraPeloPedido && (
        <Botao pedidoId={pedidoId} action={aprovarPedido} label="Aprovar"
          cls="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50" />
      )}
      {status === "aprovado" && podeAprovar && !seguraPeloPedido && (
        <Botao pedidoId={pedidoId} action={marcarEnviado} label="Marcar enviado"
          cls="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50" />
      )}
      {temRecebimento ? (
        podeAprovar && <EncerrarComPendencia pedidoId={pedidoId} />
      ) : podeCancelar && (
        <Botao pedidoId={pedidoId} action={cancelarPedido} label="Cancelar compra"
          cls="rounded-md border border-input px-4 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
          motivo={{ rotulo: "Motivo do cancelamento", placeholder: "Ex.: fornecedor não atende" }}
          confirmacao={{
            titulo: `Cancelar a compra #${pedidoId}?`,
            mensagem: "A compra sai do ciclo de compras e não pode ser reaberta. O histórico e o motivo ficam registrados.",
            confirmLabel: "Cancelar compra",
          }} />
      )}
    </div>
  );
}
