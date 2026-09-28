"use client";

import { useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Plus } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CLASSE_BOTAO_ICONE, IconeAcao } from "@/components/common/IconeAcao";
import { FormAcao, type AcaoFormulario } from "@/components/orcamento/projeto/FormAcao";
import { VALOR_MASCARADO } from "@/lib/cadastros/mascara";

export type ItemCatalogoEditavel = {
  id: string;
  rubrica: string;
  descricao: string;
  unidade: string | null;
  categoria: string | null;
  preco_unitario: number | null;
  preco_mascarado?: boolean;
};

const RUBRICAS = [
  ["PE", "PE · Pessoal"],
  ["MC", "MC · Material de consumo"],
  ["MP", "MP · Material permanente"],
  ["ST", "ST · Serviços de terceiros"],
  ["VD", "VD · Viagens e diárias"],
  ["OU", "OU · Outros"],
] as const;

function Salvar({ novo, desabilitado }: { novo: boolean; desabilitado: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || desabilitado}
      className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Salvando…" : novo ? "Criar item" : "Salvar alterações"}
    </button>
  );
}

/**
 * Cria (sem `item`) ou edita um item do catálogo de custos de projeto (0138).
 * Valor de pessoal sem a permissão "Valores de pessoal no orçamento" aparece como
 * XXX e não é enviado (o banco mantém o valor atual).
 */
export function ItemCatalogoDialog({
  item,
  rubricaPadrao = "MC",
  podeVerPessoal,
  action,
}: {
  item?: ItemCatalogoEditavel;
  rubricaPadrao?: string;
  podeVerPessoal: boolean;
  action: AcaoFormulario;
}) {
  const [aberto, setAberto] = useState(false);
  const [rubrica, setRubrica] = useState(item?.rubrica ?? rubricaPadrao);
  const id = useId();
  const novo = !item;
  const valorOculto = rubrica === "PE" && !podeVerPessoal;
  const precoInicial = item && !item.preco_mascarado && item.preco_unitario != null ? String(item.preco_unitario) : "";

  return (
    <Dialog
      open={aberto}
      onOpenChange={(proximo) => {
        setAberto(proximo);
        if (proximo) setRubrica(item?.rubrica ?? rubricaPadrao);
      }}
    >
      <DialogTrigger asChild>
        {novo ? (
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-500"
          >
            <Plus className="size-4" aria-hidden />
            Novo item
          </button>
        ) : (
          <button type="button" className={CLASSE_BOTAO_ICONE}>
            <IconeAcao icone={Pencil} rotulo={`Editar ${item.descricao}`} />
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg text-left">
        <DialogHeader>
          <DialogTitle>{novo ? "Novo item do catálogo" : `Editar ${item.id}`}</DialogTitle>
          <DialogDescription>
            {novo
              ? "O item fica disponível para todos os orçamentos de projeto."
              : "Mudar o valor grava o histórico do item. Orçamentos já feitos continuam com o valor deles."}
          </DialogDescription>
        </DialogHeader>
        <FormAcao
          action={action}
          sucesso={novo ? "Item criado." : "Item atualizado."}
          aoConcluir={() => setAberto(false)}
          className="grid gap-3 sm:grid-cols-2"
          aria-label={novo ? "Novo item do catálogo" : `Editar ${item.descricao}`}
        >
          {item && <input type="hidden" name="id" value={item.id} />}
          <div>
            <Label htmlFor={`${id}-rubrica`}>Rubrica</Label>
            <select
              id={`${id}-rubrica`}
              name="rubrica"
              value={rubrica}
              onChange={(evento) => setRubrica(evento.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {RUBRICAS.map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor={`${id}-categoria`}>Grupo (opcional)</Label>
            <Input id={`${id}-categoria`} name="categoria" maxLength={80} defaultValue={item?.categoria ?? ""} className="mt-1" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor={`${id}-descricao`}>Descrição</Label>
            <Input id={`${id}-descricao`} name="descricao" required maxLength={200} defaultValue={item?.descricao ?? ""} className="mt-1" />
          </div>
          <div>
            <Label htmlFor={`${id}-unidade`}>Unidade</Label>
            <Input
              id={`${id}-unidade`}
              name="unidade"
              maxLength={40}
              placeholder="un, litro, mês…"
              defaultValue={item?.unidade ?? ""}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor={`${id}-preco`}>{rubrica === "PE" ? "Valor mensal (R$)" : "Valor unitário (R$)"}</Label>
            {valorOculto ? (
              <Input
                id={`${id}-preco`}
                value={VALOR_MASCARADO}
                readOnly
                disabled
                aria-describedby={`${id}-preco-nota`}
                className="mt-1"
              />
            ) : (
              <Input
                id={`${id}-preco`}
                name="preco"
                type="number"
                min="0"
                step="0.01"
                required={novo}
                defaultValue={precoInicial}
                className="mt-1"
              />
            )}
          </div>
          {valorOculto && (
            <p id={`${id}-preco-nota`} className="text-xs text-warning-strong sm:col-span-2">
              Valor de pessoal: só quem tem “Valores de pessoal no orçamento” vê, cria e altera.
            </p>
          )}
          <p className="text-xs text-muted-foreground sm:col-span-2">
            O mesmo item (rubrica, descrição e unidade) não pode existir duas vezes; maiúsculas, acentos e “un/unid” contam como iguais.
          </p>
          <DialogFooter className="sm:col-span-2">
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="rounded-md border border-input px-4 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Cancelar
            </button>
            <Salvar novo={novo} desabilitado={novo && valorOculto} />
          </DialogFooter>
        </FormAcao>
      </DialogContent>
    </Dialog>
  );
}
