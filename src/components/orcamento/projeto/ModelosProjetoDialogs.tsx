"use client";

import { useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { BookmarkPlus, LayoutTemplate } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormAcao, type AcaoFormulario } from "./FormAcao";

export type ModeloResumo = { id: number; nome: string; descricao: string | null; itens: number };

const botaoSecundario =
  "inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-muted";
const campo = "mt-1 block w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm";

function Enviar({ rotulo, pendente }: { rotulo: string; pendente: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-60"
    >
      {pending ? pendente : rotulo}
    </button>
  );
}

function Cancelar({ fechar }: { fechar: () => void }) {
  return (
    <button type="button" onClick={fechar} className="rounded-md border border-input px-4 py-1.5 text-sm font-medium hover:bg-muted">
      Cancelar
    </button>
  );
}

/** Usa um modelo neste orçamento (Fase E): os itens entram com o valor atual do catálogo. */
export function UsarModeloDialog({
  modelos,
  orcamentoProjetoId,
  demandaId,
  action,
}: {
  modelos: ModeloResumo[];
  orcamentoProjetoId: number;
  demandaId: number;
  action: AcaoFormulario;
}) {
  const [aberto, setAberto] = useState(false);
  const [escolhido, setEscolhido] = useState("");
  const id = useId();
  const modelo = modelos.find((item) => String(item.id) === escolhido);

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <button type="button" className={botaoSecundario} disabled={modelos.length === 0} title={modelos.length ? undefined : "Nenhum modelo salvo"}>
          <LayoutTemplate className="size-4" aria-hidden />
          Usar modelo
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg text-left">
        <DialogHeader>
          <DialogTitle>Usar modelo</DialogTitle>
          <DialogDescription>
            Os itens do modelo são acrescentados aos que já estão aqui, com o valor atual do catálogo. Nada é apagado.
          </DialogDescription>
        </DialogHeader>
        <FormAcao action={action} aoConcluir={() => setAberto(false)} className="grid gap-3">
          <input type="hidden" name="orcamento_projeto_id" value={orcamentoProjetoId} />
          <input type="hidden" name="demanda_id" value={demandaId} />
          <div>
            <label htmlFor={`${id}-modelo`} className="block text-xs font-medium text-muted-foreground">
              Modelo <span className="text-danger-strong">*</span>
            </label>
            <select
              id={`${id}-modelo`}
              name="template_id"
              required
              value={escolhido}
              onChange={(evento) => setEscolhido(evento.target.value)}
              className={`${campo} h-9`}
            >
              <option value="" disabled>
                Selecione…
              </option>
              {modelos.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nome} ({item.itens} {item.itens === 1 ? "item" : "itens"})
                </option>
              ))}
            </select>
            {modelo?.descricao && <p className="mt-1 text-xs text-muted-foreground">{modelo.descricao}</p>}
          </div>
          <DialogFooter>
            <Cancelar fechar={() => setAberto(false)} />
            <Enviar rotulo="Usar modelo" pendente="Aplicando…" />
          </DialogFooter>
        </FormAcao>
      </DialogContent>
    </Dialog>
  );
}

/** Salva os itens deste orçamento como modelo (Fase E). Pessoal vai sem valor. */
export function SalvarModeloDialog({
  orcamentoProjetoId,
  demandaId,
  action,
}: {
  orcamentoProjetoId: number;
  demandaId: number;
  action: AcaoFormulario;
}) {
  const [aberto, setAberto] = useState(false);
  const id = useId();

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <button type="button" className={botaoSecundario}>
          <BookmarkPlus className="size-4" aria-hidden />
          Salvar como modelo
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg text-left">
        <DialogHeader>
          <DialogTitle>Salvar como modelo</DialogTitle>
          <DialogDescription>
            Guarda os itens e quantidades deste orçamento. Ao usar o modelo, os valores vêm do catálogo daquele dia; pessoal vai
            sem valor.
          </DialogDescription>
        </DialogHeader>
        <FormAcao action={action} aoConcluir={() => setAberto(false)} className="grid gap-3">
          <input type="hidden" name="orcamento_projeto_id" value={orcamentoProjetoId} />
          <input type="hidden" name="demanda_id" value={demandaId} />
          <div>
            <label htmlFor={`${id}-nome`} className="block text-xs font-medium text-muted-foreground">
              Nome <span className="text-danger-strong">*</span>
            </label>
            <input id={`${id}-nome`} name="nome" required maxLength={120} className={`${campo} h-9`} />
          </div>
          <div>
            <label htmlFor={`${id}-descricao`} className="block text-xs font-medium text-muted-foreground">
              Descrição
            </label>
            <textarea id={`${id}-descricao`} name="descricao" className={`${campo} min-h-14`} />
          </div>
          <DialogFooter>
            <Cancelar fechar={() => setAberto(false)} />
            <Enviar rotulo="Salvar modelo" pendente="Salvando…" />
          </DialogFooter>
        </FormAcao>
      </DialogContent>
    </Dialog>
  );
}
