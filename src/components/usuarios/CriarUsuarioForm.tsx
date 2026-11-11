"use client";

import { useActionState } from "react";

import { criarUsuario, type UsuarioFormState } from "@/lib/actions/usuarios";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PAPEIS, PAPEL_PADRAO } from "@/lib/auth/permissions";
import { Campo } from "@/components/common/Campo";
import { HelpTip } from "@/components/common/HelpTip";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";
import { SenhaProvisoriaGerada } from "./SenhaProvisoriaGerada";

const initialState: UsuarioFormState ={ ok: false, message: "" };

export function CriarUsuarioForm() {
  const [state, action] = useActionState(criarUsuario, initialState);

  return (
    <form
      action={action}
      {...formularioSemPerda(state)}
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-end gap-3">
        <Campo rotulo="Nome" htmlFor="novo-usuario-nome" className="min-w-52 flex-1">
          <Input id="novo-usuario-nome" name="nome" />
        </Campo>
        <Campo rotulo="E-mail" htmlFor="novo-usuario-email" className="min-w-56 flex-1">
          <Input id="novo-usuario-email" name="email" type="email" required />
        </Campo>
        <Campo rotulo="Função" htmlFor="novo-usuario-papel">
          <Select id="novo-usuario-papel" name="papel" defaultValue={PAPEL_PADRAO}>
            {PAPEIS.map((papel) => (
              <option key={papel.value} value={papel.value}>
                {papel.label}
              </option>
            ))}
          </Select>
        </Campo>
        <SubmitButton pendingLabel="Cadastrando…">Cadastrar usuário</SubmitButton>
      </div>
      <p className="mt-2 flex items-center gap-1 text-xs leading-5 text-muted-foreground">
        O Kontrol gera uma senha provisória só para esta pessoa; ela troca no primeiro acesso.
        <HelpTip title="Novo usuário">
          <p>
            A conta é criada com uma <b>senha provisória</b> gerada na hora, que aparece uma única
            vez aqui. Copie e passe para a pessoa. Ela vale por 7 dias; no primeiro login, a pessoa
            define a senha definitiva.
          </p>
          <p>As permissões iniciais são as da função escolhida (Governança → Privilégios); ajuste depois em Editar.</p>
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
