"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { atualizarInsumoLinha } from "@/lib/actions/insumos";
import { DataTable, numericSort } from "@/components/common/DataTable";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Select } from "@/components/ui/select";
import { formatCurrency as brl } from "@/lib/formatters";

export type InsumoAnaliseRow = {
  id: number;
  etapa: string;
  atividade: string;
  etapaAtividade: string;
  especificacao: string;
  semInsumo: string;
  custoUnitario: number;
  quantidade: number;
  grupoEscolha: string;
  modoCobranca: string;
  modoCobrancaLabel: string;
};

export function InsumosAnaliseTable({
  rows,
  grupoOptions,
}: {
  rows: InsumoAnaliseRow[];
  grupoOptions: ComboOption[];
}) {
  const columns: ColumnDef<InsumoAnaliseRow, unknown>[] = [
    {
      accessorKey: "etapaAtividade",
      header: "Etapa / Atividade",
      cell: ({ row }) => (
        <div className="text-xs text-muted-foreground">
          {row.original.etapa}
          <br />
          <span className="text-foreground">{row.original.atividade}</span>
        </div>
      ),
    },
    {
      accessorKey: "especificacao",
      header: "Insumo",
      cell: ({ row }) =>
        row.original.semInsumo === "sim" ? (
          <span className="text-destructive">(sem insumo)</span>
        ) : (
          row.original.especificacao
        ),
    },
    {
      accessorKey: "semInsumo",
      header: "Cadastro",
      filterFn: "equalsString",
      meta: { className: "hidden" },
    },
    {
      accessorKey: "custoUnitario",
      header: "Custo un.",
      sortingFn: numericSort,
      meta: { align: "right" },
      cell: ({ row }) => brl(row.original.custoUnitario),
    },
    {
      accessorKey: "quantidade",
      header: "Qtd/am.",
      sortingFn: numericSort,
      meta: { align: "right" },
      cell: ({ row }) => row.original.quantidade || "—",
    },
    {
      accessorKey: "grupoEscolha",
      // grupo e cobrança se editam juntos, na mesma linha
      header: "Grupo e cobrança",
      filterFn: "equalsString",
      cell: ({ row }) => (
        <form action={atualizarInsumoLinha} className="flex min-w-96 items-center gap-2">
          <input type="hidden" name="id" value={row.original.id} />
          <div className="w-44">
            <Combobox
              name="grupo_escolha"
              creatable
              defaultValue={row.original.grupoEscolha}
              placeholder="(nenhum)"
              searchPlaceholder="Buscar ou criar..."
              emptyText="Digite para criar."
              options={grupoOptions}
              className="h-8 text-xs"
            />
          </div>
          <Select
            name="modo_cobranca"
            defaultValue={row.original.modoCobranca}
            className="h-8 w-auto text-xs"
          >
            <option value="">por amostra (padrão)</option>
            <option value="por_amostra">por amostra</option>
            <option value="por_execucao">por execução</option>
          </Select>
          <Button size="sm">Salvar</Button>
        </form>
      ),
    },
    {
      accessorKey: "modoCobrancaLabel",
      header: "Cobrança",
      filterFn: "equalsString",
      // a cobrança já aparece no seletor da coluna anterior; esta fica só para o filtro
      meta: { className: "hidden" },
    },
  ];

  return (
    <DataTable
      data={rows}
      columns={columns}
      searchPlaceholder="Buscar etapa, atividade ou insumo..."
      emptyText="Nenhum insumo vinculado a esta análise."
      filters={[
        {
          columnId: "semInsumo",
          label: "Cadastro",
          options: [{ value: "sim", label: "Sem insumo cadastrado" }],
        },
        {
          columnId: "modoCobrancaLabel",
          label: "Cobrança",
          options: [
            { value: "por amostra", label: "Por amostra" },
            { value: "por execução", label: "Por execução" },
          ],
        },
        {
          columnId: "grupoEscolha",
          label: "Grupo",
          options: grupoOptions
            .filter((option) => option.value !== "")
            .map((option) => ({ value: option.value, label: option.label })),
        },
      ]}
      getMobileTitle={(row) => row.especificacao || "(sem insumo)"}
      getMobileDescription={(row) => `${row.etapa} · ${row.atividade} · ${row.modoCobrancaLabel}`}
    />
  );
}
