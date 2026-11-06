"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";

import { Combobox } from "@/components/ui/combobox";
import { adicionarItem, atualizarItem, removerItem } from "@/lib/actions/planejamento";
import type { FormState } from "@/lib/actions/cadastros";
import { formatNumber as fmt } from "@/lib/formatters";
import { enviarSemReset } from "./enviarSemReset";

export type PlanoItem = {
  id: number;
  codigo_analise: string;
  n_amostras: number | null;
  n_controles: number | null;
  repeticoes: number | null;
  perda_percentual: number | null;
};

const inp =
  "rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-brand-700 dark:text-brand-300"; // §8.2: entrada em azul
const lbl = "block text-[10px] uppercase tracking-wide text-muted-foreground/80";

function Mensagem({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={`text-xs ${state.ok ? "text-brand-700 dark:text-brand-300" : "text-danger-strong"}`}
    >
      {state.message}
    </p>
  );
}

function CamposNumericos({ prefixo, item }: { prefixo: string; item?: PlanoItem }) {
  return (
    <>
      <div>
        <label htmlFor={`${prefixo}-amostras`} className={lbl}>Amostras</label>
        <input id={`${prefixo}-amostras`} name="n_amostras" type="number" min="1" step="1" required defaultValue={item?.n_amostras ?? undefined} className={`${inp} w-24`} />
      </div>
      <div>
        <label htmlFor={`${prefixo}-controles`} className={lbl}>Controles</label>
        <input id={`${prefixo}-controles`} name="n_controles" type="number" min="0" step="1" defaultValue={item?.n_controles ?? 0} className={`${inp} w-24`} />
      </div>
      <div>
        <label htmlFor={`${prefixo}-repeticoes`} className={lbl}>Repetições</label>
        <input id={`${prefixo}-repeticoes`} name="repeticoes" type="number" min="1" step="1" defaultValue={item?.repeticoes ?? 1} className={`${inp} w-24`} />
      </div>
      <div>
        <label htmlFor={`${prefixo}-perda`} className={lbl}>% perda</label>
        <input id={`${prefixo}-perda`} name="perda_percentual" type="number" min="0" max="100" step="any" defaultValue={item?.perda_percentual ?? 0} className={`${inp} w-20`} />
      </div>
    </>
  );
}

function ItemLinha({ planId, item, editavel }: { planId: number; item: PlanoItem; editavel: boolean }) {
  const [editando, setEditando] = useState(false);
  const [salvo, salvar, salvando] = useActionState<FormState, FormData>(async (anterior, dados) => {
    const resultado = await atualizarItem(anterior, dados);
    if (resultado.ok) setEditando(false);
    return resultado;
  }, { ok: false });
  const [removido, remover, removendo] = useActionState<FormState, FormData>(async (anterior, dados) => {
    const resultado = await removerItem(anterior, dados);
    if (resultado.ok) toast.success(resultado.message ?? "Análise removida.");
    return resultado;
  }, { ok: false });

  const prefixo = `item-${item.id}`;
  return (
    <li className="rounded-lg border border-border bg-card px-4 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="font-medium">{item.codigo_analise}</span>
          <span className="text-muted-foreground">
            {" · "}{fmt(item.n_amostras)} amostras
            {(item.n_controles ?? 0) > 0 ? ` + ${fmt(item.n_controles)} controles` : ""}
            {(item.repeticoes ?? 1) !== 1 ? ` × ${fmt(item.repeticoes)} rep.` : ""}
            {(item.perda_percentual ?? 0) > 0 ? ` · ${fmt(item.perda_percentual)}% perda` : ""}
          </span>
        </span>
        {editavel && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setEditando((valor) => !valor)}
              aria-expanded={editando}
              aria-controls={`${prefixo}-form`}
              className="text-xs font-medium text-primary hover:underline"
            >
              {editando ? "Fechar" : "Editar"}
              <span className="sr-only"> {item.codigo_analise}</span>
            </button>
            <form onSubmit={enviarSemReset(remover)}>
              <input type="hidden" name="item_id" value={item.id} />
              <input type="hidden" name="planejamento_id" value={planId} />
              <button disabled={removendo} className="text-xs text-danger-strong hover:underline disabled:opacity-50">
                {removendo ? "Removendo…" : "Remover"}
                <span className="sr-only"> {item.codigo_analise}</span>
              </button>
            </form>
          </div>
        )}
      </div>
      {editavel && editando && (
        <form
          id={`${prefixo}-form`}
          onSubmit={enviarSemReset(salvar)}
          aria-label={`Editar ${item.codigo_analise}`}
          className="mt-2 flex flex-wrap items-end gap-2 border-t border-border/70 pt-2"
        >
          <input type="hidden" name="item_id" value={item.id} />
          <input type="hidden" name="planejamento_id" value={planId} />
          <CamposNumericos prefixo={prefixo} item={item} />
          <button disabled={salvando} className="app-action-compact bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {salvando ? "Salvando…" : "Salvar item"}
          </button>
        </form>
      )}
      <div className="mt-1 space-y-1">
        <Mensagem state={salvo} />
        {!removido.ok && <Mensagem state={removido} />}
      </div>
    </li>
  );
}

export function PlanoItensEditor({
  planId,
  itens,
  analises,
  editavel,
  motivoSemEdicao,
}: {
  planId: number;
  itens: PlanoItem[];
  analises: { codigo: string; nome: string | null }[];
  editavel: boolean;
  motivoSemEdicao: string | null;
}) {
  const [versaoForm, setVersaoForm] = useState(0);
  const [adicionado, adicionar, adicionando] = useActionState<FormState, FormData>(async (anterior, dados) => {
    const resultado = await adicionarItem(anterior, dados);
    if (resultado.ok) setVersaoForm((v) => v + 1);
    return resultado;
  }, { ok: false });

  return (
    <>
      {!editavel && motivoSemEdicao && (
        <p className="mt-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{motivoSemEdicao}</p>
      )}
      <ul className="mt-3 space-y-2" aria-label="Análises do plano">
        {itens.map((item) => (
          <ItemLinha key={item.id} planId={planId} item={item} editavel={editavel} />
        ))}
      </ul>
      {itens.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground/80">
          {editavel ? "Nenhuma análise. Adicione abaixo." : "Nenhuma análise."}
        </p>
      )}

      {editavel && (
        <form
          key={versaoForm}
          onSubmit={enviarSemReset(adicionar)}
          aria-label="Adicionar análise"
          className="mt-3 flex flex-wrap items-end gap-2"
        >
          <input type="hidden" name="planejamento_id" value={planId} />
          <div>
            <label htmlFor="novo-item-analise" className={lbl}>Análise</label>
            <div className="w-64">
              <Combobox
                id="novo-item-analise"
                name="codigo_analise"
                placeholder="Selecione…"
                searchPlaceholder="Buscar análise…"
                emptyText="Nenhuma análise."
                options={analises.map((a) => ({
                  value: a.codigo,
                  label: a.codigo,
                  hint: a.nome ?? undefined,
                }))}
              />
            </div>
          </div>
          <CamposNumericos prefixo="novo-item" />
          <button disabled={adicionando} className="app-action-compact bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {adicionando ? "Adicionando…" : "Adicionar"}
          </button>
        </form>
      )}
      <div className="mt-1">
        <Mensagem state={adicionado} />
      </div>
    </>
  );
}
