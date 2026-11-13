"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/common/DataTable";
import { Badge } from "@/components/ui/badge";
import { PAPEIS } from "@/lib/auth/permissions";
import { UploadAssinaturaButton, UsuarioAcoes } from "./UsuarioAcoes";
import { FuncaoNaLista } from "./FuncaoNaLista";

export type UsuarioRow = {
  id: string;
  userId?: string;
  preAprovadoId?: number;
  nome: string;
  email: string;
  papel: string;
  papelLabel: string;
  suspenso: boolean;
  /** 0180: removido da equipe (login bloqueado, histórico guardado) */
  removido?: boolean;
  /** a linha é o próprio Administrador logado (não remove a si mesmo) */
  ehVoce?: boolean;
  senhaProvisoria: boolean;
  temAcesso: boolean;
  assinaturaPath?: string | null;
  assinaturaUrl?: string | null;
  /** só as exceções do usuário (0124); o restante vem da categoria */
  permissoes: unknown;
  /** marcação efetiva de cada categoria, para o diálogo mostrar o que vale de fato */
  categorias?: Record<string, Record<string, boolean>>;
};

function statusTexto(row: UsuarioRow) {
  if (!row.temAcesso) return "Pré-aprovado";
  if (row.removido) return "Removido";
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
  {
    accessorKey: "papelLabel",
    header: "Função",
    filterFn: "equalsString",
    cell: ({ row }) => <FuncaoNaLista row={row.original} />,
  },
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
      if (r.removido) return <Badge variant="muted">Removido</Badge>;
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
      getMobileDescription={(row) => `${row.email} · ${statusTexto(row)}`}
      getMobileMeta={(row) => (
        <div className="flex flex-col items-end gap-2">
          <FuncaoNaLista row={row} />
          <UsuarioAcoes row={row} />
        </div>
      )}
    />
  );
}
