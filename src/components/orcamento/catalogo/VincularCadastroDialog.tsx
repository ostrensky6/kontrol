"use client";

import { useId, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Link2 } from "lucide-react";

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
import {
  avisoSemCusto,
  descreverVinculo,
  sugerirCadastro,
  type BaseVinculo,
  type VinculoCatalogo,
} from "@/lib/orcamento/catalogo-vinculos";

export type OpcaoCadastro = { id: number; nome: string; detalhe: string | null };

type ItemResumo = { id: string; descricao: string; unidade: string | null };

const BASES: Record<"insumo" | "tecnico", { valor: BaseVinculo; rotulo: string; nota: string }[]> = {
  insumo: [
    { valor: "embalagem", rotulo: "Por embalagem", nota: "custo total da embalagem (caixa, fardo, frasco)" },
    { valor: "unidade", rotulo: "Por unidade", nota: "custo de uma unidade de uso" },
  ],
  tecnico: [
    { valor: "mes", rotulo: "Por mês", nota: "valor mensal do técnico" },
    { valor: "hora", rotulo: "Por hora", nota: "valor mensal ÷ horas do mês" },
  ],
};

function Enviar({ texto, pendente }: { texto: string; pendente: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-60"
    >
      {pending ? pendente : texto}
    </button>
  );
}

function Desfazer() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-input px-3 py-1.5 text-sm font-medium text-danger-strong hover:bg-danger-soft disabled:opacity-60"
    >
      {pending ? "Desfazendo…" : "Desfazer vínculo"}
    </button>
  );
}

/**
 * Liga um item do catálogo ao cadastro de Insumos (MC) ou de Técnicos (PE), ou
 * desfaz (0179). Ligado, o valor do catálogo vem do cadastro e acompanha as
 * mudanças dele; orçamentos já feitos não mudam. Sugere pelo nome; quem decide é
 * a pessoa, item a item.
 */
export function VincularCadastroDialog({
  item,
  tipo,
  vinculo,
  opcoes,
  action,
}: {
  item: ItemResumo;
  tipo: "insumo" | "tecnico";
  vinculo: VinculoCatalogo | null;
  opcoes: OpcaoCadastro[];
  action: AcaoFormulario;
}) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  const cadastro = tipo === "insumo" ? "Insumos" : "Técnicos";
  const atual = vinculo ? (tipo === "insumo" ? vinculo.insumo_id : vinculo.tecnico_id) : null;
  const sugestoes = useMemo(() => sugerirCadastro(item.descricao, opcoes), [item.descricao, opcoes]);
  const idsSugeridos = new Set(sugestoes.map((opcao) => opcao.id));
  const demais = opcoes.filter((opcao) => !idsSugeridos.has(opcao.id));
  const baseInicial = vinculo?.vinculo_base ?? BASES[tipo][0].valor;
  const valorInicial = atual != null ? `${tipo}:${atual}` : sugestoes[0] ? `${tipo}:${sugestoes[0].id}` : "";
  const aviso = avisoSemCusto(vinculo);
  const rotuloOpcao = (opcao: OpcaoCadastro) => (opcao.detalhe ? `${opcao.nome} — ${opcao.detalhe}` : opcao.nome);

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <button type="button" className={`${CLASSE_BOTAO_ICONE} ${vinculo ? "text-brand-700 dark:text-brand-300" : ""}`}>
          <IconeAcao
            icone={Link2}
            rotulo={vinculo ? `Vínculo de ${item.descricao} com o cadastro de ${cadastro}` : `Ligar ${item.descricao} ao cadastro de ${cadastro}`}
          />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg text-left">
        <DialogHeader>
          <DialogTitle>Ligar ao cadastro de {cadastro}</DialogTitle>
          <DialogDescription>
            {item.id} — {item.descricao} ({item.unidade ?? "un"}). Ligado, o valor do catálogo vem do cadastro e acompanha
            as mudanças dele. Orçamentos já feitos não mudam; cadastro sem custo não substitui o valor.
          </DialogDescription>
        </DialogHeader>
        {vinculo && (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
            Hoje: {descreverVinculo(vinculo)}
            {aviso && <span className="mt-1 block text-xs text-warning-strong">{aviso}</span>}
          </p>
        )}
        <FormAcao action={action} aoConcluir={() => setAberto(false)} className="grid gap-3" aria-label={`Ligar ${item.descricao} ao cadastro`}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="acao" value="ligar" />
          <div>
            <Label htmlFor={`${id}-cadastro`}>{tipo === "insumo" ? "Insumo" : "Técnico"}</Label>
            <select
              id={`${id}-cadastro`}
              name="cadastro"
              required
              defaultValue={valorInicial}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="" disabled>
                Selecione…
              </option>
              {sugestoes.length > 0 && (
                <optgroup label="Parecidos pelo nome">
                  {sugestoes.map((opcao) => (
                    <option key={opcao.id} value={`${tipo}:${opcao.id}`}>
                      {rotuloOpcao(opcao)}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label={sugestoes.length > 0 ? `Todos os ${cadastro.toLowerCase()}` : cadastro}>
                {demais.map((opcao) => (
                  <option key={opcao.id} value={`${tipo}:${opcao.id}`}>
                    {rotuloOpcao(opcao)}
                  </option>
                ))}
              </optgroup>
            </select>
            {sugestoes.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">Nenhum nome parecido; escolha na lista ou deixe o item livre.</p>
            )}
          </div>
          <fieldset>
            <legend className="text-sm font-medium">Valor do cadastro</legend>
            <div className="mt-1 grid gap-1.5">
              {BASES[tipo].map((base) => (
                <label key={base.valor} className="flex items-start gap-2 text-sm">
                  <input type="radio" name="base" value={base.valor} defaultChecked={base.valor === baseInicial} className="mt-1" />
                  <span>
                    {base.rotulo} <span className="text-muted-foreground">({base.nota})</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="rounded-md border border-input px-4 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Cancelar
            </button>
            <Enviar texto={vinculo ? "Salvar vínculo" : "Ligar"} pendente="Ligando…" />
          </DialogFooter>
        </FormAcao>
        {vinculo && (
          <FormAcao action={action} aoConcluir={() => setAberto(false)} className="flex items-center justify-between gap-2 border-t border-border pt-3">
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="acao" value="desfazer" />
            <p className="text-xs text-muted-foreground">O item volta a ser livre com o valor de agora.</p>
            <Desfazer />
          </FormAcao>
        )}
      </DialogContent>
    </Dialog>
  );
}
