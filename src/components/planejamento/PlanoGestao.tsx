"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Eye, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cancelarPlano, excluirPlano } from "@/lib/actions/planejamento";
import type { FormState } from "@/lib/actions/cadastros";
import { enviarSemReset } from "./enviarSemReset";

export type AcaoGestaoPlano = {
  acao: "excluir" | "cancelar" | null;
  bloqueado: boolean;
  motivo: string | null;
};

const TEXTOS = {
  excluir: {
    trigger: "Excluir plano",
    curto: "Excluir",
    titulo: "Excluir plano",
    descricao:
      "O plano, suas análises e reservas serão removidos. Reservas ativas são liberadas e o motivo fica registrado na trilha de auditoria.",
    confirmar: "Excluir plano",
    placeholder: "Ex.: plano duplicado gerado do orçamento",
  },
  cancelar: {
    trigger: "Cancelar plano",
    curto: "Cancelar",
    titulo: "Cancelar plano",
    descricao:
      "Já houve baixa de material, então o plano não pode ser excluído. O cancelamento libera as reservas restantes e preserva o histórico.",
    confirmar: "Cancelar plano",
    placeholder: "Ex.: análise interrompida pelo cliente",
  },
} as const;

/**
 * Exclusão (sem baixa) ou cancelamento (com baixa) com motivo obrigatório.
 * O erro aparece dentro do diálogo; o sucesso, junto ao botão e num toast.
 */
export function ExcluirOuCancelarPlano({
  planId,
  nome,
  gestao,
  compacto = false,
  redirecionarPara,
}: {
  planId: number;
  nome: string;
  gestao: AcaoGestaoPlano;
  compacto?: boolean;
  /** Após excluir, o servidor redireciona para a lista (sair da página do plano). */
  redirecionarPara?: "/planejamento";
}) {
  const router = useRouter();
  const campoId = useId();
  const ajudaId = useId();
  const [aberto, setAberto] = useState(false);
  const acao = gestao.acao ?? "excluir";
  const textos = TEXTOS[acao];
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (anterior, dados) => {
    const resultado = await (acao === "cancelar" ? cancelarPlano : excluirPlano)(anterior, dados);
    if (resultado.ok) {
      setAberto(false);
      toast.success(resultado.message ?? "Concluído.");
      router.refresh();
    }
    return resultado;
  }, { ok: false });

  const sucesso = state.ok && state.message && !compacto ? (
    <span role="status" className="text-xs text-brand-700 dark:text-brand-300">
      {state.message}
    </span>
  ) : null;

  if (!gestao.acao) {
    // Depois de cancelar, a ação some; o resultado continua visível aqui.
    if (compacto) return null;
    return (
      <div className="flex flex-col items-start gap-1">
        {gestao.motivo && <p className="text-xs text-muted-foreground">{gestao.motivo}</p>}
        {sucesso}
      </div>
    );
  }

  const Icone = acao === "cancelar" ? Ban : Trash2;
  const triggerClass = compacto
    ? "inline-flex items-center gap-1 rounded-md border border-danger-strong/30 px-2 py-1 text-xs font-medium text-danger-strong hover:bg-danger-soft disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground disabled:hover:bg-transparent"
    : "inline-flex items-center gap-1.5 rounded-md border border-danger-strong/40 px-3 py-2 text-sm font-medium text-danger-strong hover:bg-danger-soft disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground disabled:hover:bg-transparent";

  return (
    <div className={compacto ? "inline-flex" : "flex flex-col items-start gap-1"}>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogTrigger asChild>
          <button
            type="button"
            disabled={gestao.bloqueado}
            className={triggerClass}
            aria-label={compacto ? `${textos.curto} ${nome}` : undefined}
            aria-describedby={gestao.motivo ? ajudaId : undefined}
            title={gestao.motivo ?? undefined}
          >
            <Icone className={compacto ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" />
            {compacto ? textos.curto : textos.trigger}
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-md text-left" showCloseButton={false}>
          <form onSubmit={enviarSemReset(formAction)} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>
                {textos.titulo} “{nome}”?
              </DialogTitle>
              <DialogDescription>{textos.descricao}</DialogDescription>
            </DialogHeader>
            <input type="hidden" name="planejamento_id" value={planId} />
            {redirecionarPara && acao === "excluir" && (
              <input type="hidden" name="redirecionar_para" value={redirecionarPara} />
            )}
            <div>
              <label htmlFor={campoId} className="block text-sm font-medium">
                Motivo
              </label>
              <textarea
                id={campoId}
                name="motivo"
                required
                minLength={3}
                rows={3}
                placeholder={textos.placeholder}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            {state.message && !state.ok && (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-strong">
                {state.message}
              </p>
            )}
            <DialogFooter>
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
              >
                Voltar
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-destructive px-4 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
              >
                {pending ? "Processando…" : textos.confirmar}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {gestao.motivo && (
        <span id={ajudaId} className={compacto ? "sr-only" : "text-xs text-muted-foreground"}>
          {gestao.motivo}
        </span>
      )}
      {sucesso}
    </div>
  );
}

const linkAcao =
  "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted";

/** Ações de linha (Ver / Editar / Excluir ou Cancelar) para listas de planos. */
export function PlanoLinhaAcoes({
  planId,
  nome,
  editavel,
  gestao,
  alinhamento = "justify-end",
}: {
  planId: number;
  nome: string;
  editavel: boolean;
  gestao: AcaoGestaoPlano;
  alinhamento?: "justify-end" | "justify-start";
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${alinhamento}`}>
      <Link href={`/planejamento/${planId}`} className={linkAcao} aria-label={`Ver ${nome}`}>
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        Ver
      </Link>
      {editavel && (
        <Link href={`/planejamento/${planId}#editar`} className={linkAcao} aria-label={`Editar ${nome}`}>
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          Editar
        </Link>
      )}
      <ExcluirOuCancelarPlano planId={planId} nome={nome} gestao={gestao} compacto />
    </div>
  );
}
