"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  aprovarAnaliseAdministrativa,
  aprovarCompraFinal,
  cancelarPedidoInterno,
  concluirCompra,
  confirmarEntregaPedidoInterno,
  decidirCoordenacaoLaboratorio,
  devolverParaCompras,
  devolverParaSolicitante,
  encaminharInstituicao,
  enviarParaValidacao,
  enviarAprovacaoFinal,
  fecharComFornecedor,
  formalizarPedidoInterno,
  marcarAguardandoPagamentoNf,
  marcarOrcamentosRecebidos,
  registrarExcecaoPagamento,
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
      ? "h-9 rounded-md border border-danger-strong/30 bg-card px-3 text-sm font-medium text-danger-strong shadow-none hover:bg-danger-soft hover:text-danger-strong disabled:opacity-50"
      : variant === "outline"
        ? "h-9 rounded-md border border-input bg-card px-3 text-sm font-medium text-foreground shadow-none hover:bg-muted hover:text-foreground disabled:opacity-50"
        : "h-9 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50";

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
            className="h-9 w-56 rounded-md border border-input bg-card px-2 text-sm"
          />
        )}
        {children}
        {/* a variante evita que o fundo do botão principal vaze para os botões de contorno */}
        <SubmitButton
          variant={variant === "primary" ? "default" : "outline"}
          disabled={disabled}
          pendingLabel="Enviando…"
          className={cls}
          title={disabledReason}
        >
          {label}
        </SubmitButton>
      </form>
      {disabled && disabledReason && <p className="max-w-80 text-xs text-muted-foreground">{disabledReason}</p>}
      {state.message && (
        <p className={`max-w-80 text-xs ${state.ok ? "text-brand-700 dark:text-brand-300" : "text-danger-strong"}`}>
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
  motivoSemEnvio,
  motivoSemValidacao,
  aguardandoLaboratorio = false,
  podeDecidirLaboratorio = false,
  pendenciaPagamento = null,
  podeConfirmarEntrega = false,
  motivoSemCotacoesRecebidas = null,
  motivoSemAprovacaoFinal = null,
  controlado = false,
  motivoCicloTravado = null,
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
  /** 0169: o envio trava sem quem valide (texto do banco) */
  motivoSemEnvio?: string;
  /** 0169: o usuário tem a permissão, mas não é quem valida este pedido */
  motivoSemValidacao?: string;
  /** 0169: material de consumo de laboratório ainda sem a coordenação do laboratório */
  aguardandoLaboratorio?: boolean;
  podeDecidirLaboratorio?: boolean;
  /** 0170 (D6): o que falta para o pedido seguir ao pagamento; null quando pode */
  pendenciaPagamento?: string | null;
  /** 0170: serviço prestado ou entrega a confirmar (quem recebe ou aprova) */
  podeConfirmarEntrega?: boolean;
  /** 0171 (D2): o que falta nos 3 orçamentos; null quando pode seguir */
  motivoSemCotacoesRecebidas?: string | null;
  motivoSemAprovacaoFinal?: string | null;
  /** 0174 (D9): pedido com produto controlado: só pela FUNPAR, sem compra direta */
  controlado?: boolean;
  /** 0176: pedido do ciclo seguinte; o texto diz quando a formalização abre */
  motivoCicloTravado?: string | null;
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
          label={status === "rascunho" ? "Enviar para aprovação" : "Reenviar"}
          disabled={!podeEnviarValidacao || Boolean(motivoSemEnvio)}
          disabledReason={
            motivoSemEnvio ??
            "Complete tipo de material, objetivo, justificativa e ao menos um item antes de enviar."
          }
        />
      )}

      {status === "em_validacao" && podeGerir && (
        <>
          <Botao
            pedidoId={pedidoId}
            action={validarInformacoes}
            label="Aprovar pedido"
            disabled={Boolean(motivoSemValidacao)}
            disabledReason={motivoSemValidacao}
          />
          <Botao
            pedidoId={pedidoId}
            action={devolverParaSolicitante}
            label="Devolver ao solicitante"
            variant="outline"
            comentarioPlaceholder="Motivo obrigatório"
          />
        </>
      )}

      {status === "validado" && aguardandoLaboratorio && podeDecidirLaboratorio && (
        <>
          <Botao pedidoId={pedidoId} action={decidirCoordenacaoLaboratorio} label="Aprovar pelo laboratório">
            <input type="hidden" name="decisao" value="aprovado" />
          </Botao>
          <Botao
            pedidoId={pedidoId}
            action={decidirCoordenacaoLaboratorio}
            label="Devolver ao solicitante"
            variant="outline"
            comentarioPlaceholder="Motivo obrigatório"
          >
            <input type="hidden" name="decisao" value="devolvido" />
          </Botao>
        </>
      )}

      {status === "validado" && podeGerir && (
        <Botao
          pedidoId={pedidoId}
          action={formalizarPedidoInterno}
          label={temCompraFormal ? "Retomar a compra" : "Formalizar em compras"}
          disabled={aguardandoLaboratorio || Boolean(motivoCicloTravado)}
          disabledReason={
            aguardandoLaboratorio
              ? "Material de consumo de laboratório só segue para compras depois da aprovação da coordenação do laboratório."
              : (motivoCicloTravado ?? undefined)
          }
        />
      )}

      {status === "analise_administrativa" && podeGerir && (
        <>
          <Botao pedidoId={pedidoId} action={aprovarAnaliseAdministrativa} label="Autorizar compra" />
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
          <Botao
            pedidoId={pedidoId}
            action={marcarOrcamentosRecebidos}
            label="Marcar cotações recebidas"
            disabled={Boolean(motivoSemCotacoesRecebidas)}
            disabledReason={motivoSemCotacoesRecebidas ?? undefined}
          />
        </>
      )}

      {status === "orcamentos_recebidos" && podeGerir && (
        <Botao
          pedidoId={pedidoId}
          action={enviarAprovacaoFinal}
          label="Enviar para aprovação final"
          disabled={Boolean(motivoSemAprovacaoFinal)}
          disabledReason={motivoSemAprovacaoFinal ?? undefined}
        />
      )}

      {status === "aguardando_aprovacao_final" && podeGerir && (
        <Botao pedidoId={pedidoId} action={aprovarCompraFinal} label="Aprovar compra final" />
      )}

      {status === "aprovado_para_compra" && podeGerir && (
        <>
          <Botao
            pedidoId={pedidoId}
            action={fecharComFornecedor}
            label="Fechar com fornecedor"
            disabled={controlado}
            disabledReason={controlado ? "Produto controlado: não pode ser compra direta. Encaminhe à FUNPAR." : undefined}
          />
          <Botao pedidoId={pedidoId} action={encaminharInstituicao} label="Encaminhar à instituição" variant="outline">
            <div className="grid w-72 gap-2">
              <select name="modalidade_compra" defaultValue="fundacao" className="h-9 rounded-md border border-input bg-card px-2 text-sm">
                <option value="fundacao">Fundação</option>
                <option value="universidade">Universidade</option>
                <option value="outra">Outra instituição</option>
              </select>
              <input
                name="instituicao_destino"
                required
                defaultValue={controlado ? "FUNPAR" : undefined}
                placeholder="Instituição de destino"
                className="h-9 rounded-md border border-input bg-card px-2 text-sm"
              />
              <input
                name="protocolo_externo"
                placeholder="Protocolo/referência externa"
                className="h-9 rounded-md border border-input bg-card px-2 text-sm"
              />
            </div>
          </Botao>
        </>
      )}

      {["aprovado_para_compra", "compra_fechada", "encaminhado_instituicao"].includes(status) && podeConfirmarEntrega && (
        <Botao pedidoId={pedidoId} action={confirmarEntregaPedidoInterno} label="Confirmar entrega (serviço prestado)" variant="outline">
          <input
            name="observacao"
            aria-label="Observação da entrega (opcional)"
            placeholder="Observação (opcional)"
            className="h-9 w-56 rounded-md border border-input bg-card px-2 text-sm"
          />
        </Botao>
      )}

      {["compra_fechada", "encaminhado_instituicao"].includes(status) && podeGerir && (
        <Botao
          pedidoId={pedidoId}
          action={marcarAguardandoPagamentoNf}
          label="Aguardar pagamento/NF"
          disabled={Boolean(pendenciaPagamento)}
          disabledReason={pendenciaPagamento ?? undefined}
        />
      )}

      {["aprovado_para_compra", "compra_fechada", "encaminhado_instituicao"].includes(status) && podeGerir && pendenciaPagamento && (
        <Botao
          pedidoId={pedidoId}
          action={registrarExcecaoPagamento}
          label="Registrar exceção (pagar antes)"
          variant="outline"
          comentarioPlaceholder="Acordo: com quem, o quê e por quê"
        />
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
