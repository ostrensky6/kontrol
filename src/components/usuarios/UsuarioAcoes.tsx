"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";

import {
  alterarSenhaUsuario,
  alternarSuspensao,
  criarUsuarioPreAprovado,
  editarUsuario,
  excluirUsuario,
  gerarNovaSenhaProvisoria,
  nomearPapelUsuario,
  type UsuarioFormState,
} from "@/lib/actions/usuarios";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PAPEIS } from "@/lib/auth/permissions";
import type { FormState } from "@/lib/actions/cadastros";
import { AssinaturaUsuarioForm } from "./AssinaturaUsuarioForm";
import type { UsuarioRow } from "./UsuariosTable";
import { enviarSemReset, formularioSemPerda } from "@/lib/formulario-sem-perda";
import { SenhaProvisoriaGerada } from "./SenhaProvisoriaGerada";

const initial: FormState = { ok: false, message: "" };
const initialUsuario: UsuarioFormState = { ok: false, message: "" };

type DialogAberto = "editar" | "nomear" | "assinatura" | "senha" | "senha_provisoria" | "apagar" | "pre_aprovar" | null;

function EditarDialog({
  row,
  open,
  onOpenChange,
}: {
  row: UsuarioRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [erro, setErro] = useState("");
  const [pending, startTransition] = useTransition();

  function handle(formData: FormData) {
    startTransition(async () => {
      const res = await editarUsuario(initial, formData);
      if (res.ok) {
        setErro("");
        onOpenChange(false);
      } else {
        setErro(res.message ?? "Não foi possível salvar.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader className="pr-8">
          <DialogTitle>Editar cadastro</DialogTitle>
          <DialogDescription>{row.email} · a função não muda nesta edição.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviarSemReset(handle)} className="grid gap-4">
          <input type="hidden" name="id" value={row.id} />
          <div>
            <label htmlFor={`editar-usuario-nome-${row.id}`} className="block text-xs font-medium text-muted-foreground">
              Nome
            </label>
            <Input
              id={`editar-usuario-nome-${row.id}`}
              name="nome"
              defaultValue={row.nome === "—" ? "" : row.nome}
              className="mt-1"
            />
          </div>
          <div className="space-y-3 border-t border-border pt-4">
            {erro && <p role="alert" className="text-xs text-danger-strong">{erro}</p>}
            <DialogFooter>
              <Button type="submit" disabled={pending} aria-busy={pending}>
                {pending ? "Salvando…" : "Salvar cadastro"}
              </Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NomearPapelDialog({ row, onClose }: { row: UsuarioRow; onClose: () => void }) {
  const campoDestino = useId();
  // A versão que abriu o diálogo é a precondição; não a atualize durante a decisão.
  const [atual] = useState(() => ({ papel: row.papel, label: row.papelLabel }));
  const [destino, setDestino] = useState("");
  const [state, action, pending] = useActionState(nomearPapelUsuario, initialUsuario);
  const opcoes = PAPEIS.filter((papel) => row.papeisDestino?.includes(papel.value));
  const conflito = !state.ok && (state.codigo === "PAPEL_ALTERADO" || row.papel !== atual.papel);
  const recarregar = conflito || (!state.ok && Boolean(state.message));
  const bloqueado = pending || state.ok || recarregar;

  return (
    <Dialog open onOpenChange={(aberto) => { if (!aberto && !pending && !recarregar) onClose(); }}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        showCloseButton={!pending && !recarregar}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>Trocar função</DialogTitle>
          <DialogDescription>{row.nome === "—" ? row.email : `${row.nome} · ${row.email}`}</DialogDescription>
        </DialogHeader>
        <form action={action} onSubmit={(event) => { if (bloqueado) event.preventDefault(); }} aria-busy={pending} className="grid gap-4">
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="papel_atual_esperado" value={atual.papel} />
          <p className="text-sm">
            <span className="text-muted-foreground">{state.ok ? "Função anterior: " : "Função atual: "}</span>
            <strong>{atual.label}</strong>
          </p>
          <div>
            <label htmlFor={campoDestino} className="block text-sm font-medium">Função de destino</label>
            <Select
              id={campoDestino}
              name="papel_destino"
              value={destino}
              onChange={(event) => setDestino(event.target.value)}
              required
              disabled={bloqueado}
              className="mt-1 min-h-11"
            >
              <option value="" disabled>Selecione uma função</option>
              {opcoes.map((papel) => (
                <option key={papel.value} value={papel.value}>{papel.label}</option>
              ))}
              {bloqueado && destino && !opcoes.some((papel) => papel.value === destino) && (
                <option value={destino} disabled>{PAPEIS.find((papel) => papel.value === destino)?.label}</option>
              )}
            </Select>
          </div>
          <p className="text-sm text-muted-foreground">
            A pessoa passa a usar as permissões da função de destino, definidas em Governança → Privilégios.
            Esta ação não altera o cadastro nem a suspensão.
          </p>
          {conflito ? (
            <p role="alert" className="text-sm text-danger-strong">
              A função atual não foi confirmada. Recarregue a lista e confira a função antes de fazer uma nova tentativa.
            </p>
          ) : state.message && (
            <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-success-strong" : "text-sm text-danger-strong"}>
              {state.message}
            </p>
          )}
          <DialogFooter>
            {recarregar ? (
              <Button type="button" disabled={pending} onClick={() => window.location.reload()}>Recarregar lista</Button>
            ) : state.ok ? (
              <Button type="button" onClick={onClose}>Concluir</Button>
            ) : (
              <>
                <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancelar</Button>
                <Button type="submit" disabled={bloqueado || !opcoes.some((papel) => papel.value === destino)}>
                  {pending ? "Confirmando…" : "Confirmar troca de função"}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssinaturaDialog({
  row,
  open,
  onOpenChange,
}: {
  row: UsuarioRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload da assinatura</DialogTitle>
          <DialogDescription>
            Imagem PNG da assinatura de {row.nome}. O fundo claro é removido e ela entra nas propostas emitidas por esse usuário.
          </DialogDescription>
        </DialogHeader>
        <AssinaturaUsuarioForm
          userId={row.id}
          assinaturaPath={row.assinaturaPath}
          assinaturaUrl={row.assinaturaUrl}
        />
      </DialogContent>
    </Dialog>
  );
}

export function UploadAssinaturaButton({ row }: { row: UsuarioRow }) {
  const [open, setOpen] = useState(false);
  if (!row.temAcesso) {
    return <span className="text-xs text-muted-foreground/80">Após cadastro</span>;
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        {row.assinaturaUrl ? "Trocar" : "Upload"}
      </Button>
      <AssinaturaDialog row={row} open={open} onOpenChange={setOpen} />
    </>
  );
}

function PreAprovarDialog({
  row,
  open,
  onOpenChange,
}: {
  row: UsuarioRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [state, action, pending] = useActionState(criarUsuarioPreAprovado, initialUsuario);
  const podeCadastrar = row.papel === "laboratorio";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cadastrar acesso pré-aprovado</DialogTitle>
          <DialogDescription>
            {podeCadastrar
              ? `A conta começa em Laboratório e gera uma senha provisória para ${row.email}. Depois do cadastro, use Trocar função quando a ação estiver disponível.`
              : `A pré-aprovação de ${row.email} está registrada como ${row.papelLabel}. Só pré-aprovações em Laboratório podem abrir conta por este fluxo.`}
          </DialogDescription>
        </DialogHeader>
        {podeCadastrar ? (
          <form action={action} {...formularioSemPerda(state)} aria-busy={pending} className="space-y-4">
            <input type="hidden" name="pre_aprovado_id" value={row.preAprovadoId ?? ""} />
            {state.message && (
              <p role={state.ok ? "status" : "alert"} className={`text-xs ${state.ok ? "text-brand-700 dark:text-brand-300" : "text-danger-strong"}`}>
                {state.message}
              </p>
            )}
            {state.ok && state.senhaProvisoria && <SenhaProvisoriaGerada senha={state.senhaProvisoria} />}
            <DialogFooter>
              <Button type="submit" disabled={pending || state.ok}>
                {pending ? "Cadastrando…" : state.ok ? "Acesso criado" : "Cadastrar acesso"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AlterarSenhaDialog({
  row,
  open,
  onOpenChange,
}: {
  row: UsuarioRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [state, action, pending] = useActionState(alterarSenhaUsuario, initial);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alterar senha</DialogTitle>
          <DialogDescription>
            Nova senha para {row.email}. Ela não fica visível para ninguém.
          </DialogDescription>
        </DialogHeader>
        <form action={action} {...formularioSemPerda(state)} className="space-y-4">
          <input type="hidden" name="id" value={row.id} />
          <div>
            <label className="block text-xs font-medium text-muted-foreground">Nova senha</label>
            <Input
              name="senha"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              className="mt-1"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground">Confirmar senha</label>
            <Input
              name="confirmar"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              className="mt-1"
            />
          </div>
          <label className="flex items-start gap-2 rounded-md border border-border p-3 text-xs text-muted-foreground">
            <Checkbox name="exigir_troca" className="mt-0.5" />
            <span>
              <span className="block font-medium text-foreground">
                Exigir troca no próximo login
              </span>
              <span className="block leading-4">
                Use quando a senha foi definida pelo administrador e deve ser substituída pelo usuário.
              </span>
            </span>
          </label>
          {state.message && (
            <p className={`text-xs ${state.ok ? "text-brand-700 dark:text-brand-300" : "text-danger-strong"}`}>
              {state.message}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending || state.ok}>
              {pending ? "Salvando…" : state.ok ? "Senha atualizada" : "Alterar senha"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SenhaProvisoriaDialog({
  row,
  open,
  onOpenChange,
}: {
  row: UsuarioRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [state, action, pending] = useActionState(gerarNovaSenhaProvisoria, initialUsuario);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gerar senha provisória</DialogTitle>
          <DialogDescription>
            Cria uma senha provisória nova para {row.email}. A senha atual deixa de valer, e a pessoa
            define a senha pessoal no próximo acesso.
          </DialogDescription>
        </DialogHeader>
        <form action={action} {...formularioSemPerda(state)} className="space-y-4">
          <input type="hidden" name="id" value={row.id} />
          {state.message && (
            <p className={`text-xs ${state.ok ? "text-brand-700 dark:text-brand-300" : "text-danger-strong"}`}>
              {state.message}
            </p>
          )}
          {state.ok && state.senhaProvisoria && <SenhaProvisoriaGerada senha={state.senhaProvisoria} />}
          <DialogFooter>
            <Button type="submit" disabled={pending || state.ok}>
              {pending ? "Gerando…" : state.ok ? "Senha gerada" : "Gerar senha provisória"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ExcluirDialog({
  row,
  open,
  onOpenChange,
}: {
  row: UsuarioRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [state, action, pending] = useActionState(excluirUsuario, initial);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apagar usuário</DialogTitle>
          <DialogDescription>
            Esta ação é irreversível. {row.email} perderá o acesso e o cadastro será apagado. O
            histórico de auditoria das ações dele é preservado.
          </DialogDescription>
        </DialogHeader>
        <form action={action} {...formularioSemPerda(state)} className="space-y-4">
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="email" value={row.email} />
          {state.message && !state.ok && <p className="text-xs text-danger-strong">{state.message}</p>}
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Apagando…" : "Apagar definitivamente"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UsuarioAcoes({ row }: { row: UsuarioRow }) {
  const [dialog, setDialog] = useState<DialogAberto>(null);
  const [, startTransition] = useTransition();
  const nomeAusente = row.temAcesso && row.nome === "—";

  function suspender() {
    const fd = new FormData();
    fd.set("id", row.id);
    fd.set("suspender", row.suspenso ? "0" : "1");
    startTransition(async () => {
      const resultado = await alternarSuspensao(fd);
      if (resultado.ok) toast.success(resultado.message);
      else toast.error(resultado.message);
    });
  }

  return (
    <div className="flex flex-col items-end justify-end gap-1 md:flex-row md:items-center">
      {nomeAusente && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 md:h-8"
          onClick={() => setDialog("editar")}
        >
          Completar nome
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-11 w-11 md:h-8 md:w-8"
            aria-label={`Ações de ${nomeAusente ? row.email : row.nome}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!row.temAcesso ? (
            <DropdownMenuItem onSelect={() => setDialog("pre_aprovar")}>Cadastrar acesso</DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onSelect={() => setDialog("editar")}>Editar cadastro</DropdownMenuItem>
              {Boolean(row.papeisDestino?.length) && (
                <DropdownMenuItem onSelect={() => setDialog("nomear")}>Trocar função</DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setDialog("assinatura")}>Upload assinatura</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog("senha")}>Alterar senha</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog("senha_provisoria")}>
                Gerar senha provisória
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={suspender}>
                {row.suspenso ? "Reativar" : "Suspender"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setDialog("apagar")}
                className="text-danger-strong focus:text-danger-strong"
              >
                Apagar
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {row.temAcesso && (
        <>
          <EditarDialog row={row} open={dialog === "editar"} onOpenChange={(v) => setDialog(v ? "editar" : null)} />
          {dialog === "nomear" && <NomearPapelDialog row={row} onClose={() => setDialog(null)} />}
          <AssinaturaDialog row={row} open={dialog === "assinatura"} onOpenChange={(v) => setDialog(v ? "assinatura" : null)} />
          <AlterarSenhaDialog row={row} open={dialog === "senha"} onOpenChange={(v) => setDialog(v ? "senha" : null)} />
          <SenhaProvisoriaDialog
            row={row}
            open={dialog === "senha_provisoria"}
            onOpenChange={(v) => setDialog(v ? "senha_provisoria" : null)}
          />
          <ExcluirDialog row={row} open={dialog === "apagar"} onOpenChange={(v) => setDialog(v ? "apagar" : null)} />
        </>
      )}
      {!row.temAcesso && (
        <PreAprovarDialog row={row} open={dialog === "pre_aprovar"} onOpenChange={(v) => setDialog(v ? "pre_aprovar" : null)} />
      )}
    </div>
  );
}
