"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/common/DataTable";
import { Badge } from "@/components/ui/badge";
import { PAPEIS, type PapelUsuario } from "@/lib/auth/permissions";
import { UploadAssinaturaButton, UsuarioAcoes } from "./UsuarioAcoes";

export type UsuarioRow = {
  id: string;
  userId?: string;
  preAprovadoId?: number;
  nome: string;
  email: string;
  papel: string;
  papelLabel: string;
  suspenso: boolean;
  senhaProvisoria: boolean;
  temAcesso: boolean;
  assinaturaPath?: string | null;
  assinaturaUrl?: string | null;
  /** Destinos projetados no servidor para esta linha; a action revalida a transição. */
  papeisDestino?: PapelUsuario[];
};

function statusTexto(row: UsuarioRow) {
  if (!row.temAcesso) return "Pré-aprovado";
  if (row.suspenso) return "Suspenso";
  if (row.senhaProvisoria) return "Senha provisória";
  return "Ativo";
}

const columns: ColumnDef<UsuarioRow, unknown>[] = [
  {
    accessorKey: "nome",
    header: "Usuário",
    cell: ({ row }) =>
      row.original.nome === "—" ? (
        <span className="font-medium text-warning-strong">Nome não informado</span>
      ) : (
        row.original.nome
      ),
  },
  { accessorKey: "email", header: "E-mail" },
  { accessorKey: "papelLabel", header: "Função", filterFn: "equalsString" },
  {
    id: "assinatura",
    header: "Assinatura",
    cell: ({ row }) => <UploadAssinaturaButton row={row.original} />,
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => {
      const r = row.original;
      if (!r.temAcesso) return <Badge variant="secondary">Pré-aprovado</Badge>;
      if (r.suspenso) return <Badge variant="secondary">Suspenso</Badge>;
      if (r.senhaProvisoria) return <Badge variant="muted">Senha provisória</Badge>;
      return <Badge variant="outline">Ativo</Badge>;
    },
  },
  {
    id: "acoes",
    header: () => <span className="sr-only">Ações</span>,
    cell: ({ row }) => <UsuarioAcoes row={row.original} />,
  },
];

export function UsuariosTable({ rows }: { rows: UsuarioRow[] }) {
  return (
    <DataTable
      data={rows}
      columns={columns}
      searchPlaceholder="Buscar usuário ou e-mail..."
      emptyText="Nenhum usuário encontrado."
      filters={[
        {
          columnId: "papelLabel",
          label: "Função",
          options: PAPEIS.map((papel) => ({ value: papel.label, label: papel.label })),
        },
      ]}
      getMobileTitle={(row) =>
        row.nome === "—" ? <span className="text-warning-strong">Nome não informado</span> : row.nome
      }
      getMobileDescription={(row) => `${row.email} · ${row.papelLabel} · ${statusTexto(row)}`}
      getMobileMeta={(row) => <UsuarioAcoes row={row} />}
    />
  );
}
