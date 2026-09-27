"use client";

import { useActionState } from "react";

import { criarUsuario } from "@/lib/actions/usuarios";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PAPEIS } from "@/lib/auth/permissions";
import type { FormState } from "@/lib/actions/cadastros";
import { HelpTip } from "@/components/common/HelpTip";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

const initialState: FormState = { ok: false, message: "" };

export function CriarUsuarioForm() {
  const [state, action] = useActionState(criarUsuario, initialState);

  return (
    <form
      action={action}
      {...formularioSemPerda(state)}
      className="mt-6 rounded-lg border border-info-strong/30 bg-info-soft p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-52 flex-1">
          <label htmlFor="novo-usuario-nome" className="block text-xs font-medium text-info-strong">Nome</label>
          <Input id="novo-usuario-nome" name="nome" className="mt-1 bg-card" />
        </div>
        <div className="min-w-56 flex-1">
          <label htmlFor="novo-usuario-email" className="block text-xs font-medium text-info-strong">E-mail</label>
          <Input id="novo-usuario-email" name="email" type="email" required className="mt-1 bg-card" />
        </div>
        <div>
          <label htmlFor="novo-usuario-papel" className="block text-xs font-medium text-info-strong">Categoria inicial</label>
          <Select id="novo-usuario-papel" name="papel" defaultValue="tecnico" className="mt-1 h-9 bg-card">
            {PAPEIS.map((papel) => (
              <option key={papel.value} value={papel.value}>
                {papel.label}
              </option>
            ))}
          </Select>
        </div>
        <SubmitButton pendingLabel="Cadastrando…">Cadastrar usuário</SubmitButton>
      </div>
      <p className="mt-2 flex items-center gap-1 text-xs leading-5 text-info-strong/80">
        Entra com senha provisória e troca no primeiro acesso.
        <HelpTip title="Novo usuário">
          <p>
            A conta é criada com acesso e uma <b>senha provisória</b>. No primeiro login, a pessoa
            define a senha definitiva.
          </p>
          <p>As permissões iniciais são as da categoria escolhida; ajuste depois em Editar.</p>
        </HelpTip>
      </p>
      <MensagemAcao estado={state} className="mt-2" />
    </form>
  );
}
