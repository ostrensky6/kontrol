"use client";

import { useActionState } from "react";

import { Campo } from "@/components/common/Campo";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SenhaProvisoriaGerada } from "@/components/usuarios/SenhaProvisoriaGerada";
import { criarUsuario, type UsuarioFormState } from "@/lib/actions/usuarios";
import { PAPEIS, type PapelUsuario } from "@/lib/auth/permissions";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";

const ESTADO_INICIAL: UsuarioFormState = { ok: false, message: "" };

/**
 * Cadastra, sem sair do formulário, a pessoa que ainda não tem usuário (o
 * coordenador de um projeto ou laboratório precisa de conta para aprovar). É a
 * mesma ação da tela de Usuários: só o Administrador chega aqui. Depois de
 * criada, a pessoa já vem escolhida no campo que pediu o cadastro.
 */
export function NovaPessoaDialog({
  rotuloCampo,
  papelPadrao,
  nomeInicial,
  emailInicial,
  preAprovado = false,
  aoFechar,
}: {
  /** nome do campo que pediu o cadastro, para o botão final */
  rotuloCampo: string;
  papelPadrao: PapelUsuario;
  /** nome já conhecido (escrito no projeto ou da pré-aprovação) */
  nomeInicial?: string;
  /** e-mail da pré-aprovação */
  emailInicial?: string;
  /** a pessoa foi pré-aprovada e ainda não entrou: a conta nasce agora */
  preAprovado?: boolean;
  /** `usuario` só vem quando a conta foi criada: o formulário a escolhe no campo */
  aoFechar: (usuario?: { id: string; nome: string }) => void;
}) {
  const [estado, acao] = useActionState(criarUsuario, ESTADO_INICIAL);
  const criada = estado.ok && estado.usuario ? estado.usuario : undefined;

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && aoFechar(criada)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cadastrar nova pessoa</DialogTitle>
          <DialogDescription>
            {preAprovado
              ? "Pessoa pré-aprovada que ainda não entrou: a conta é criada agora, com a função escolhida aqui. "
              : "Quem aprova pedidos precisa de usuário no Kontrol. "}
            A conta nasce com uma senha provisória e a pessoa define a senha dela no primeiro acesso.
          </DialogDescription>
        </DialogHeader>

        {criada && estado.senhaProvisoria ? (
          <div className="space-y-3">
            <p role="status" className="text-sm">
              <b>{criada.nome}</b> foi cadastrada.
            </p>
            <SenhaProvisoriaGerada senha={estado.senhaProvisoria} />
            <DialogFooter>
              <Button type="button" size="sm" onClick={() => aoFechar(criada)}>
                Usar em “{rotuloCampo}”
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form action={acao} {...formularioSemPerda(estado)} className="space-y-3">
            <Campo rotulo="Nome" htmlFor="nova-pessoa-nome">
              <Input id="nova-pessoa-nome" name="nome" required autoComplete="off" defaultValue={nomeInicial} />
            </Campo>
            <Campo rotulo="E-mail" htmlFor="nova-pessoa-email">
              <Input id="nova-pessoa-email" name="email" type="email" required autoComplete="off" defaultValue={emailInicial} />
            </Campo>
            <Campo rotulo="Função" htmlFor="nova-pessoa-papel">
              <Select id="nova-pessoa-papel" name="papel" defaultValue={papelPadrao}>
                {PAPEIS.filter((papel) => papel.value !== "admin").map((papel) => (
                  <option key={papel.value} value={papel.value}>
                    {papel.label}
                  </option>
                ))}
              </Select>
            </Campo>
            <MensagemAcao estado={estado.ok ? null : estado} className="rounded-md bg-destructive/10 px-3 py-2 text-xs empty:p-0" />
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => aoFechar()}>
                Voltar
              </Button>
              <SubmitButton size="sm" pendingLabel="Cadastrando…">
                Cadastrar pessoa
              </SubmitButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
