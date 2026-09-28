"use client";

import { useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil } from "lucide-react";

import { CLASSE_BOTAO_ICONE, IconeAcao } from "@/components/common/IconeAcao";

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
import { FormAcao, type AcaoFormulario } from "./FormAcao";

const RUBRICAS = [
  ["PE", "PE · Pessoal"],
  ["MC", "MC · Material de consumo"],
  ["MP", "MP · Material permanente"],
  ["ST", "ST · Serviços de terceiros"],
  ["VD", "VD · Viagens e diárias"],
  ["OU", "OU · Outros"],
] as const;

export type CustoEditavel = {
  id: number;
  rubrica: string;
  catalogo_item_id?: string | null;
  descricao: string;
  unidade: string | null;
  quantidade: number;
  custo_unitario: number;
  etapa: string | null;
  atividade: string | null;
  entrega: string | null;
};

function Salvar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-60"
    >
      {pending ? "Salvando…" : "Salvar alterações"}
    </button>
  );
}

/**
 * Edita uma linha de custo em diálogo (Radix: prende o foco, fecha com Esc). A rubrica pode ser
 * trocada (Fase C); isso solta o vínculo com o catálogo e limpa os meses do pessoal.
 */
export function EditarCustoDialog({
  item,
  orcamentoProjetoId,
  demandaId,
  action,
  podePessoal,
}: {
  item: CustoEditavel;
  orcamentoProjetoId: number;
  demandaId: number;
  action: AcaoFormulario;
  /** Sem a permissão de pessoal, PE não aparece como destino. */
  podePessoal: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [rubrica, setRubrica] = useState(item.rubrica);
  const id = useId();
  const pessoal = rubrica === "PE";
  const trocouRubrica = rubrica !== item.rubrica;

  return (
    <Dialog
      open={aberto}
      onOpenChange={(proximo) => {
        setAberto(proximo);
        if (proximo) setRubrica(item.rubrica);
      }}
    >
      <DialogTrigger asChild>
        <button type="button" className={CLASSE_BOTAO_ICONE}>
          <IconeAcao icone={Pencil} rotulo={`Editar ${item.descricao}`} />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg text-left">
        <DialogHeader>
          <DialogTitle>Editar item</DialogTitle>
          <DialogDescription>
            {pessoal
              ? "No pessoal, o total é o valor mensal vezes os meses marcados na grade."
              : "O subtotal é a quantidade vezes o custo unitário."}
          </DialogDescription>
        </DialogHeader>
        <FormAcao action={action} sucesso="Item atualizado." aoConcluir={() => setAberto(false)} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="orcamento_projeto_id" value={orcamentoProjetoId} />
          <input type="hidden" name="demanda_id" value={demandaId} />
          <input type="hidden" name="item_id" value={item.id} />
          <div className="sm:col-span-2">
            <Label htmlFor={`${id}-rubrica`}>Rubrica</Label>
            <select
              id={`${id}-rubrica`}
              name="rubrica"
              value={rubrica}
              onChange={(evento) => setRubrica(evento.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {RUBRICAS.filter(([codigo]) => podePessoal || codigo !== "PE" || item.rubrica === "PE").map(([codigo, nome]) => (
                <option key={codigo} value={codigo}>
                  {nome}
                </option>
              ))}
            </select>
            {trocouRubrica && (
              <p className="mt-1 text-xs text-warning-strong">
                Trocar a rubrica solta o vínculo com o catálogo{item.rubrica === "PE" || rubrica === "PE" ? " e limpa os meses do pessoal" : ""}: na
                conclusão, o item conta como digitado.
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor={`${id}-descricao`}>Descrição</Label>
            <Input id={`${id}-descricao`} name="descricao" required defaultValue={item.descricao} className="mt-1" />
          </div>
          <div>
            <Label htmlFor={`${id}-unidade`}>Unidade</Label>
            <Input id={`${id}-unidade`} name="unidade" defaultValue={item.unidade ?? ""} className="mt-1" />
          </div>
          <div>
            <Label htmlFor={`${id}-quantidade`}>{pessoal ? "Quantidade (sem meses marcados)" : "Quantidade"}</Label>
            <Input
              id={`${id}-quantidade`}
              name="quantidade"
              type="number"
              min="0.01"
              step="0.01"
              required
              defaultValue={item.quantidade}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor={`${id}-custo`}>{pessoal ? "Valor mensal (R$)" : "Custo unitário (R$)"}</Label>
            <Input
              id={`${id}-custo`}
              name="custo_unitario"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={item.custo_unitario}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor={`${id}-etapa`}>Etapa (opcional)</Label>
            <Input id={`${id}-etapa`} name="etapa" defaultValue={item.etapa ?? ""} className="mt-1" />
          </div>
          <div>
            <Label htmlFor={`${id}-atividade`}>Atividade (opcional)</Label>
            <Input id={`${id}-atividade`} name="atividade" defaultValue={item.atividade ?? ""} className="mt-1" />
          </div>
          <div>
            <Label htmlFor={`${id}-entrega`}>Entrega (opcional)</Label>
            <Input id={`${id}-entrega`} name="entrega" defaultValue={item.entrega ?? ""} className="mt-1" />
          </div>
          <DialogFooter className="sm:col-span-2">
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </button>
            <Salvar />
          </DialogFooter>
        </FormAcao>
      </DialogContent>
    </Dialog>
  );
}
