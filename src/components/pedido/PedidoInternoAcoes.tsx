"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  aprovarAnaliseAdministrativa,
  aprovarCompraFinal,
  cancelarPedidoInterno,
  concluirCompra,
  devolverParaCompras,
  devolverParaSolicitante,
  encaminharInstituicao,
  enviarParaValidacao,
  enviarAprovacaoFinal,
  fecharComFornecedor,
  formalizarPedidoInterno,
  marcarAguardandoPagamentoNf,
  marcarOrcamentosRecebidos,
  registrarLevantamentoOrcamentos,
  validarInformacoes,
} from "@/lib/actions/pedidos-internos";
import type { FormState } from "@/lib/actions/cadastros";
import { SubmitButton } from "@/components/common/SubmitButton";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

function Botao({
  pedidoId,
  action,
  label,
  variant = "primary",
  observacao,
  comentarioPlaceholder,
  disabled = false,
  disabledReason,
  children,
}: {
  pedidoId: number;
  action: Action;
  label: string;
  variant?: "primary" | "outline" | "danger";
  observacao?: string;
  comentarioPlaceholder?: string;
  disabled?: boolean;
  disabledReason?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<FormState, FormData>(action, { ok: false });
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  const cls =
    variant === "danger"
      ? "h-8 rounded-md border border-danger-strong/30 px-3 text-xs font-medium text-danger-strong hover:bg-danger-soft disabled:opacity-50"
      : variant === "outline"
        ? "h-8 rounded-md border border-input px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
        : "h-8 rounded-md bg-brand-600 px-3 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50";

  return (
    <div className="flex flex-col gap-1">
      <form action={formAction} {...formularioSemPerda(state)} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="pedido_interno_id" value={pedidoId} />
        {observacao && <input type="hidden" name="observacao" value={observacao} />}
        {comentarioPlaceholder && (
          <input
            name="observacao"
            required
            aria-label={comentarioPlaceholder}
            placeholder={comentarioPlaceholder}
            className="h-8 w-52 rounded-md border border-input bg-card px-2 text-xs"
          />
        )}
        {children}
        <SubmitButton disabled={disabled} pendingLabel="Enviando…" className={cls} title={disabledReason}>
          {label}
        </SubmitButton>
      </form>
      {disabled && disabledReason && <p className="max-w-64 text-xs text-muted-foreground">{disabledReason}</p>}
      {state.message && (
        <p className={`max-w-64 text-xs ${state.ok ? "text-brand-700 dark:text-brand-400" : "text-danger-strong"}`}>
          {state.message}
        </p>
      )}
    </div>
  );
}

export function PedidoInternoAcoes({
  pedidoId,
  status,
  podeGerir,
  podeCancelar = false,
  temCompraFormal = false,
  podeEnviarValidacao = true,
}: {
  pedidoId: number;
  status: string;
  /** permissão "Aprovar pedidos internos" */
  podeGerir: boolean;
  /** mesma chave do servidor: "Cancelar compras" (compras.cancelar) */
  podeCancelar?: boolean;
  /** pedido devolvido depois de formalizado: retoma a compra que já existe */
  temCompraFormal?: boolean;
  podeEnviarValidacao?: boolean;
}) {
  if (status === "cancelado" || status === "compra_concluida") {
    return null;
  }

  return (
    <div className="flex flex-wrap items-start gap-2">
      {["rascunho", "ajuste_solicitante", "ajuste_compras"].includes(status) && (
        <Botao
          pedidoId={pedidoId}
          action={enviarParaValidacao}
          label="Enviar para validação"
          disabled={!podeEnviarValidacao}
          disabledReason="Complete identificação, justificativa, fonte de recurso e ao menos um item antes de enviar."
        />
      )}

      {status === "em_validacao" && podeGerir && (
        <>
          <Botao pedidoId={pedidoId} action={validarInformacoes} label="Validar informações" />
          <Botao
            pedidoId={pedidoId}
            action={devolverParaSolicitante}
            label="Devolver ao solicitante"
            variant="outline"
            comentarioPlaceholder="Motivo obrigatório"
          />
        </>
      )}

      {status === "validado" && podeGerir && (
        <Botao
          pedidoId={pedidoId}
          action={formalizarPedidoInterno}
          label={temCompraFormal ? "Retomar compra formal" : "Formalizar em compras"}
        />
      )}

      {status === "analise_administrativa" && podeGerir && (
        <>
          <Botao pedidoId={pedidoId} action={aprovarAnaliseAdministrativa} label="Aprovar compra" />
          <Botao
            pedidoId={pedidoId}
            action={devolverParaCompras}
            label="Devolver para ajuste"
            variant="outline"
            comentarioPlaceholder="Motivo obrigatório"
          />
        </>
      )}

      {status === "aprovado_compra" && podeGerir && (
        <Botao pedidoId={pedidoId} action={registrarLevantamentoOrcamentos} label="Registrar cotações" />
      )}

      {status === "orcamentos" && podeGerir && (
        <>
          <Botao pedidoId={pedidoId} action={marcarOrcamentosRecebidos} label="Marcar cotações recebidas" />
        </>
      )}

      {status === "orcamentos_recebidos" && podeGerir && (
        <Botao pedidoId={pedidoId} action={enviarAprovacaoFinal} label="Enviar para aprovação final" />
      )}

      {status === "aguardando_aprovacao_final" && podeGerir && (
        <Botao pedidoId={pedidoId} action={aprovarCompraFinal} label="Aprovar compra final" />
      )}

      {status === "aprovado_para_compra" && podeGerir && (
        <>
          <Botao pedidoId={pedidoId} action={fecharComFornecedor} label="Fechar com fornecedor" />
          <Botao pedidoId={pedidoId} action={encaminharInstituicao} label="Encaminhar à instituição" variant="outline">
            <div className="grid w-72 gap-2">
              <select name="modalidade_compra" defaultValue="fundacao" className="h-8 rounded-md border border-input bg-card px-2 text-xs">
                <option value="fundacao">Fundação</option>
                <option value="universidade">Universidade</option>
                <option value="outra">Outra instituição</option>
              </select>
              <input
                name="instituicao_destino"
                required
                placeholder="Instituição de destino"
                className="h-8 rounded-md border border-input bg-card px-2 text-xs"
              />
              <input
                name="protocolo_externo"
                placeholder="Protocolo/referência externa"
                className="h-8 rounded-md border border-input bg-card px-2 text-xs"
              />
            </div>
          </Botao>
        </>
      )}

      {["compra_fechada", "encaminhado_instituicao"].includes(status) && podeGerir && (
        <Botao pedidoId={pedidoId} action={marcarAguardandoPagamentoNf} label="Aguardar pagamento/NF" />
      )}

      {status === "aguardando_pagamento_nf" && podeGerir && (
        <>
          <Botao pedidoId={pedidoId} action={concluirCompra} label="Concluir compra" />
        </>
      )}

      {podeCancelar && (
        <Botao
          pedidoId={pedidoId}
          action={cancelarPedidoInterno}
          label="Cancelar"
          variant="danger"
          comentarioPlaceholder="Motivo obrigatório"
        />
      )}
    </div>
  );
}
