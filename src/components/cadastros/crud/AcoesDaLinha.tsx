"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import {
  alterarAtivoRegistro,
  excluirRegistro,
  excluirInsumoEmCascata,
  type FormState,
} from "@/lib/actions/cadastros";

export function enviarExclusaoSePermitida(
  bloqueado: boolean,
  action: (formData: FormData) => void,
  formData: FormData,
) {
  if (!bloqueado) action(formData);
}

export function RowActions({
  onEdit,
  onRetorno,
  slug,
  id,
  rotulo,
  ativo,
  semExcluir = false,
}: {
  onEdit: () => void;
  onRetorno: (estado: FormState) => void;
  slug: string;
  id: number;
  rotulo: string;
  ativo?: boolean;
  semExcluir?: boolean;
}) {
  const [confirmar, setConfirmar] = useState(false);
  const [alterandoAtivo, setAlterandoAtivo] = useState(false);
  const [exclusaoState, exclusaoAction, exclusaoPending] = useActionState<FormState, FormData>(
    excluirRegistro,
    { ok: false },
  );
  const [cascataState, cascataAction, cascataPending] = useActionState<FormState, FormData>(
    excluirInsumoEmCascata,
    { ok: false },
  );
  const acaoAtivoDisponivel = slug === "insumos" && typeof ativo === "boolean";
  const exclusaoBloqueada = slug === "insumos" && !exclusaoState.ok && Boolean(exclusaoState.message);
  const exclusaoProtegida = useCallback(
    (formData: FormData) =>
      enviarExclusaoSePermitida(exclusaoBloqueada, exclusaoAction, formData),
    [exclusaoBloqueada, exclusaoAction],
  );

  return (
    <>
      <DropdownMenu>
        <Tooltip content="Ações do registro">
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="Abrir ações do registro">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>Editar</DropdownMenuItem>
          {acaoAtivoDisponivel && (
            <DropdownMenuItem onSelect={() => setAlterandoAtivo(true)}>
              {ativo ? "Inativar" : "Reativar"}
            </DropdownMenuItem>
          )}
          {!semExcluir && (
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmar(true)}>
              Excluir
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmar && (
        <DeleteRegistroDialog
          open={confirmar}
          onOpenChange={setConfirmar}
          slug={slug}
          id={id}
          rotulo={rotulo}
          state={exclusaoState}
          action={exclusaoProtegida}
          pending={exclusaoPending}
          bloqueado={exclusaoBloqueada}
          cascata={slug === "insumos" ? { state: cascataState, action: cascataAction, pending: cascataPending } : undefined}
          onExcluido={onRetorno}
          onInativar={acaoAtivoDisponivel && ativo ? () => {
            setConfirmar(false);
            setAlterandoAtivo(true);
          } : undefined}
        />
      )}
      {alterandoAtivo && acaoAtivoDisponivel && (
        <AlterarAtivoDialog
          open={alterandoAtivo}
          onOpenChange={setAlterandoAtivo}
          slug={slug}
          id={id}
          rotulo={rotulo}
          ativo={ativo}
          onAtualizado={onRetorno}
        />
      )}
    </>
  );
}

/** Cadastros que têm "Ativo": a saída para registro já usado é desativar. */
const COM_ATIVO = new Set(["clientes", "fornecedores", "insumos", "tipo_insumos", "tecnicos"]);

function AlterarAtivoDialog({
  open,
  onOpenChange,
  slug,
  id,
  rotulo,
  ativo,
  onAtualizado,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  id: number;
  rotulo: string;
  ativo: boolean;
  onAtualizado: (estado: FormState) => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<FormState, FormData>(
    alterarAtivoRegistro,
    { ok: false },
  );
  const rotuloAcao = ativo ? "Inativar" : "Reativar";

  useEffect(() => {
    if (!state.ok) return;
    onAtualizado(state);
    onOpenChange(false);
    router.refresh();
  }, [state, router, onAtualizado, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !pending && onOpenChange(nextOpen)}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-sm overflow-y-auto"
        showCloseButton={!pending}
      >
        <DialogHeader>
          <DialogTitle>{rotuloAcao} insumo</DialogTitle>
          <DialogDescription>
            {ativo
              ? <>O insumo <b>“{rotulo}”</b> deixa de aparecer como opção para novos usos, mas seus vínculos e todo o histórico são preservados.</>
              : <>O insumo <b>“{rotulo}”</b> volta a ficar disponível para novos usos. O histórico existente permanece preservado.</>}
          </DialogDescription>
        </DialogHeader>

        <MensagemAcao
          estado={state.ok ? null : state}
          className="rounded-md bg-destructive/10 px-3 py-2 text-xs empty:p-0"
        />

        <form action={action} {...formularioSemPerda(state)}>
          <input type="hidden" name="_slug" value={slug} />
          <input type="hidden" name="_id" value={id} />
          <input type="hidden" name="ativo" value={String(!ativo)} />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Voltar
            </Button>
            <SubmitButton
              variant={ativo ? "outline" : "default"}
              size="sm"
              pendingLabel={ativo ? "Inativando…" : "Reativando…"}
            >
              {rotuloAcao}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteRegistroDialog({
  open,
  onOpenChange,
  slug,
  id,
  rotulo,
  state,
  action,
  pending,
  bloqueado,
  cascata,
  onExcluido,
  onInativar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  id: number;
  rotulo: string;
  state: FormState;
  action: (formData: FormData) => void;
  pending: boolean;
  bloqueado: boolean;
  cascata?: { state: FormState; action: (formData: FormData) => void; pending: boolean };
  onExcluido: (estado: FormState) => void;
  onInativar?: () => void;
}) {
  const router = useRouter();
  const [entendeuCascata, setEntendeuCascata] = useState(false);
  const estadoFinal = cascata?.state.ok ? cascata.state : state;
  useEffect(() => {
    // sucesso: a linha some no refresh e este modal desmonta junto; a
    // confirmação é anunciada pela lista.
    if (!estadoFinal.ok) return;
    onExcluido(estadoFinal);
    router.refresh();
  }, [estadoFinal, router, onExcluido]);
  const blockers = state.blockers ?? [];
  const ocupado = pending || Boolean(cascata?.pending);
  // A cascata só é oferecida quando o banco comprovou o que será apagado.
  const ofereceCascata = Boolean(cascata) && bloqueado && blockers.length > 0;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !ocupado && onOpenChange(nextOpen)}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-sm overflow-y-auto"
        showCloseButton={!ocupado}
      >
        <DialogHeader>
          <DialogTitle>Excluir registro</DialogTitle>
          <DialogDescription>
            Tem certeza que deseja excluir <b>“{rotulo}”</b>? Esta ação não pode
            ser desfeita.
            {slug === "insumos"
              ? " Se houver vínculos, o Kontrol mostra o que seria apagado junto antes de excluir."
              : COM_ATIVO.has(slug) && " Se houver vínculos, o Kontrol preserva o histórico e impede a exclusão; inative o registro."}
          </DialogDescription>
        </DialogHeader>
        <MensagemAcao estado={state.ok ? null : state} className="rounded-md bg-destructive/10 px-3 py-2 text-xs empty:p-0" />
        {bloqueado && (
          <section className="rounded-md border border-border bg-muted/50 p-3 text-xs" aria-labelledby={`vinculos-${id}`}>
            <h3 id={`vinculos-${id}`} className="font-semibold text-foreground">
              Vínculos que preservam o histórico
            </h3>
            <ul className="mt-2 grid gap-1.5">
              {blockers.map((blocker, index) => {
                const conteudo = (
                  <>
                    <span className="min-w-0 break-words">
                      {blocker.rotulo}
                      {blocker.identificador ? ` (${blocker.identificador})` : ""}
                    </span>
                    <span className="shrink-0 tabular-nums">{blocker.contagem}</span>
                  </>
                );
                return (
                  <li key={`${blocker.tipo}-${blocker.identificador ?? index}`}>
                    {blocker.href ? (
                      <Link
                        href={blocker.href}
                        className="flex min-h-11 items-start justify-between gap-3 rounded px-2 py-1.5 text-brand-700 hover:bg-accent hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:text-brand-300"
                      >
                        {conteudo}
                      </Link>
                    ) : (
                      <div className="flex min-h-11 items-start justify-between gap-3 px-2 py-1.5">
                        {conteudo}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-muted-foreground">
              Nada foi removido. Os vínculos e o histórico permanecem preservados.
            </p>
          </section>
        )}
        {ofereceCascata && cascata && (
          <section className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs" aria-labelledby={`cascata-${id}`}>
            <h3 id={`cascata-${id}`} className="font-semibold text-destructive">
              Excluir junto com o histórico
            </h3>
            <p className="mt-1 text-muted-foreground">
              Apaga o insumo e tudo o que está listado acima: lotes, movimentações, itens de compras e
              pedidos, recebimentos, reservas e códigos. Os saldos e relatórios passados mudam. Não pode
              ser desfeito; a auditoria registra a exclusão.
            </p>
            <MensagemAcao
              estado={cascata.state.ok ? null : cascata.state}
              className="mt-2 rounded-md bg-destructive/10 px-3 py-2 empty:p-0"
            />
            <form action={cascata.action} className="mt-2 grid gap-2">
              <input type="hidden" name="_id" value={id} />
              <input type="hidden" name="confirmacao" value={entendeuCascata ? "apagar" : ""} />
              <label className="flex items-start gap-2">
                <Checkbox
                  checked={entendeuCascata}
                  onChange={(e) => setEntendeuCascata(e.target.checked)}
                  disabled={ocupado}
                  className="mt-px shrink-0"
                />
                <span>Entendo que o histórico deste insumo será apagado.</span>
              </label>
              <SubmitButton
                variant="destructive"
                size="sm"
                pendingLabel="Excluindo tudo…"
                disabled={ocupado || !entendeuCascata}
                className="justify-self-end"
              >
                Excluir tudo
              </SubmitButton>
            </form>
          </section>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={ocupado}
          >
            Voltar
          </Button>
          {bloqueado && onInativar && (
            <Button type="button" variant="outline" size="sm" onClick={onInativar}>
              Inativar
            </Button>
          )}
          <form action={action} {...formularioSemPerda(state)}>
            <input type="hidden" name="_slug" value={slug} />
            <input type="hidden" name="_id" value={id} />
            <SubmitButton
              variant="destructive"
              size="sm"
              pendingLabel="Excluindo…"
              disabled={pending || bloqueado}
            >
              Excluir
            </SubmitButton>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
