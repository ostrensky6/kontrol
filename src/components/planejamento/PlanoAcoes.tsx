"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  reservarPlano,
  iniciarPlano,
  liberarPlano,
  concluirPlano,
} from "@/lib/actions/planejamento";
import type { FormState } from "@/lib/actions/cadastros";
import { HelpTip } from "@/components/common/HelpTip";
import { ConfirmSubmitButton } from "@/components/common/ConfirmSubmitButton";
import { SubmitButton } from "@/components/common/SubmitButton";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;
type Confirmacao = { titulo: string; mensagem: string; confirmLabel: string; destrutivo?: boolean };

function Botao({
  planId,
  action,
  label,
  cls,
  confirmacao,
}: {
  planId: number;
  action: Action;
  label: string;
  cls: string;
  confirmacao?: Confirmacao;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<FormState, FormData>(action, {
    ok: false,
  });
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  return (
    <div className="flex flex-col gap-1">
      <form action={formAction} {...formularioSemPerda(state)}>
        <input type="hidden" name="planejamento_id" value={planId} />
        {confirmacao ? (
          <ConfirmSubmitButton className={cls} {...confirmacao}>
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

export function PlanoAcoes({
  planId,
  status,
  temFalta,
  contextoCompleto,
  temBloqueioEquipamentos = false,
  reservaDesatualizada = false,
  podeExecutar = false,
  podeEditar = false,
}: {
  planId: number;
  status: string;
  temFalta: boolean;
  contextoCompleto: boolean;
  temBloqueioEquipamentos?: boolean;
  /** Itens mudaram depois da reserva (0111): exige nova reserva antes da baixa. */
  reservaDesatualizada?: boolean;
  /** "Executar planejamento": reservar, retirar/iniciar e concluir (mesma chave do servidor) */
  podeExecutar?: boolean;
  /** "Editar planejamento": liberar reservas (mesma chave do servidor) */
  podeEditar?: boolean;
}) {
  const podeReservar = podeExecutar && contextoCompleto && (status === "Rascunho" || status === "Reservado");
  const podeIniciar = podeExecutar && status === "Reservado" && !temFalta && !temBloqueioEquipamentos && !reservaDesatualizada;
  const podeLiberar = podeEditar && status === "Reservado";
  const podeConcluir = podeExecutar && (status === "Em execução" || status === "Iniciado");
  const semPermissao = !podeExecutar && !podeEditar;

  return (
    <div className="space-y-3">
      {semPermissao && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Reservar, retirar e concluir exigem a permissão “Executar planejamento”.
        </p>
      )}
      {!contextoCompleto && (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-strong">
          Complete projeto e período previsto para poder reservar insumos.
        </p>
      )}
      {status === "Reservado" && reservaDesatualizada && (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-strong">
          Os itens mudaram depois da reserva. Use Reservar insumos de novo para liberar o Iniciar.
        </p>
      )}
      {status === "Reservado" && temFalta && (
        <p className="flex items-center gap-1 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-strong">
          Há insumos em falta; resolva antes de iniciar.
          <HelpTip title="Como resolver a falta">
            <p>Escolha uma saída:</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li><b>Gerar pedido interno</b> com os itens em falta;</li>
              <li>liberar ou receber lotes no estoque;</li>
              <li>reduzir as análises ou amostras do plano.</li>
            </ul>
          </HelpTip>
        </p>
      )}
      {status === "Reservado" && !temFalta && temBloqueioEquipamentos && (
        <p className="flex items-center gap-1 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-strong">
          Falta reservar equipamento obrigatório.
          <HelpTip title="Equipamento sem reserva">
            <p>
              Uma análise do plano exige um equipamento que ainda não tem reserva válida para o
              período. Reserve uma unidade disponível em <b>Capacidade e equipamentos</b> antes de
              iniciar.
            </p>
          </HelpTip>
        </p>
      )}
      <div className="flex flex-wrap items-start gap-3">
        {podeReservar && (
          <Botao
            planId={planId}
            action={reservarPlano}
            label="Reservar insumos"
            cls="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          />
        )}
        {podeIniciar && (
          <Botao
            planId={planId}
            action={iniciarPlano}
            label="Retirar insumos e iniciar"
            cls="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            confirmacao={{
              titulo: "Retirar os insumos e iniciar?",
              mensagem:
                "Os frascos reservados saem do estoque agora, em seu nome. O que sobrar não volta ao almoxarifado.",
              confirmLabel: "Retirar e iniciar",
            }}
          />
        )}
        {podeLiberar && (
          <Botao
            planId={planId}
            action={liberarPlano}
            label="Liberar reservas"
            cls="rounded-md border border-input px-4 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
            confirmacao={{
              titulo: "Liberar as reservas?",
              mensagem:
                "Os insumos e equipamentos voltam a ficar disponíveis e o plano volta para rascunho. Para usar o plano, reserve de novo.",
              confirmLabel: "Liberar reservas",
            }}
          />
        )}
        {podeConcluir && (
          <Botao
            planId={planId}
            action={concluirPlano}
            label="Concluir análise"
            cls="rounded-md border border-brand-300 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50 dark:border-brand-800 dark:text-brand-300 dark:hover:bg-brand-950/30"
            confirmacao={{
              titulo: "Concluir a análise?",
              mensagem:
                "O plano fica concluído e as reservas que sobraram são liberadas. A baixa de estoque já foi feita ao iniciar.",
              confirmLabel: "Concluir análise",
            }}
          />
        )}
      </div>
    </div>
  );
}
