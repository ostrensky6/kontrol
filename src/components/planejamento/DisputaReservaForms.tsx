"use client";

import { useActionState, useEffect, useRef } from "react";
import { decidirDisputaReserva, pedirReservaDeOutroPlano } from "@/lib/actions/disputas-reserva";
import { ESTADO_INICIAL } from "@/lib/erros";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import { Input } from "@/components/ui/input";

const campo = "mt-1 block min-h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

export function PedirReservaForm({ planId, insumoId, insumo }: { planId: number; insumoId: number; insumo: string }) {
  const [estado, enviar] = useActionState(pedirReservaDeOutroPlano, ESTADO_INICIAL);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (estado.ok) ref.current?.reset(); }, [estado]);
  return (
    <form ref={ref} action={enviar} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="planejamento_id" value={planId} />
      <input type="hidden" name="insumo_id" value={insumoId} />
      <label className="min-w-56 flex-1 text-xs font-medium">
        Por que este plano precisa
        <Input name="motivo" required maxLength={1000} aria-label={`Motivo do pedido de ${insumo}`} className="mt-1 h-9 text-sm"
          placeholder="Ex.: começa antes, amostra perecível" />
      </label>
      <SubmitButton pendingLabel="Enviando…">Pedir reserva de outro plano</SubmitButton>
      <MensagemAcao estado={estado} />
    </form>
  );
}

export type PlanoCandidato = { planejamento_id: number; nome: string; data_inicio_prevista: string | null; reservado: number; reserva_desatualizada: boolean };

export function DecidirDisputaForm({ disputaId, candidatos, rotulo }: { disputaId: number; candidatos: PlanoCandidato[]; rotulo: string }) {
  const [estado, enviar] = useActionState(decidirDisputaReserva, ESTADO_INICIAL);
  const validos = candidatos.filter((c) => !c.reserva_desatualizada);
  return (
    <form action={enviar} className="mt-3 grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-[10rem_1fr]">
      <input type="hidden" name="disputa_id" value={disputaId} />
      <label className="text-xs font-medium">
        Decisão
        <select name="decisao" defaultValue={validos.length > 0 ? "transferir" : "negar"} aria-label={`Decisão sobre ${rotulo}`} className={campo}>
          <option value="transferir" disabled={validos.length === 0}>Transferir</option>
          <option value="negar">Negar</option>
        </select>
      </label>
      <label className="text-xs font-medium">
        Plano que cede (ao transferir)
        <select name="planejamento_origem_id" defaultValue={validos[0]?.planejamento_id ?? ""} aria-label={`Plano que cede para ${rotulo}`} className={campo}>
          {validos.length === 0 && <option value="">Nenhum plano reservado tem esse insumo</option>}
          {validos.map((c) => (
            <option key={c.planejamento_id} value={c.planejamento_id}>
              {c.nome} · {c.reservado.toLocaleString("pt-BR")} reservado{c.data_inicio_prevista ? ` · início ${new Date(`${c.data_inicio_prevista}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium sm:col-start-2">
        Motivo da decisão
        <Input name="observacao" required maxLength={1000} aria-label={`Motivo da decisão sobre ${rotulo}`} className="mt-1 h-9 text-sm" />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-start-2">
        <SubmitButton pendingLabel="Registrando…">Registrar decisão</SubmitButton>
        <MensagemAcao estado={estado} />
      </div>
    </form>
  );
}
