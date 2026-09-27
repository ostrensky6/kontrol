"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { HelpTip } from "@/components/common/HelpTip";
import { atualizarPedidoInterno, excluirPedidoInterno } from "@/lib/actions/pedidos-internos";
import { FormComMensagem } from "./FormComMensagem";

type Opcao = {
  id: number;
  nome: string | null;
  coordenador?: string | null;
  coordenador_nome?: string | null;
  coordenador_email?: string | null;
};

const inputCls =
  "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm";

export function PedidoInternoCabecalhoAcoes({
  pedidoId,
  numero,
  titulo,
  projetoId,
  dataNecessidade,
  urgencia,
  tipoDemanda,
  fonteRecurso,
  justificativa,
  projetos,
  status,
  podeExcluir,
}: {
  pedidoId: number;
  numero: string;
  titulo: string;
  projetoId: number | null;
  dataNecessidade: string | null;
  urgencia: string | null;
  tipoDemanda: string | null;
  fonteRecurso: string | null;
  justificativa: string | null;
  projetos: Opcao[];
  status: string;
  podeExcluir: boolean;
}) {
  const [editando, setEditando] = useState(false);
  return (
    <div className="flex items-center gap-2">
      {/* Editar */}
      <Dialog open={editando} onOpenChange={setEditando}>
        <DialogTrigger asChild>
          <button className="inline-flex items-center gap-1 rounded-md border border-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
            <Pencil className="h-3.5 w-3.5" />
            Editar
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Editar pedido {numero}</DialogTitle>
            <DialogDescription>Atualize os dados do pedido.</DialogDescription>
          </DialogHeader>
          <FormComMensagem action={atualizarPedidoInterno} onSuccess={() => setEditando(false)} className="grid gap-3">
            <input type="hidden" name="pedido_interno_id" value={pedidoId} />
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Título do pedido</label>
              <input name="titulo" required defaultValue={titulo} className={inputCls} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-muted-foreground">Projeto</label>
                <select name="projeto_id" defaultValue={projetoId ?? ""} className={inputCls}>
                  <option value="">—</option>
                  {projetos.map((projeto) => (
                    <option key={projeto.id} value={projeto.id}>
                      {projeto.nome}
                      {projeto.coordenador_nome || projeto.coordenador ? ` · ${projeto.coordenador_nome ?? projeto.coordenador}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground">Necessidade</label>
                <input name="data_necessidade" type="date" defaultValue={dataNecessidade ?? ""} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground">Urgência</label>
                <select name="urgencia" defaultValue={urgencia ?? "normal"} className={inputCls}>
                  <option value="baixa">Baixa</option>
                  <option value="normal">Normal</option>
                  <option value="alta">Alta</option>
                  <option value="critica">Crítica</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground">Tipo</label>
                <select name="tipo_demanda" defaultValue={tipoDemanda ?? "laboratorio"} className={inputCls}>
                  <option value="laboratorio">Laboratório</option>
                  <option value="campo">Campo</option>
                  <option value="laboratorio_campo">Lab./campo</option>
                  <option value="administrativo">Administrativo</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Fonte provável</label>
              <input name="fonte_recurso" defaultValue={fonteRecurso ?? ""} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Justificativa</label>
              <textarea name="justificativa" rows={3} defaultValue={justificativa ?? ""} className={inputCls} />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <button type="button" className="rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
                  Cancelar
                </button>
              </DialogClose>
              <button type="submit" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500">
                Salvar alterações
              </button>
            </DialogFooter>
          </FormComMensagem>
        </DialogContent>
      </Dialog>

      {/* Excluir */}
      {podeExcluir && status === "rascunho" && (
        <Dialog>
          <DialogTrigger asChild>
            <button className="inline-flex items-center gap-1 rounded-md border border-danger-strong/30 px-3 py-1.5 text-xs font-medium text-danger-strong hover:bg-danger-soft">
              <Trash2 className="h-3.5 w-3.5" />
              Excluir
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <div className="flex items-center gap-1">
                <DialogTitle>Excluir rascunho {numero}?</DialogTitle>
                <HelpTip title="Excluir ou cancelar?">
                  <p>
                    Excluir só vale para <b>rascunhos</b> que ainda não entraram no fluxo. Pedidos em
                    andamento devem ser <b>cancelados</b>, com motivo, para manter o histórico.
                  </p>
                </HelpTip>
              </div>
              <DialogDescription>
                O pedido <b>{titulo}</b> será apagado e não poderá ser recuperado.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <button type="button" className="rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
                  Cancelar
                </button>
              </DialogClose>
              <FormComMensagem action={excluirPedidoInterno} className="flex flex-col items-end gap-1">
                <input type="hidden" name="pedido_interno_id" value={pedidoId} />
                <button type="submit" className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90">
                  Excluir rascunho
                </button>
              </FormComMensagem>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
