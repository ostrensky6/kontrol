"use client";

import * as React from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronUp, ChevronsUpDown, Rows3, Rows4, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { chaveFiltros, restaurarFiltros, serializarFiltros } from "@/lib/tabela-filtros";

export type DataTableFilter = {
  columnId: string;
  label: string;
  options: { value: string; label: string }[];
};

type DataTableMeta = {
  align?: "left" | "center" | "right";
  className?: string;
};

type DataTableProps<TData> = {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  searchPlaceholder?: string;
  emptyText?: string;
  emptyTitle?: string;
  emptyAction?: React.ReactNode;
  filters?: DataTableFilter[];
  getMobileTitle?: (row: TData) => React.ReactNode;
  getMobileDescription?: (row: TData) => React.ReactNode;
  getMobileMeta?: (row: TData) => React.ReactNode;
  /** ações exibidas no cartão do celular (a coluna de ações some abaixo de 768px) */
  getMobileActions?: (row: TData) => React.ReactNode;
  /** torna o título do cartão do celular um link */
  getMobileHref?: (row: TData) => string | null | undefined;
  pageSize?: number;
};

const DENSITY_STORAGE_KEY = "kontrol:datatable:density";

const fuzzyTextFilter: FilterFn<unknown> = (row, columnId, filterValue) =>
  String(row.getValue(columnId) ?? "")
    .toLowerCase()
    .includes(String(filterValue ?? "").toLowerCase());

const categoricalFilter: FilterFn<unknown> = (row, columnId, filterValue) => {
  if (filterValue == null || filterValue === "") return true;
  return String(row.getValue(columnId) ?? "") === String(filterValue);
};

export const numericSort = (a: { getValue: (id: string) => unknown }, b: { getValue: (id: string) => unknown }, id: string) => {
  const x = Number(a.getValue(id) ?? 0);
  const y = Number(b.getValue(id) ?? 0);
  return x === y ? 0 : x > y ? 1 : -1;
};

function normalize(value: unknown) {
  if (value == null) return "";
  if (typeof value === "object") return "";
  return String(value).toLowerCase();
}

function uniqueFilterOptions(options: DataTableFilter["options"]) {
  const seen = new Set<string>();
  return options.filter((option) => {
    const value = String(option.value ?? "");
    if (value === "" || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function DataTable<TData>({
  columns,
  data,
  searchPlaceholder = "Buscar...",
  emptyText = "Nenhum registro encontrado.",
  emptyTitle = "Nada para mostrar",
  emptyAction,
  filters = [],
  getMobileTitle,
  getMobileDescription,
  getMobileMeta,
  getMobileActions,
  getMobileHref,
  pageSize = 25,
}: DataTableProps<TData>) {
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [density, setDensity] = React.useState<"comfortable" | "compact">("comfortable");

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DENSITY_STORAGE_KEY);
      if (saved === "compact" || saved === "comfortable") {
        setDensity(saved);
      }
    } catch {
      // Preferimos o estado inicial deterministico se a preferencia local falhar.
    }
  }, []);

  function atualizarDensity(next: "comfortable" | "compact") {
    setDensity(next);
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
    } catch {
      // Preferencia visual opcional.
    }
  }

  const compact = density === "compact";

  const globalFilterFn = React.useCallback<FilterFn<TData>>(
    (row, _columnId, filterValue) => {
      const needle = String(filterValue ?? "").toLowerCase();
      if (!needle) return true;
      return row
        .getAllCells()
        .some((cell) => normalize(cell.getValue()).includes(needle));
    },
    [],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    defaultColumn: {
      filterFn: fuzzyTextFilter as FilterFn<TData>,
    },
    state: { globalFilter, sorting, columnFilters },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    globalFilterFn,
    filterFns: { categorical: categoricalFilter },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  // Busca e filtros sobrevivem ao recarregar a página (guardados na aba).
  const pathname = usePathname();
  const idsColunas = table.getAllLeafColumns().map((coluna) => coluna.id).join(",");
  const chave = chaveFiltros(pathname ?? "", idsColunas.split(","));
  const filtrosRestaurados = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (filtrosRestaurados.current === chave) return;
    try {
      const salvos = restaurarFiltros(window.sessionStorage.getItem(chave), idsColunas.split(","));
      if (salvos) {
        setGlobalFilter(salvos.busca);
        setColumnFilters(salvos.colunas);
      }
    } catch {
      // Sem sessionStorage (modo privado restrito): segue sem restaurar.
    }
    filtrosRestaurados.current = chave;
  }, [chave, idsColunas]);

  React.useEffect(() => {
    if (filtrosRestaurados.current !== chave) return;
    try {
      const texto = serializarFiltros({ busca: globalFilter, colunas: columnFilters });
      if (texto) window.sessionStorage.setItem(chave, texto);
      else window.sessionStorage.removeItem(chave);
    } catch {
      // Preferência opcional.
    }
  }, [chave, globalFilter, columnFilters]);

  const totalFiltrado = table.getFilteredRowModel().rows.length;
  const semLinhas = table.getRowModel().rows.length === 0;
  const temFiltro = globalFilter !== "" || columnFilters.length > 0;
  const { pageIndex } = table.getState().pagination;
  const pageCount = table.getPageCount();

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder.replace(/[.…]+$/, "") || "Buscar"}
            className="pl-8"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore=""
            data-form-type="other"
          />
        </div>

        {filters.map((filter) => {
          const column = table.getAllLeafColumns().find((col) => col.id === filter.columnId);
          if (!column) return null;
          const value = (column.getFilterValue() as string | undefined) ?? "";
          const options = uniqueFilterOptions(filter.options);
          return (
            <Select
              key={filter.columnId}
              value={value}
              onChange={(event) => column.setFilterValue(event.target.value || undefined)}
              className="h-9 w-auto min-w-36 text-xs"
              aria-label={`Filtrar por ${filter.label}`}
            >
              <option key={`${filter.columnId}:all`} value="">
                {filter.label}: todos
              </option>
              {options.map((option) => (
                <option key={`${filter.columnId}:${String(option.value ?? "")}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          );
        })}

        <Badge variant={temFiltro ? "secondary" : "muted"} className="ml-auto" role="status" aria-live="polite">
          {temFiltro ? `${totalFiltrado} de ${data.length}` : `${data.length} registro(s)`}
        </Badge>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => atualizarDensity(compact ? "comfortable" : "compact")}
          aria-label={compact ? "Usar densidade confortavel" : "Usar densidade compacta"}
          title={compact ? "Densidade confortavel" : "Densidade compacta"}
          className="h-8 gap-1.5 px-2 text-xs"
        >
          {compact ? <Rows4 className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{compact ? "Confortavel" : "Compacta"}</span>
        </Button>
      </div>

      <div
        className={cn(
          "mt-4 hidden overflow-x-auto border border-border bg-card shadow-sm md:block",
          semLinhas ? "rounded-t-lg border-b-0" : "rounded-lg",
        )}
      >
        <Table className={cn(compact && "text-xs")}>
          <TableHeader className="bg-muted/60">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta as DataTableMeta | undefined;
                  const align = meta?.align ?? "left";
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      scope="col"
                      className={cn(
                        compact && "h-8 px-3",
                        align === "right" && "text-right",
                        align === "center" && "text-center",
                        meta?.className,
                      )}
                    >
                      {header.column.getCanSort() ? (
                        <Tooltip content={`Ordenar por ${String(header.column.columnDef.header)}`}>
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className={cn(
                              "inline-flex items-center gap-1 hover:text-foreground",
                              align === "right" && "flex-row-reverse",
                            )}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {sorted === "asc" ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : sorted === "desc" ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
                            )}
                          </button>
                        </Tooltip>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta as DataTableMeta | undefined;
                  return (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        compact && "px-3 py-1.5",
                        meta?.align === "right" && "text-right tabular-nums",
                        meta?.align === "center" && "text-center",
                        meta?.className,
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {/* Fora da área rolável: em tabelas largas a mensagem centralizada ficava cortada. */}
      {semLinhas && (
        <div className="hidden rounded-b-lg border border-t-0 border-border bg-card px-4 py-6 text-center text-muted-foreground shadow-sm md:block">
          <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Search className="h-4 w-4" aria-hidden="true" />
            </div>
            <p className="font-medium text-foreground">{emptyTitle}</p>
            <p className="text-sm">{emptyText}</p>
            {emptyAction}
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 md:hidden">
        {table.getRowModel().rows.map((row) => (
          <div
            key={row.id}
            className={cn("rounded-lg border border-border bg-card shadow-sm", compact ? "p-3 text-sm" : "p-4")}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">
                  {(() => {
                    const titulo = getMobileTitle?.(row.original) ?? row.id;
                    const href = getMobileHref?.(row.original);
                    return href ? (
                      <Link href={href} className="text-brand-700 hover:underline dark:text-brand-400">
                        {titulo}
                      </Link>
                    ) : (
                      titulo
                    );
                  })()}
                </div>
                {getMobileDescription && (
                  <div className="mt-1 text-sm text-muted-foreground">
                    {getMobileDescription(row.original)}
                  </div>
                )}
              </div>
              {getMobileMeta && <div className="shrink-0">{getMobileMeta(row.original)}</div>}
            </div>
            {getMobileActions && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                {getMobileActions(row.original)}
              </div>
            )}
          </div>
        ))}
        {table.getRowModel().rows.length === 0 && (
          <div className="rounded-lg border border-border bg-card p-5 text-center text-sm text-muted-foreground">
            <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Search className="h-4 w-4" aria-hidden="true" />
              </div>
              <p className="font-medium text-foreground">{emptyTitle}</p>
              <p>{emptyText}</p>
              {emptyAction}
            </div>
          </div>
        )}
      </div>

      {pageCount > 1 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Linhas por página</span>
            <Select
              value={String(table.getState().pagination.pageSize)}
              onChange={(event) => table.setPageSize(Number(event.target.value))}
              className="h-8 w-auto px-2 py-1.5 text-xs"
              aria-label="Linhas por página"
            >
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              <option value={100000}>Todos</option>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <span>
              Página {pageIndex + 1} de {Math.max(1, pageCount)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
