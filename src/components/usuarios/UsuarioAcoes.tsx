"use client";

import { useActionState, useState, useTransition } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";

import {
  alterarSenhaUsuario,
  alternarSuspensao,
  criarUsuarioPreAprovado,
  editarPreAprovado,
  editarUsuario,
  excluirPreAprovado,
  excluirUsuario,
  gerarNovaSenhaProvisoria,
  removerUsuario,
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
import { PERMISSOES, PAPEIS, normalizePermissions } from "@/lib/auth/permissions";
import type { FormState } from "@/lib/actions/cadastros";
import { AssinaturaUsuarioForm } from "./AssinaturaUsuarioForm";
import { HelpTip } from "@/components/common/HelpTip";
import type { UsuarioRow } from "./UsuariosTable";
import { enviarSemReset, formularioSemPerda } from "@/lib/formulario-sem-perda";
import { SenhaProvisoriaGerada } from "./SenhaProvisoriaGerada";
import { faixaDoModulo } from "@/components/governanca/faixas";
import { cn } from "@/lib/utils";

const initial: FormState = { ok: false, message: "" };
const initialUsuario: UsuarioFormState = { ok: false, message: "" };

const permissoesPorModulo = new Map<string, typeof PERMISSOES>();
for (const permissao of PERMISSOES) {
  permissoesPorModulo.set(permissao.modulo, [...(permissoesPorModulo.get(permissao.modulo) ?? []), permissao]);
}
const GRUPOS_PERMISSOES = Array.from(permissoesPorModulo.entries());

type DialogAberto =
  | "editar"
  | "assinatura"
  | "senha"
  | "senha_provisoria"
  | "apagar"
  | "remover"
  | "pre_aprovar"
  | "editar_pre"
  | null;

function permissoesEfetivasDaLinha(row: UsuarioRow, papel: string) {
  const base = row.categorias?.[papel] ?? normalizePermissions(papel, {});
  const excecoes =
    typeof row.permissoes === "object" && row.permissoes !== null
      ? (row.permissoes as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    Object.entries(base).map(([chave, valor]) => [
      chave,
      papel === "admin" ? true : typeof excecoes[chave] === "boolean" ? Boolean(excecoes[chave]) : valor,
    ]),
  ) as Record<string, boolean>;
}

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
  const [papel, setPapel] = useState(row.papel);
  // Efetivo = categoria do papel + exceções do usuário (a caixinha manda, 0124).
  const permissoes = permissoesEfetivasDaLinha(row, papel);

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
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-3xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <DialogHeader className="pr-8">
          <DialogTitle>Editar usuário</DialogTitle>
          <DialogDescription>{row.email}</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviarSemReset(handle)} className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-4">
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="permissoes_presentes" value="1" />
          <div className="grid gap-3 sm:grid-cols-2">
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
            <div>
              <label htmlFor={`editar-usuario-papel-${row.id}`} className="block text-xs font-medium text-muted-foreground">
                Função
              </label>
              <Select
                id={`editar-usuario-papel-${row.id}`}
                name="papel"
                value={papel}
                onChange={(event) => setPapel(event.target.value)}
                className="mt-1 h-9"
              >
                {PAPEIS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="min-h-0 overflow-y-auto pr-1">
            <div className="mb-2 flex items-center gap-1">
              <p className="text-xs font-medium text-muted-foreground">Permissões efetivas</p>
              <HelpTip title="Permissões efetivas">
                <p>
                  O que esta pessoa pode fazer de fato. Parte do padrão da <b>função</b> (Governança →
                  Privilégios); o que você marcar ou desmarcar aqui vale só para ela.
                </p>
              </HelpTip>
            </div>
            <div className="space-y-2">
              {GRUPOS_PERMISSOES.map(([modulo, permissoesModulo], indice) => (
                <details key={modulo} className={cn("rounded-md border border-border", faixaDoModulo(indice))}>
                  <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    {modulo}
                    <span className="float-right text-xs font-normal text-muted-foreground">
                      {permissoesModulo.length} permissões
                    </span>
                  </summary>
                  <fieldset className="border-t border-border p-2">
                    <legend className="sr-only">{modulo}</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {permissoesModulo.map((permissao) => (
                        <label
                          key={permissao.key}
                          className="flex items-start gap-2 rounded-md border border-border p-2 text-xs"
                        >
                          <Checkbox
                            key={`${papel}-${permissao.key}`}
                            name="permissoes"
                            value={permissao.key}
                            defaultChecked={Boolean(permissoes[permissao.key])}
                            disabled={papel === "admin"}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block font-semibold text-foreground">{permissao.label}</span>
                            <span className="block leading-4 text-muted-foreground">{permissao.descricao}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </details>
              ))}
            </div>
            {papel === "admin" && (
              <p className="mt-2 text-xs text-muted-foreground">Administradores sempre recebem todas as permissões.</p>
            )}
          </div>
          <div className="space-y-3 border-t border-border pt-4">
            {erro && <p role="alert" className="text-xs text-danger-strong">{erro}</p>}
            <DialogFooter>
              <Button type="submit" disabled={pending} aria-busy={pending}>
                {pending ? "Salvando…" : "Salvar"}
              </Button>
            </DialogFooter>
          </div>
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

/**
 * Pré-aprovado ainda sem conta: o Administrador corrige nome e função antes de
 * a pessoa entrar (ex.: pré-aprovada como Laboratório que vai coordenar um
 * projeto). "Cadastrar acesso" cria a conta já com o que ficar aqui.
 */
function EditarPreAprovadoDialog({
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
      const res = await editarPreAprovado(initial, formData);
      if (res.ok) {
        setErro("");
        toast.success(res.message);
        onOpenChange(false);
      } else {
        setErro(res.message ?? "Não foi possível salvar.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar pré-aprovado</DialogTitle>
          <DialogDescription>
            {row.email} ainda não entrou no Kontrol. A conta será criada com este nome e esta função.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={enviarSemReset(handle)} className="space-y-3">
          <input type="hidden" name="pre_aprovado_id" value={row.preAprovadoId ?? ""} />
          <div>
            <label htmlFor={`editar-pre-nome-${row.id}`} className="block text-xs font-medium text-muted-foreground">
              Nome
            </label>
            <Input
              id={`editar-pre-nome-${row.id}`}
              name="nome"
              required
              defaultValue={row.nome === "—" ? "" : row.nome}
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor={`editar-pre-papel-${row.id}`} className="block text-xs font-medium text-muted-foreground">
              Função
            </label>
            <Select id={`editar-pre-papel-${row.id}`} name="papel" defaultValue={row.papel} className="mt-1 h-9">
              {PAPEIS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          {erro && <p className="text-xs text-danger-strong">{erro}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cadastrar acesso pré-aprovado</DialogTitle>
          <DialogDescription>
            Cria a conta de {row.email} com a função {row.papelLabel} e uma senha provisória gerada
            só para essa pessoa.
          </DialogDescription>
        </DialogHeader>
        <form action={action} {...formularioSemPerda(state)} className="space-y-4">
          <input type="hidden" name="pre_aprovado_id" value={row.preAprovadoId ?? ""} />
          {state.message && (
            <p className={`text-xs ${state.ok ? "text-brand-700 dark:text-brand-300" : "text-danger-strong"}`}>
              {state.message}
            </p>
          )}
          {state.ok && state.senhaProvisoria && <SenhaProvisoriaGerada senha={state.senhaProvisoria} />}
          <DialogFooter>
            <Button type="submit" disabled={pending || state.ok}>
              {pending ? "Cadastrando..." : state.ok ? "Acesso criado" : "Cadastrar acesso"}
            </Button>
          </DialogFooter>
        </form>
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
          <DialogTitle>Apagar usuário de vez</DialogTitle>
          <DialogDescription>
            Só para conta criada por engano. Esta ação é irreversível: {row.email} perde o acesso e o cadastro é
            apagado. Para quem saiu da equipe, use o ícone de lixeira (Remover), que guarda o histórico com o nome.
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

/**
 * Remover da equipe (0180): para quem não faz mais parte do processo. Não
 * apaga nada: bloqueia o login e tira da lista; o histórico fica com o nome.
 * Pré-aprovado (nunca entrou) tem a pré-aprovação retirada.
 */
function RemoverDialog({
  row,
  open,
  onOpenChange,
}: {
  row: UsuarioRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState("");
  const nome = row.nome === "—" ? row.email : row.nome;

  function confirmar() {
    const fd = new FormData();
    if (row.temAcesso) fd.set("id", row.id);
    else fd.set("pre_aprovado_id", String(row.preAprovadoId ?? ""));
    startTransition(async () => {
      const res = row.temAcesso ? await removerUsuario(fd) : await excluirPreAprovado(fd);
      if (res.ok) {
        setErro("");
        toast.success(res.message, { duration: 10000 });
        onOpenChange(false);
      } else {
        setErro(res.message ?? "Não foi possível remover.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{row.temAcesso ? "Remover usuário" : "Retirar pré-aprovação"}</DialogTitle>
          <DialogDescription>
            {row.temAcesso ? (
              <>
                {nome} deixa de entrar no Kontrol e sai da lista de Usuários. Pedidos, movimentações, aprovações e a
                auditoria continuam com o nome dele. Para desfazer, use “Mostrar removidos” e Reativar.
              </>
            ) : (
              <>{nome} ainda não entrou no Kontrol; a pré-aprovação é retirada e nada mais muda.</>
            )}
          </DialogDescription>
        </DialogHeader>
        {erro && <p role="alert" className="text-xs text-danger-strong">{erro}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" onClick={confirmar} disabled={pending} aria-busy={pending}>
            {pending ? "Removendo…" : row.temAcesso ? "Remover" : "Retirar"}
          </Button>
        </DialogFooter>
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
      {!row.removido && !row.ehVoce && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-11 w-11 text-danger-strong hover:text-danger-strong md:h-8 md:w-8"
          aria-label={`Remover ${nomeAusente ? row.email : row.nome}`}
          title="Remover usuário (guarda o histórico)"
          onClick={() => setDialog("remover")}
        >
          <Trash2 />
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
            <>
              <DropdownMenuItem onSelect={() => setDialog("editar_pre")}>Editar</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog("pre_aprovar")}>Cadastrar acesso</DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem onSelect={() => setDialog("editar")}>Editar</DropdownMenuItem>
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
                Apagar de vez
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {row.temAcesso && (
        <>
          <EditarDialog row={row} open={dialog === "editar"} onOpenChange={(v) => setDialog(v ? "editar" : null)} />
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
      <RemoverDialog row={row} open={dialog === "remover"} onOpenChange={(v) => setDialog(v ? "remover" : null)} />
      {!row.temAcesso && (
        <>
          <EditarPreAprovadoDialog row={row} open={dialog === "editar_pre"} onOpenChange={(v) => setDialog(v ? "editar_pre" : null)} />
          <PreAprovarDialog row={row} open={dialog === "pre_aprovar"} onOpenChange={(v) => setDialog(v ? "pre_aprovar" : null)} />
        </>
      )}
    </div>
  );
}
