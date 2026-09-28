"use client";

import { useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { Merge } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { CLASSE_BOTAO_ICONE, IconeAcao } from "@/components/common/IconeAcao";
import { FormAcao, type AcaoFormulario } from "@/components/orcamento/projeto/FormAcao";

type ItemResumo = { id: string; descricao: string; unidade: string | null };

function Unificar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-60"
    >
      {pending ? "Unificando…" : "Unificar"}
    </button>
  );
}

/**
 * Junta um item repetido a outro da mesma rubrica (0138): o item desta linha sai
 * de uso e passa a apontar para o escolhido; o histórico dos dois continua.
 */
export function UnificarItemDialog({
  item,
  opcoes,
  action,
}: {
  item: ItemResumo;
  opcoes: ItemResumo[];
  action: AcaoFormulario;
}) {
  const [aberto, setAberto] = useState(false);
  const id = useId();

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <button type="button" className={CLASSE_BOTAO_ICONE}>
          <IconeAcao icone={Merge} rotulo={`Unificar ${item.descricao} com outro item`} />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg text-left">
        <DialogHeader>
          <DialogTitle>Unificar item repetido</DialogTitle>
          <DialogDescription>
            {item.id} — {item.descricao} ({item.unidade ?? "un"}) deixa de ser usado e passa a valer pelo item escolhido.
            Orçamentos já feitos não mudam; o histórico dos dois continua.
          </DialogDescription>
        </DialogHeader>
        <FormAcao action={action} sucesso="Itens unificados." aoConcluir={() => setAberto(false)} className="grid gap-3">
          <input type="hidden" name="remover" value={item.id} />
          <div>
            <Label htmlFor={`${id}-manter`}>Item que fica</Label>
            <select
              id={`${id}-manter`}
              name="manter"
              required
              defaultValue=""
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="" disabled>
                Selecione…
              </option>
              {opcoes.map((opcao) => (
                <option key={opcao.id} value={opcao.id}>
                  {opcao.id} · {opcao.descricao} ({opcao.unidade ?? "un"})
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="rounded-md border border-input px-4 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Cancelar
            </button>
            <Unificar />
          </DialogFooter>
        </FormAcao>
      </DialogContent>
    </Dialog>
  );
}
