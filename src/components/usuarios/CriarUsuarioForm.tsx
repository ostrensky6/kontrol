"use client";

import { useActionState } from "react";

import { criarUsuario, type UsuarioFormState } from "@/lib/actions/usuarios";
import { Input } from "@/components/ui/input";
import { HelpTip } from "@/components/common/HelpTip";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";
import { SenhaProvisoriaGerada } from "./SenhaProvisoriaGerada";

const initialState: UsuarioFormState = { ok: false, message: "" };

export function CriarUsuarioForm() {
  const [state, action] = useActionState(criarUsuario, initialState);

  return (
    <form
      action={action}
      {...formularioSemPerda(state)}
      className="mt-6 rounded-lg border border-info-strong/30 bg-info-soft p-4"
    >
      <input type="hidden" name="papel" value="laboratorio" />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-52 flex-1">
          <label htmlFor="novo-usuario-nome" className="block text-xs font-medium text-info-strong">Nome</label>
          <Input id="novo-usuario-nome" name="nome" className="mt-1 bg-card" />
        </div>
        <div className="min-w-56 flex-1">
          <label htmlFor="novo-usuario-email" className="block text-xs font-medium text-info-strong">E-mail</label>
          <Input id="novo-usuario-email" name="email" type="email" required className="mt-1 bg-card" />
        </div>
        <SubmitButton pendingLabel="Cadastrando…">Cadastrar usuário</SubmitButton>
      </div>
      <p className="mt-2 text-sm text-info-strong">
        A conta começa em Laboratório. Depois do cadastro, use Trocar função quando a ação estiver disponível.
      </p>
      <p className="mt-2 flex items-center gap-1 text-xs leading-5 text-info-strong/80">
        O Kontrol gera uma senha provisória só para esta pessoa; ela troca no primeiro acesso.
        <HelpTip title="Novo usuário">
          <p>
            A conta é criada com uma <b>senha provisória</b> gerada na hora, que aparece uma única
            vez aqui. Copie e passe para a pessoa. Ela vale por 7 dias; no primeiro login, a pessoa
            define a senha definitiva.
          </p>
        </HelpTip>
      </p>
      <MensagemAcao estado={state} className="mt-2" />
      {state.ok && state.senhaProvisoria && (
        <div className="mt-3">
          <SenhaProvisoriaGerada senha={state.senhaProvisoria} />
        </div>
      )}
    </form>
  );
}
