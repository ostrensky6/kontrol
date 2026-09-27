"use client";

import { useState } from "react";
import { Pencil, Plus, Save, Trash2 } from "lucide-react";
import { ConfirmActionButton } from "@/components/common/ConfirmActionButton";
import { adicionarEtapa, atualizarEtapa, removerEtapa } from "@/lib/actions/receita";

export type EtapaEditRowData = {
  id: number;
  ordem: number | null;
  nome_etapa: string | null;
  nome_atividade: string | null;
  execucoes_por_dia: number | null;
  amostras_por_execucao: number | null;
  tempo_maquina_h: number | null;
  tempo_bancada_h: number | null;
  tipo_limitacao: string | null;
  atividade_opcional: boolean | null;
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
  return `etapa-form-${id}`;
}

function fmtInput(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

export function EtapasEditTable({
  codigo,
  titulo,
  etapas,
  emptyText,
  showAddForm = false,
  podeEditar = true,
}: {
  codigo: string;
  titulo: string;
  etapas: EtapaEditRowData[];
  emptyText?: string;
  showAddForm?: boolean;
  /** sem a permissão "Editar análises": só consulta */
  podeEditar?: boolean;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);

  return (
    <>
      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">{titulo}</h3>
      {etapas.map((etapa) => (
        <form key={etapa.id} id={formId(etapa.id)} action={atualizarEtapa} />
      ))}
      {etapas.length > 0 ? (
        <div className="mt-2 overflow-x-auto">
          <table className="mx-auto table-auto border-collapse border border-foreground/70">
            <thead>
              <tr>
                <th className={th}>Ordem</th>
                <th className={th}>Etapa</th>
                <th className={th}>Atividade</th>
                <th className={th}>Exec/dia</th>
                <th className={th}>Amostras/exec.</th>
                <th className={th}>Máquina h</th>
                <th className={th}>Bancada h</th>
                <th className={th}>Limitação</th>
                <th className={th}>Opcional</th>
                {podeEditar && <th className={th}>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {etapas.map((etapa) => (
                <EtapaRow
                  key={etapa.id}
                  codigo={codigo}
                  etapa={etapa}
                  editing={editingId === etapa.id}
                  onEdit={() => setEditingId(etapa.id)}
                  podeEditar={podeEditar}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{emptyText ?? "Nenhuma etapa cadastrada."}</p>
      )}

      {showAddForm && podeEditar && <AdicionarEtapaForm codigo={codigo} />}
    </>
  );
}

function EtapaRow({
  codigo,
  etapa,
  editing,
  onEdit,
  podeEditar,
}: {
  codigo: string;
  etapa: EtapaEditRowData;
  editing: boolean;
  onEdit: () => void;
  podeEditar: boolean;
}) {
  const id = formId(etapa.id);

  return (
    <tr className="border-t border-foreground/60">
      <td className={`${td} text-center tabular-nums`}>{etapa.ordem ?? "-"}</td>
      <td className={td}>
        <input type="hidden" form={id} name="codigo_analise" value={codigo} />
        <input type="hidden" form={id} name="id" value={etapa.id} />
        <CellInput formId={id} name="nome_etapa" defaultValue={etapa.nome_etapa} editing={editing} />
      </td>
      <td className={td}>
        <CellInput formId={id} name="nome_atividade" defaultValue={etapa.nome_atividade} editing={editing} />
      </td>
      <td className={td}>
        <CellInput formId={id} name="execucoes_por_dia" defaultValue={fmtInput(etapa.execucoes_por_dia)} type="number" step="0.0001" editing={editing} numeric />
      </td>
      <td className={td}>
        <CellInput formId={id} name="amostras_por_execucao" defaultValue={fmtInput(etapa.amostras_por_execucao)} type="number" step="0.0001" editing={editing} numeric />
      </td>
      <td className={td}>
        <CellInput formId={id} name="tempo_maquina_h" defaultValue={fmtInput(etapa.tempo_maquina_h)} type="number" step="0.0001" editing={editing} numeric />
      </td>
      <td className={td}>
        <CellInput formId={id} name="tempo_bancada_h" defaultValue={fmtInput(etapa.tempo_bancada_h)} type="number" step="0.0001" editing={editing} numeric />
      </td>
      <td className={td}>
        <CellInput formId={id} name="tipo_limitacao" defaultValue={etapa.tipo_limitacao ?? ""} editing={editing} />
      </td>
      <td className={`${td} text-center`}>
        <input form={id} type="checkbox" name="atividade_opcional" defaultChecked={Boolean(etapa.atividade_opcional)} disabled={!editing} />
      </td>
      {podeEditar && (
      <td className={`${td} whitespace-nowrap`}>
        <div className="flex justify-center gap-1">
          {!editing ? (
            <button type="button" className={editButtonClass} onClick={onEdit} title="Editar etapa" aria-label="Editar etapa">
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : (
            <>
              <button form={id} className={iconButtonClass} title="Salvar etapa" aria-label="Salvar etapa">
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <ConfirmActionButton
                action={removerEtapa}
                fields={{ codigo_analise: codigo, id: etapa.id }}
                trigger={
                  <>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">Remover etapa</span>
                  </>
                }
                titulo="Remover etapa"
                mensagem={`Remover a etapa "${etapa.nome_etapa ?? "etapa"} / ${etapa.nome_atividade ?? "atividade"}" desta análise?`}
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

function CellInput({
  formId,
  name,
  defaultValue,
  editing,
  type = "text",
  step,
  numeric = false,
}: {
  formId: string;
  name: string;
  defaultValue?: string | number | null;
  editing: boolean;
  type?: string;
  step?: string;
  numeric?: boolean;
}) {
  return (
    <input
      form={formId}
      name={name}
      type={type}
      step={step}
      defaultValue={defaultValue ?? ""}
      disabled={!editing}
      className={`h-7 rounded-sm px-1.5 text-[11px] font-medium ${
        numeric ? "w-20 text-right tabular-nums" : "w-36"
      } ${
        editing
          ? "border border-blue-300 bg-blue-50/70 text-blue-950 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-100"
          : "border border-transparent bg-transparent text-foreground disabled:opacity-100"
      }`}
    />
  );
}

function AdicionarEtapaForm({ codigo }: { codigo: string }) {
  return (
    <div className="mt-6 border-t border-border pt-5">
      <h3 className="text-sm font-semibold">Adicionar etapa</h3>
      <form action={adicionarEtapa} className={`mt-4 border-dashed ${editablePanelClass}`}>
        <input type="hidden" name="codigo_analise" value={codigo} />
        <div className="grid items-end gap-1.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[minmax(120px,1.15fr)_minmax(140px,1.35fr)_70px_repeat(4,minmax(74px,0.7fr))_minmax(104px,0.9fr)_36px]">
          <Field name="nome_etapa" label="Nova etapa" />
          <Field name="nome_atividade" label="Atividade" />
          <Field name="ordem" label="Ordem" type="number" step="1" />
          <Field name="execucoes_por_dia" label="Exec/dia" type="number" step="0.0001" />
          <Field name="amostras_por_execucao" label="Amostras/exec." type="number" step="0.0001" />
          <Field name="tempo_maquina_h" label="Máquina h" type="number" step="0.0001" />
          <Field name="tempo_bancada_h" label="Bancada h" type="number" step="0.0001" />
          <Field name="tipo_limitacao" label="Limitação" />
          <button className={iconButtonClass} title="Adicionar etapa" aria-label="Adicionar etapa">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  name,
  label,
  type = "text",
  step,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  step?: string;
  defaultValue?: string | number | null;
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input name={name} type={type} step={step} defaultValue={defaultValue ?? ""} className={inputClass} />
    </label>
  );
}
