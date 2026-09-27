"use client";

import { useState } from "react";
import { Pencil, Plus, Save, Trash2 } from "lucide-react";
import { ConfirmActionButton } from "@/components/common/ConfirmActionButton";
import {
  adicionarEquipamento,
  atualizarEquipamentoAnalise,
  removerEquipamento,
} from "@/lib/actions/receita";
import { formatCurrency, formatNumber } from "@/lib/formatters";

export type EquipamentoEditRowData = {
  id: number;
  nome: string;
  peso_alocacao: number | null;
  quantidade: number | null;
  custo_unitario: number | null;
  vida_util_anos: number | null;
  percentual_manutencao_anual: number | null;
  manutencao_anual_fixa: number | null;
  possui: boolean | null;
};

export type EquipamentoOption = {
  id: number;
  label: string;
};

const th = "whitespace-nowrap border border-foreground/60 bg-muted/45 px-2.5 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-foreground";
const td = "border border-foreground/60 px-2.5 py-1.5 align-middle text-xs";
const iconButtonClass = "inline-flex h-7 w-7 items-center justify-center rounded-md border border-blue-300 bg-blue-600 text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-blue-700";
const editButtonClass = "inline-flex h-7 w-7 items-center justify-center rounded-md border border-blue-300 bg-background text-blue-700 shadow-sm hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30";
const dangerIconButtonClass = "inline-flex h-7 w-7 items-center justify-center rounded-md border border-danger-strong/30 bg-background text-danger-strong hover:bg-danger-soft focus:outline-none focus:ring-2 focus:ring-danger-strong/20";
const labelClass = "text-[9px] font-medium uppercase tracking-wide text-blue-700 dark:text-blue-300";
const inputClass = "mt-0.5 h-7 w-full rounded-md border border-blue-300 bg-blue-50/70 px-2 py-0.5 text-[11px] font-medium text-blue-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-100";
const editablePanelClass = "rounded-md border border-blue-200 bg-blue-50/35 p-2 dark:border-blue-900 dark:bg-blue-950/15";

function formId(id: number) {
  return `equipamento-form-${id}`;
}

function fmt(value: number | null | undefined) {
  return value == null ? "-" : formatNumber(value);
}

function fmtInput(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

export function EquipamentosEditTable({
  codigo,
  equipamentos,
  opcoes,
  podeEditar = true,
}: {
  codigo: string;
  equipamentos: EquipamentoEditRowData[];
  opcoes: EquipamentoOption[];
  /** sem a permissão "Editar análises": só consulta */
  podeEditar?: boolean;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);

  return (
    <>
      {equipamentos.map((equipamento) => (
        <form key={equipamento.id} id={formId(equipamento.id)} action={atualizarEquipamentoAnalise} />
      ))}
      {equipamentos.length > 0 ? (
        <div className="mt-2 overflow-x-auto">
          <table className="mx-auto table-auto border-collapse border border-foreground/70">
            <thead>
              <tr>
                <th className={th}>Equipamento</th>
                <th className={th}>Peso</th>
                <th className={th}>Qtd.</th>
                <th className={th}>Custo unit.</th>
                <th className={th}>Vida útil</th>
                <th className={th}>Manutenção</th>
                <th className={th}>Disponível</th>
                {podeEditar && <th className={th}>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {equipamentos.map((equipamento) => (
                <EquipamentoRow
                  key={equipamento.id}
                  codigo={codigo}
                  equipamento={equipamento}
                  editing={editingId === equipamento.id}
                  onEdit={() => setEditingId(equipamento.id)}
                  podeEditar={podeEditar}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Nenhum equipamento com peso positivo vinculado a esta análise.</p>
      )}
      {podeEditar && <AdicionarEquipamentoForm codigo={codigo} opcoes={opcoes} />}
    </>
  );
}

function EquipamentoRow({
  codigo,
  equipamento,
  editing,
  onEdit,
  podeEditar,
}: {
  codigo: string;
  equipamento: EquipamentoEditRowData;
  editing: boolean;
  onEdit: () => void;
  podeEditar: boolean;
}) {
  const id = formId(equipamento.id);
  const manutencao =
    equipamento.manutencao_anual_fixa != null
      ? formatCurrency(equipamento.manutencao_anual_fixa)
      : equipamento.percentual_manutencao_anual != null
        ? `${fmt(equipamento.percentual_manutencao_anual)}%`
        : "-";

  return (
    <tr className="border-t border-foreground/60">
      <td className={td}>
        <input type="hidden" form={id} name="codigo_analise" value={codigo} />
        <input type="hidden" form={id} name="id" value={equipamento.id} />
        {equipamento.nome}
      </td>
      <td className={td}>
        <input
          form={id}
          name="peso_alocacao"
          type="number"
          step="0.0001"
          defaultValue={fmtInput(equipamento.peso_alocacao)}
          disabled={!editing}
          className={`h-7 w-20 rounded-sm px-1.5 text-right text-[11px] font-medium tabular-nums ${
            editing
              ? "border border-blue-300 bg-blue-50/70 text-blue-950 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-100"
              : "border border-transparent bg-transparent text-foreground disabled:opacity-100"
          }`}
        />
      </td>
      <td className={`${td} text-right tabular-nums`}>{fmt(equipamento.quantidade)}</td>
      <td className={`${td} text-right tabular-nums`}>
        {equipamento.custo_unitario != null ? formatCurrency(equipamento.custo_unitario) : "-"}
      </td>
      <td className={td}>{equipamento.vida_util_anos ? `${fmt(equipamento.vida_util_anos)} anos` : "-"}</td>
      <td className={td}>{manutencao}</td>
      <td className={td}>{equipamento.possui ? "Sim" : "Não informado"}</td>
      {podeEditar && (
      <td className={`${td} whitespace-nowrap`}>
        <div className="flex justify-center gap-1">
          {!editing ? (
            <button type="button" className={editButtonClass} onClick={onEdit} title="Editar peso" aria-label="Editar peso">
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : (
            <>
              <button form={id} className={iconButtonClass} title="Salvar peso" aria-label="Salvar peso">
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <ConfirmActionButton
                action={removerEquipamento}
                fields={{ codigo_analise: codigo, id: equipamento.id }}
                trigger={
                  <>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">Remover equipamento</span>
                  </>
                }
                titulo="Remover equipamento"
                mensagem={`Remover "${equipamento.nome}" desta análise?`}
                confirmLabel="Remover"
                triggerClassName={dangerIconButtonClass}
              />
            </>
          )}
        </div>
      </td>
      )}
    </tr>
  );
}

function AdicionarEquipamentoForm({ codigo, opcoes }: { codigo: string; opcoes: EquipamentoOption[] }) {
  return (
    <div className="mt-6 border-t border-border pt-5">
      <h3 className="text-sm font-semibold">Adicionar equipamento</h3>
      <form action={adicionarEquipamento} className={`mt-4 border-dashed ${editablePanelClass}`}>
        <input type="hidden" name="codigo_analise" value={codigo} />
        <div className="grid items-end gap-1.5 sm:grid-cols-[minmax(220px,1fr)_96px_36px]">
          <label className="block">
            <span className={labelClass}>Equipamento</span>
            <select name="equipamento_id" className={inputClass}>
              <option value="">Selecione</option>
              {opcoes.map((opcao) => (
                <option key={opcao.id} value={opcao.id}>
                  {opcao.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Peso</span>
            <input name="peso_alocacao" type="number" step="0.0001" defaultValue="1" className={inputClass} />
          </label>
          <button className={iconButtonClass} title="Adicionar equipamento" aria-label="Adicionar equipamento">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </form>
    </div>
  );
}
