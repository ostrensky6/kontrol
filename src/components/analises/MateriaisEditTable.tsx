"use client";

import { useState } from "react";
import { Pencil, Plus, Save, Trash2 } from "lucide-react";
import { ConfirmActionButton } from "@/components/common/ConfirmActionButton";
import { adicionarMaterial, atualizarMaterial, removerMaterial } from "@/lib/actions/receita";
import { formatCurrency } from "@/lib/formatters";

export type MaterialEditRowData = {
  id: number;
  nome_etapa: string;
  nome_atividade: string;
  especificacao_insumo: string | null;
  grupo_escolha: string | null;
  quantidade_por_amostra: number | null;
  unidade: string | null;
  modo_cobranca: string | null;
  preferencial: boolean | null;
  insumo_id: number | null;
  insumo_rotulo: string;
  custo_unitario: number | null;
};

export type InsumoOption = {
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
  return `material-form-${id}`;
}

function fmtInput(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

export function MateriaisEditTable({
  codigo,
  materiais,
  insumos,
  podeEditar = true,
}: {
  codigo: string;
  materiais: MaterialEditRowData[];
  insumos: InsumoOption[];
  /** sem a permissão "Editar análises": só consulta, sem editar, remover ou adicionar */
  podeEditar?: boolean;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);

  return (
    <>
      {materiais.map((material) => (
        <form key={material.id} id={formId(material.id)} action={atualizarMaterial} />
      ))}
      <div className="mt-2 overflow-x-auto">
        <table className="mx-auto table-auto border-collapse border border-foreground/70">
          <thead>
            <tr>
              <th className={th}>Etapa</th>
              <th className={th}>Atividade</th>
              <th className={th}>Material técnico</th>
              <th className={th}>Item de estoque</th>
              <th className={th}>Qtd/amostra</th>
              <th className={th}>Unidade</th>
              <th className={th}>Cobrança</th>
              <th className={th}>Grupo</th>
              <th className={th}>Pref.</th>
              <th className={th}>Custo unit.</th>
              {podeEditar && <th className={th}>Ações</th>}
            </tr>
          </thead>
          <tbody>
            {materiais.map((material) => (
              <MaterialRow
                key={material.id}
                codigo={codigo}
                material={material}
                insumos={insumos}
                editing={editingId === material.id}
                onEdit={() => setEditingId(material.id)}
                podeEditar={podeEditar}
              />
            ))}
          </tbody>
        </table>
      </div>
      {podeEditar && <AdicionarMaterialForm codigo={codigo} insumos={insumos} />}
    </>
  );
}

function MaterialRow({
  codigo,
  material,
  insumos,
  editing,
  onEdit,
  podeEditar,
}: {
  codigo: string;
  material: MaterialEditRowData;
  insumos: InsumoOption[];
  editing: boolean;
  onEdit: () => void;
  podeEditar: boolean;
}) {
  const id = formId(material.id);

  return (
    <tr className="border-t border-foreground/60">
      <td className={td}>{material.nome_etapa}</td>
      <td className={td}>{material.nome_atividade}</td>
      <td className={td}>
        <input type="hidden" form={id} name="codigo_analise" value={codigo} />
        <input type="hidden" form={id} name="id" value={material.id} />
        <CellInput formId={id} name="especificacao_insumo" defaultValue={material.especificacao_insumo ?? ""} editing={editing} />
      </td>
      <td className={td}>
        <CellSelect formId={id} name="insumo_id" value={material.insumo_id} label={material.insumo_rotulo} options={insumos} editing={editing} />
      </td>
      <td className={td}>
        <CellInput formId={id} name="quantidade_por_amostra" type="number" step="0.000001" defaultValue={fmtInput(material.quantidade_por_amostra)} editing={editing} numeric />
      </td>
      <td className={td}>
        <CellInput formId={id} name="unidade" defaultValue={material.unidade ?? ""} editing={editing} small />
      </td>
      <td className={td}>
        <ModoSelect formId={id} value={material.modo_cobranca ?? ""} editing={editing} />
      </td>
      <td className={td}>
        <CellInput formId={id} name="grupo_escolha" defaultValue={material.grupo_escolha ?? ""} editing={editing} small />
      </td>
      <td className={`${td} text-center`}>
        <input form={id} type="checkbox" name="preferencial" defaultChecked={Boolean(material.preferencial)} disabled={!editing} />
      </td>
      <td className={`${td} text-right tabular-nums`}>
        {material.custo_unitario != null ? formatCurrency(material.custo_unitario) : "-"}
      </td>
      {podeEditar && (
      <td className={`${td} whitespace-nowrap`}>
        <div className="flex justify-center gap-1">
          {!editing ? (
            <button type="button" className={editButtonClass} onClick={onEdit} title="Editar material" aria-label="Editar material">
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : (
            <>
              <button form={id} className={iconButtonClass} title="Salvar material" aria-label="Salvar material">
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <ConfirmActionButton
                action={removerMaterial}
                fields={{ codigo_analise: codigo, id: material.id }}
                trigger={
                  <>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">Remover material</span>
                  </>
                }
                titulo="Remover material"
                mensagem={`Remover "${material.especificacao_insumo ?? "material"}" desta análise?`}
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
  small = false,
}: {
  formId: string;
  name: string;
  defaultValue?: string | number | null;
  editing: boolean;
  type?: string;
  step?: string;
  numeric?: boolean;
  small?: boolean;
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
        numeric ? "w-24 text-right tabular-nums" : small ? "w-20" : "w-40"
      } ${
        editing
          ? "border border-blue-300 bg-blue-50/70 text-blue-950 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-100"
          : "border border-transparent bg-transparent text-foreground disabled:opacity-100"
      }`}
    />
  );
}

function CellSelect({
  formId,
  name,
  value,
  label,
  options,
  editing,
}: {
  formId: string;
  name: string;
  value: number | null;
  label: string;
  options: InsumoOption[];
  editing: boolean;
}) {
  if (!editing) return <span className="block max-w-56 truncate">{label}</span>;

  return (
    <select form={formId} name={name} defaultValue={value ?? ""} className={`${inputClass} w-56`}>
      <option value="">Sem vínculo</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function ModoSelect({ formId, value, editing }: { formId: string; value: string; editing: boolean }) {
  if (!editing) return <span>{value || "por amostra"}</span>;

  return (
    <select form={formId} name="modo_cobranca" defaultValue={value} className={`${inputClass} w-32`}>
      <option value="">por amostra</option>
      <option value="por_amostra">por amostra</option>
      <option value="por_execucao">por execução</option>
    </select>
  );
}

function AdicionarMaterialForm({ codigo, insumos }: { codigo: string; insumos: InsumoOption[] }) {
  return (
    <div className="mt-6 border-t border-border pt-5">
      <h3 className="text-sm font-semibold">Adicionar material</h3>
      <form action={adicionarMaterial} className={`mt-4 border-dashed ${editablePanelClass}`}>
        <input type="hidden" name="codigo_analise" value={codigo} />
        <div className="grid items-end gap-1.5 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[minmax(100px,0.9fr)_minmax(120px,1fr)_minmax(140px,1.25fr)_minmax(170px,1.45fr)_minmax(84px,0.7fr)_70px_minmax(90px,0.8fr)_minmax(110px,0.9fr)_36px]">
          <Field name="nome_etapa" label="Etapa" />
          <Field name="nome_atividade" label="Atividade" />
          <Field name="especificacao_insumo" label="Material técnico" />
          <label className="block">
            <span className={labelClass}>Item de estoque</span>
            <select name="insumo_id" className={inputClass}>
              <option value="">Sem vínculo</option>
              {insumos.map((insumo) => (
                <option key={insumo.id} value={insumo.id}>
                  {insumo.label}
                </option>
              ))}
            </select>
          </label>
          <Field name="quantidade_por_amostra" label="Qtd/amostra" type="number" step="0.000001" />
          <Field name="unidade" label="Unidade" />
          <Field name="grupo_escolha" label="Grupo" />
          <label className="block">
            <span className={labelClass}>Cobrança</span>
            <select name="modo_cobranca" className={inputClass}>
              <option value="">por amostra</option>
              <option value="por_amostra">por amostra</option>
              <option value="por_execucao">por execução</option>
            </select>
          </label>
          <button className={iconButtonClass} title="Adicionar material" aria-label="Adicionar material">
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
}: {
  name: string;
  label: string;
  type?: string;
  step?: string;
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input name={name} type={type} step={step} className={inputClass} />
    </label>
  );
}
