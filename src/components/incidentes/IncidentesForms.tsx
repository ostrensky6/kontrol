"use client";

import { useActionState, useEffect, useRef } from "react";
import { atualizarIncidente, registrarIncidente } from "@/lib/actions/incidentes";
import { ESTADO_INICIAL } from "@/lib/erros";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import { Input } from "@/components/ui/input";

const campo = "mt-1 block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";

export const DESTINO_INCIDENTE: Record<string, string> = {
  laboratorio: "Todas as pessoas",
  coordenador: "Coordenador ou acima",
  gestor: "Gestor ou acima",
  supervisor: "Supervisor e Administrador",
  admin: "Só Administrador",
};

function Erro({ texto }: { texto?: string }) {
  return texto ? <span className="mt-1 block text-xs text-destructive">{texto}</span> : null;
}

export function NovoIncidenteForm() {
  const [estado, enviar] = useActionState(registrarIncidente, ESTADO_INICIAL);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (estado.ok) ref.current?.reset(); }, [estado]);
  const e = estado.errors ?? {};
  return (
    <form ref={ref} action={enviar} className="grid gap-3 sm:grid-cols-2" data-testid="novo-incidente">
      <label className="text-sm font-medium sm:col-span-2">
        Título
        <Input name="titulo" required minLength={3} maxLength={200} className="mt-1" placeholder="Ex.: Freezer -80 parado" />
        <Erro texto={e.titulo} />
      </label>
      <label className="text-sm font-medium sm:col-span-2">
        O que aconteceu
        <textarea name="descricao" required maxLength={2000} rows={3} className={campo} />
        <Erro texto={e.descricao} />
      </label>
      <label className="text-sm font-medium">
        Quem ou o que foi afetado
        <Input name="afetados" required maxLength={500} className="mt-1" placeholder="Ex.: amostras do freezer 2, pedidos de hoje" />
        <Erro texto={e.afetados} />
      </label>
      <label className="text-sm font-medium">
        Quem recebe o aviso
        <select name="papel_destino" defaultValue="laboratorio" className={campo}>
          {Object.entries(DESTINO_INCIDENTE).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>{rotulo}</option>
          ))}
        </select>
        <Erro texto={e.papel_destino} />
      </label>
      <label className="text-sm font-medium sm:col-span-2">
        O que fazer enquanto isso
        <textarea name="orientacao" required maxLength={2000} rows={2} className={campo} placeholder="Ação segura para quem foi afetado" />
        <Erro texto={e.orientacao} />
      </label>
      <label className="text-sm font-medium sm:col-span-2">
        Causa (deixe em branco se ainda não foi confirmada)
        <textarea name="causa" maxLength={2000} rows={2} className={campo} />
        <Erro texto={e.causa} />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <SubmitButton pendingLabel="Registrando…">Registrar e avisar</SubmitButton>
        <MensagemAcao estado={estado} />
      </div>
    </form>
  );
}

export function AtualizarIncidenteForm({ id, titulo, situacao }: { id: number; titulo: string; situacao: string }) {
  const [estado, enviar] = useActionState(atualizarIncidente, ESTADO_INICIAL);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (estado.ok) ref.current?.reset(); }, [estado]);
  return (
    <form ref={ref} action={enviar} className="mt-3 grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-[10rem_1fr]">
      <input type="hidden" name="incidente_id" value={id} />
      <label className="text-xs font-medium">
        Nova situação
        <select name="situacao" defaultValue={situacao === "resolvido" ? "aberto" : situacao === "aberto" ? "em_andamento" : "resolvido"}
          aria-label={`Nova situação de ${titulo}`} className={campo}>
          <option value="aberto">{situacao === "resolvido" ? "Reabrir" : "Aberto"}</option>
          <option value="em_andamento">Em andamento</option>
          <option value="resolvido">Resolvido</option>
        </select>
      </label>
      <label className="text-xs font-medium">
        O que mudou
        <Input name="nota" required maxLength={2000} aria-label={`O que mudou em ${titulo}`} className="mt-1 h-9 text-sm" />
      </label>
      <label className="text-xs font-medium sm:col-start-2">
        Causa confirmada (opcional)
        <Input name="causa" maxLength={2000} aria-label={`Causa de ${titulo}`} className="mt-1 h-9 text-sm" />
      </label>
      <label className="text-xs font-medium sm:col-start-2">
        Nova orientação (opcional)
        <Input name="orientacao" maxLength={2000} aria-label={`Nova orientação de ${titulo}`} className="mt-1 h-9 text-sm" />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-start-2">
        <SubmitButton pendingLabel="Salvando…">Registrar passo</SubmitButton>
        <MensagemAcao estado={estado} />
      </div>
    </form>
  );
}
