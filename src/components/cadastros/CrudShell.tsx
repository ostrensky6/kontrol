"use client";

import {
  Fragment,
  useActionState,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";
import { useRouter } from "next/navigation";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type SortingFn,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp, ChevronsUpDown, Lock, MoreHorizontal, Plus, Search } from "lucide-react";
import type { Campo, Coluna } from "@/lib/cadastros/config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { HelpExample, HelpTip, TextoAjuda } from "@/components/common/HelpTip";
import { DownloadButton } from "@/components/common/DownloadButton";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { SubmitButton } from "@/components/common/SubmitButton";
import { DarBaixaDialog } from "@/components/estoque/DarBaixaDialog";
import type { LoteBaixa } from "@/lib/estoque/baixa";
import {
  salvarRegistro,
  excluirRegistro,
  type FormState,
} from "@/lib/actions/cadastros";
import { corrigirQuantidadeEmbalagens } from "@/lib/actions/estoque";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "@/lib/formatters";
import { NOTA_VALOR_MASCARADO, VALOR_MASCARADO, estaMascarado } from "@/lib/cadastros/mascara";

type Registro = Record<string, unknown>;

function fmt(value: unknown, tipo?: Coluna["tipo"]) {
  if (value == null || value === "") return "—";
  // valor sigiloso já mascarado no servidor (ex.: salário sem permissão)
  if (estaMascarado(value)) return VALOR_MASCARADO;
  // texto no lugar de número (ex.: "Sem custo") aparece como veio
  if (
    typeof value === "string" &&
    (tipo === "currency" || tipo === "number" || tipo === "percent") &&
    Number.isNaN(Number(value))
  ) {
    return value;
  }
  switch (tipo) {
    case "currency":
      return formatCurrency(Number(value));
    case "percent":
      return formatPercent(Number(value));
    case "number":
      return formatNumber(Number(value));
    case "date":
      return formatDate(String(value));
    case "checkbox":
      return value ? "Sim" : "Não";
    default:
      return String(value);
  }
}

type ColMeta = {
  alinhar?: "left" | "right";
  calculada?: boolean;
  tipo?: Coluna["tipo"];
  largura?: Coluna["largura"];
};

type FiltroCategorico = {
  fieldId: string;
  columnId: string;
  label: string;
  opcoes: { value: string; label: string }[];
};

const larguraClasse: Record<NonNullable<Coluna["largura"]>, string> = {
  xs: "max-w-20",
  sm: "max-w-32",
  md: "max-w-44",
  lg: "max-w-80",
};

/** Ordena numericamente colunas de valor/percent/número (que podem vir como string do banco). */
const numericSort: SortingFn<Registro> = (a, b, id) => {
  const x = Number(a.getValue(id) ?? 0);
  const y = Number(b.getValue(id) ?? 0);
  // valores mascarados ("XXX") não têm ordem numérica: ficam juntos no fim
  if (Number.isNaN(x) || Number.isNaN(y)) {
    return Number.isNaN(x) === Number.isNaN(y) ? 0 : Number.isNaN(x) ? 1 : -1;
  }
  return x === y ? 0 : x > y ? 1 : -1;
};

/** Filtro de coluna categórica (checkbox/select): igualdade por valor. */
const categoricalFilter: FilterFn<Registro> = (row, columnId, filterValue) => {
  if (filterValue == null || filterValue === "") return true;
  const v = row.getValue(columnId);
  const s = typeof v === "boolean" ? String(v) : String(v ?? "");
  return s === String(filterValue);
};

function uniqueOptions(opcoes: { value: string; label: string }[]) {
  const seen = new Set<string>();
  return opcoes.filter((opcao) => {
    const value = String(opcao.value);
    if (value === "" || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function CrudShell({
  slug,
  singular,
  rotulo,
  colunas,
  campos,
  rows,
  initialFocusId,
  somenteLeitura = false,
  mascarar,
}: {
  slug: string;
  singular: string;
  rotulo: string;
  colunas: Coluna[];
  campos: Campo[];
  rows: Registro[];
  initialFocusId?: string;
  /** esconde criar/editar/excluir (ex.: técnicos sem permissão de remuneração) */
  somenteLeitura?: boolean;
  /** colunas exibidas como "XXX" */
  mascarar?: string[];
}) {
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<Registro | null>(null);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [focusApplied, setFocusApplied] = useState(false);
  // retorno da última ação (salvar/excluir): o drawer e o diálogo fecham no
  // sucesso, então a confirmação é anunciada aqui, numa região viva
  const [retorno, setRetorno] = useState<FormState | null>(null);

  const novo = useCallback(() => {
    setEditando(null);
    setAberto(true);
  }, []);
  const editar = useCallback((r: Registro) => {
    setEditando(r);
    setAberto(true);
  }, []);

  useEffect(() => {
    if (focusApplied || !initialFocusId || somenteLeitura) return;
    const registro = rows.find((row) => String(row.id) === initialFocusId);
    if (!registro) return;
    setGlobalFilter(initialFocusId);
    setEditando(registro);
    setAberto(true);
    setFocusApplied(true);
  }, [focusApplied, initialFocusId, rows, somenteLeitura]);

  const tipoPorKey = useMemo(
    () =>
      Object.fromEntries(colunas.map((c) => [c.key, c.tipo])) as Record<
        string,
        Coluna["tipo"]
      >,
    [colunas],
  );

  // mapa value->label dos campos select, p/ exibir e buscar pelo rótulo amigável
  const rotuloSelect = useMemo(() => {
    const m: Record<string, Map<string, string>> = {};
    for (const campo of campos) {
      if (campo.tipo === "select" && campo.opcoes) {
        m[campo.name] = new Map(campo.opcoes.map((o) => [String(o.value), o.label]));
      }
    }
    return m;
  }, [campos]);

  const exibir = useCallback(
    (key: string, value: unknown, tipo?: Coluna["tipo"]) => {
      if (mascarar?.includes(key)) return "XXX";
      const map = rotuloSelect[key];
      if (map && value != null && value !== "") return map.get(String(value)) ?? fmt(value, tipo);
      return fmt(value, tipo);
    },
    [rotuloSelect, mascarar],
  );

  // busca global: casa contra o valor EXIBIDO (rótulo de select, "Sim", "R$", "%"…)
  const globalFilterFn = useCallback<FilterFn<Registro>>(
    (row, columnId, filterValue) => {
      const formatted = exibir(columnId, row.getValue(columnId), tipoPorKey[columnId]);
      return String(formatted).toLowerCase().includes(String(filterValue).toLowerCase());
    },
    [exibir, tipoPorKey],
  );

  const columns = useMemo<ColumnDef<Registro>[]>(() => {
    const dataCols: ColumnDef<Registro>[] = colunas.map((c) => ({
      id: c.key,
      accessorFn: (row) => row[c.key],
      header: c.label,
      cell: (ctx) => exibir(c.key, ctx.getValue(), c.tipo),
      enableSorting: true,
      sortingFn:
        c.tipo === "currency" || c.tipo === "number" || c.tipo === "percent"
          ? numericSort
          : "alphanumeric",
      filterFn: categoricalFilter,
      meta: { alinhar: c.alinhar, calculada: c.calculada, tipo: c.tipo, largura: c.largura },
    }));
    for (const campo of campos) {
      if (
        (campo.tipo === "checkbox" || campo.tipo === "select") &&
        !dataCols.some((col) => col.id === campo.name)
      ) {
        dataCols.push({
          id: campo.name,
          accessorFn: (row) => row[campo.name],
          header: campo.label,
          cell: (ctx) => exibir(campo.name, ctx.getValue(), campo.tipo),
          filterFn: categoricalFilter,
          enableSorting: false,
        });
      }
    }
    if (somenteLeitura) return dataCols;
    dataCols.push({
      id: "_acoes",
      header: "Ações",
      enableSorting: false,
      enableGlobalFilter: false,
      cell: (ctx) => (
        <RowActions
          onEdit={() => editar(ctx.row.original)}
          onRetorno={setRetorno}
          slug={slug}
          id={ctx.row.original.id as number}
          rotulo={String(ctx.row.original[rotulo] ?? "")}
        />
      ),
    });
    return dataCols;
  }, [campos, colunas, slug, rotulo, editar, exibir, somenteLeitura]);

  // O React Compiler não memoiza componentes que usam useReactTable (a API
  // retorna funções não-memoizáveis); o TanStack faz a própria memoização e os
  // resultados são consumidos direto no render, então é seguro.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    state: { globalFilter, sorting, columnFilters },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    globalFilterFn,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      columnVisibility: Object.fromEntries(
        campos
          .filter((campo) => !colunas.some((coluna) => coluna.key === campo.name))
          .map((campo) => [campo.name, false]),
      ),
      pagination: { pageSize: 25 },
    },
  });

  const filtrosCategoricos = useMemo<FiltroCategorico[]>(() => {
    const chavesVisiveis = new Set(colunas.map((coluna) => coluna.key));

    return campos
      .filter((campo) => campo.tipo === "checkbox" || campo.tipo === "select")
      .map((campo) => {
        let columnId = campo.name;

        if (campo.tipo === "select" && !chavesVisiveis.has(campo.name)) {
          const nomeVisivel = campo.name.replace(/_id$/, "_nome");
          if (chavesVisiveis.has(nomeVisivel)) columnId = nomeVisivel;
        }

        if (campo.tipo === "checkbox") {
          return {
            fieldId: campo.name,
            columnId,
            label: campo.label,
            opcoes: [
              { value: "true", label: "Sim" },
              { value: "false", label: "Não" },
            ],
          };
        }

        if (columnId !== campo.name) {
          return {
            fieldId: campo.name,
            columnId,
            label: campo.label,
            opcoes: uniqueOptions(
              rows
                .map((row) => row[columnId])
                .filter((value) => value != null && value !== "" && value !== "—")
                .map((value) => ({ value: String(value), label: String(value) }))
                .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
            ),
          };
        }

        const opcoesConfiguradas = campo.opcoes?.map((opcao) => ({
          value: String(opcao.value),
          label: opcao.label,
        })) ?? [];
        const labelsPorValor = new Map(opcoesConfiguradas.map((opcao) => [opcao.value, opcao.label]));
        const opcoesDosRegistros = rows
          .map((row) => row[campo.name])
          .filter((value) => value != null && value !== "")
          .map((value) => {
            const stringValue = String(value);
            return {
              value: stringValue,
              label: labelsPorValor.get(stringValue) ?? stringValue,
            };
          });

        return {
          fieldId: campo.name,
          columnId,
          label: campo.label,
          opcoes: uniqueOptions([...opcoesConfiguradas, ...opcoesDosRegistros]).sort((a, b) =>
            a.label.localeCompare(b.label, "pt-BR"),
          ),
        };
      })
      .filter((filtro) => filtro.opcoes.length > 0);
  }, [campos, colunas, rows]);

  const totalFiltrado = table.getFilteredRowModel().rows.length;
  const temFiltro = globalFilter !== "" || columnFilters.length > 0;
  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();

  return (
    <div>
      {/* Toolbar: busca + filtros + novo */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Buscar…"
            className="w-56 pl-8"
          />
        </div>

        {filtrosCategoricos.map((filtro) => {
          const col = table.getColumn(filtro.columnId);
          const val = (col?.getFilterValue() as string) ?? "";
          return (
            <Select
              key={filtro.fieldId}
              value={val}
              onChange={(e) => col?.setFilterValue(e.target.value || undefined)}
              className="h-8 w-auto max-w-56 px-2 py-1.5 text-xs"
              aria-label={`Filtrar por ${filtro.label}`}
            >
              <option value="">{filtro.label}: todos</option>
              {filtro.opcoes.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          );
        })}

        <Badge variant={temFiltro ? "secondary" : "muted"}>
          {temFiltro
            ? `${totalFiltrado} de ${rows.length}`
            : `${rows.length} ${rows.length === 1 ? "registro" : "registros"}`}
        </Badge>

        {slug === "insumos" && (
          <HelpTip title="Coluna quantidade" side="bottom">
            <p>
              Número de <b>embalagens fechadas</b> em estoque (frascos, pacotes, kits), somando os
              lotes aceitos. Não é o volume de cada embalagem.
            </p>
            <p>Para corrigir, dar entrada em um lote ou dar baixa, abra o insumo.</p>
          </HelpTip>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <DownloadButton href={`/cadastros/${slug}/export`} fileName={`${slug}.xlsx`}>
            Planilha
          </DownloadButton>
          {somenteLeitura ? (
            <Badge variant="muted">Somente consulta</Badge>
          ) : (
            <Button onClick={novo}>
              <Plus />
              Novo {singular}
            </Button>
          )}
        </div>
      </div>

      <MensagemAcao estado={retorno} className="mt-3" />

      {/* Tabela */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card text-xs shadow-sm">
        <Table>
          <TableHeader className="bg-muted/60">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((header) => {
                  const meta = header.column.columnDef.meta as ColMeta | undefined;
                  const alinhaDir = meta?.alinhar === "right" || header.column.id === "_acoes";
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        "h-9 px-3 py-2 text-xs",
                        alinhaDir ? "text-right" : "text-left",
                        meta?.calculada && "text-primary",
                        meta?.largura && larguraClasse[meta.largura],
                      )}
                    >
                      {header.column.getCanSort() ? (
                        <Tooltip content={`Ordenar por ${String(header.column.columnDef.header)}`}>
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className={cn(
                              "inline-flex items-center gap-1 hover:text-foreground",
                              alinhaDir && "flex-row-reverse",
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
                  const meta = cell.column.columnDef.meta as ColMeta | undefined;
                  const cls =
                    cell.column.id === "_acoes"
                      ? "whitespace-nowrap px-3 py-2 text-right"
                      : cn(
                          "px-3 py-2 align-middle",
                          meta?.alinhar === "right" ? "text-right tabular-nums" : "text-left",
                          meta?.calculada && "font-medium text-primary",
                          meta?.largura && larguraClasse[meta.largura],
                        );
                  const rendered = flexRender(cell.column.columnDef.cell, cell.getContext());
                  return (
                    <TableCell key={cell.id} className={cls}>
                      <span
                        className={cn("block truncate", meta?.alinhar === "right" && "ml-auto")}
                        title={typeof rendered === "string" ? rendered : undefined}
                      >
                        {rendered}
                      </span>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={colunas.length + 1}
                  className="py-6 text-center text-muted-foreground"
                >
                  {temFiltro
                    ? "Nenhum registro encontrado para a busca/filtro."
                    : `Nenhum registro. Clique em “Novo ${singular}”.`}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Paginação (só quando passa de uma página) */}
      {pageCount > 1 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Linhas por página</span>
            <Select
              value={pageSize}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
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

      {aberto && (
        <CadastroDrawer
          open={aberto}
          slug={slug}
          singular={singular}
          campos={campos}
          registro={editando}
          onOpenChange={setAberto}
          onClose={() => setAberto(false)}
          onSalvo={setRetorno}
        />
      )}
    </div>
  );
}

function RowActions({
  onEdit,
  onRetorno,
  slug,
  id,
  rotulo,
}: {
  onEdit: () => void;
  onRetorno: (estado: FormState) => void;
  slug: string;
  id: number;
  rotulo: string;
}) {
  const [confirmar, setConfirmar] = useState(false);

  return (
    <>
      <DropdownMenu>
        <Tooltip content="Ações do registro">
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="Abrir ações do registro">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>Editar</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmar(true)}>
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteRegistroDialog
        open={confirmar}
        onOpenChange={setConfirmar}
        slug={slug}
        id={id}
        rotulo={rotulo}
        onExcluido={onRetorno}
      />
    </>
  );
}

/** Cadastros que têm "Ativo": a saída para registro já usado é desativar. */
const COM_ATIVO = new Set(["clientes", "fornecedores", "tipo_insumos", "tecnicos"]);

function DeleteRegistroDialog({
  open,
  onOpenChange,
  slug,
  id,
  rotulo,
  onExcluido,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  id: number;
  rotulo: string;
  onExcluido: (estado: FormState) => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<FormState, FormData>(
    excluirRegistro,
    { ok: false },
  );
  useEffect(() => {
    // sucesso: a linha some no refresh e este modal desmonta junto; a
    // confirmação é anunciada pela lista.
    if (!state.ok) return;
    onExcluido(state);
    router.refresh();
  }, [state, router, onExcluido]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !pending && onOpenChange(nextOpen)}>
      <DialogContent className="max-w-sm" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Excluir registro</DialogTitle>
          <DialogDescription>
            Tem certeza que deseja excluir <b>“{rotulo}”</b>? Esta ação não pode
            ser desfeita.
            {COM_ATIVO.has(slug) && " Se ele já foi usado, a exclusão é recusada: desmarque “Ativo”."}
          </DialogDescription>
        </DialogHeader>
        <MensagemAcao estado={state.ok ? null : state} className="rounded-md bg-destructive/10 px-3 py-2 text-xs empty:p-0" />
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Voltar
          </Button>
          <form action={action} {...formularioSemPerda(state)}>
            <input type="hidden" name="_slug" value={slug} />
            <input type="hidden" name="_id" value={id} />
            <SubmitButton variant="destructive" size="sm" pendingLabel="Excluindo…">
              Excluir
            </SubmitButton>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Seção de cada campo no formulário. O título vem do primeiro campo do grupo
 * na configuração e vale até o próximo; assim, esconder o primeiro campo de um
 * grupo (oculto) não apaga o título da seção.
 */
function camposComSecao(campos: Campo[], criando: boolean) {
  let grupo: string | undefined;
  const visiveis: { campo: Campo; grupo?: string }[] = [];
  for (const campo of campos) {
    if (campo.grupo) grupo = campo.grupo;
    if (campo.oculto || campo.bloco) continue;
    visiveis.push({ campo, grupo });
  }
  let anterior: string | undefined;
  return {
    formulario: visiveis.map(({ campo, grupo: secao }) => {
      const titulo = secao !== anterior ? secao : undefined;
      anterior = secao;
      return { campo, titulo };
    }),
    estoqueInicial: criando ? campos.filter((campo) => campo.bloco === "estoque_inicial" && !campo.oculto) : [],
  };
}

function TituloSecao({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-2 border-b border-border pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-2">
      {children}
    </h3>
  );
}

function CadastroDrawer({
  open,
  slug,
  singular,
  campos,
  registro,
  onOpenChange,
  onClose,
  onSalvo,
}: {
  open: boolean;
  slug: string;
  singular: string;
  campos: Campo[];
  registro: Registro | null;
  onOpenChange: (open: boolean) => void;
  onClose: () => void;
  onSalvo: (estado: FormState) => void;
}) {
  const router = useRouter();
  const [state, action] = useActionState<FormState, FormData>(
    salvarRegistro,
    { ok: false },
  );
  // Estavel enquanto o drawer ficar aberto: um reenvio (duplo clique, retry
  // de rede) usa o mesmo id e a RPC de criação devolve o resultado anterior
  // em vez de duplicar o insumo/lote.
  const [operacaoId] = useState(() => crypto.randomUUID());
  const isInsumos = slug === "insumos";
  const quantidadeModelo = isInsumos ? (registro?.quantidade_modelo as string | null | undefined) : null;
  const podeCorrigirQuantidade = isInsumos && registro?.id != null && quantidadeModelo !== "LEGADO";
  const { formulario, estoqueInicial } = camposComSecao(campos, !registro);

  useEffect(() => {
    if (!state.ok) return;
    onSalvo(state);
    router.refresh();
    onClose();
  }, [state, router, onClose, onSalvo]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            {registro ? `Editar ${singular}` : `Novo ${singular}`}
          </DrawerTitle>
          <DrawerDescription className="sr-only">
            Preencha os campos obrigatórios e salve para atualizar o cadastro.
          </DrawerDescription>
        </DrawerHeader>

        {isInsumos && registro?.id != null && (
          <LotesInsumoResumo
            insumoId={Number(registro.id)}
            especificacao={String(registro.especificacao ?? singular)}
            unidade={typeof registro.unidade === "string" ? registro.unidade : null}
            quantidadeAtual={Number(registro.quantidade ?? 0)}
            podeCorrigirQuantidade={podeCorrigirQuantidade}
            lotes={(registro.lotes_resumo as LoteBaixa[] | undefined) ?? []}
          />
        )}

        <form action={action} {...formularioSemPerda(state)} className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <input type="hidden" name="_slug" value={slug} />
          <input type="hidden" name="_operacao_id" value={operacaoId} />
          {registro?.id != null && (
            <input type="hidden" name="_id" value={String(registro.id)} />
          )}

          {formulario.map(({ campo: c, titulo }) => (
            <Fragment key={c.name}>
              {titulo && <TituloSecao>{titulo}</TituloSecao>}
              <CampoInput
                campo={c}
                valor={registro?.[c.name]}
                erro={state.errors?.[c.name]}
              />
            </Fragment>
          ))}

          {isInsumos && !registro && (
            <>
              <TituloSecao>Estoque inicial</TituloSecao>
              <div>
                <div className="flex min-h-5 items-center gap-0.5">
                  <Label htmlFor="campo-quantidade" className="block">
                    Quantidade (embalagens fechadas)
                  </Label>
                  <HelpTip title="Quantidade (embalagens fechadas)">
                    <p>
                      Conte <b>embalagens fechadas</b> (frascos, pacotes, kits), não o volume de cada
                      uma. Deixe 0 se ainda não houver.
                    </p>
                    <HelpExample>
                      3 frascos de 500 mL → informe <b>3</b> (não 1500).
                    </HelpExample>
                  </HelpTip>
                </div>
                <Input
                  id="campo-quantidade"
                  name="quantidade"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step="1"
                  defaultValue="0"
                  aria-invalid={state.errors?.quantidade ? true : undefined}
                  aria-describedby={
                    state.errors?.quantidade ? "campo-quantidade-aviso campo-quantidade-erro" : "campo-quantidade-aviso"
                  }
                  className={cn(
                    "mt-1",
                    state.errors?.quantidade && "border-destructive focus-visible:ring-destructive",
                  )}
                />
                {/* CAD-3: consequência visível, não escondida no "?" */}
                <p id="campo-quantidade-aviso" className="mt-1 text-xs text-muted-foreground">
                  Entra direto no estoque, sem quarentena.
                </p>
                {state.errors?.quantidade && (
                  <p id="campo-quantidade-erro" className="mt-1 text-xs text-destructive">
                    {state.errors.quantidade}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="campo-codigo_lote" className="block">
                  Lote do fabricante
                </Label>
                <Input
                  id="campo-codigo_lote"
                  name="codigo_lote"
                  maxLength={80}
                  placeholder="Ex.: 24B1187 (vazio: o Kontrol gera um código)"
                  autoComplete="off"
                  className="mt-1"
                />
              </div>
              {estoqueInicial.map((c) => (
                <CampoInput key={c.name} campo={c} valor={undefined} erro={state.errors?.[c.name]} />
              ))}
            </>
          )}

          <MensagemAcao
            estado={state.ok ? null : state}
            className="rounded-md bg-destructive/10 px-3 py-2 empty:p-0 sm:col-span-2"
          />

          <DrawerFooter className="sm:col-span-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
            >
              Cancelar
            </Button>
            <SubmitButton>Salvar</SubmitButton>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

const ROTULO_STATUS_LOTE: Record<string, string> = {
  quarentena: "Quarentena",
  aceito: "Aceito",
  em_uso: "Em uso",
  bloqueado: "Bloqueado",
};

/** Seção "Lotes" da edição do insumo: saldo por lote, entrada de novo lote e saída. */
function LotesInsumoResumo({
  insumoId,
  especificacao,
  unidade,
  quantidadeAtual,
  podeCorrigirQuantidade,
  lotes,
}: {
  insumoId: number;
  especificacao: string;
  unidade: string | null;
  quantidadeAtual: number;
  podeCorrigirQuantidade: boolean;
  lotes: LoteBaixa[];
}) {
  const [corrigindo, setCorrigindo] = useState(false);

  return (
    <section className="mt-4 rounded-md border border-border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-semibold">Lotes em estoque</h3>
          <HelpTip title="Lotes do insumo">
            <p>
              Cada entrada vira um lote, com número, validade e saldo próprios. O uso segue{" "}
              <b>FEFO</b>: o lote que vence primeiro sai primeiro.
            </p>
            <p>
              <b>+ Entrada</b> registra um lote novo. <b>Dar baixa</b> retira material com motivo,
              que fica no histórico do lote.
            </p>
          </HelpTip>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={`/estoque?entrada=${insumoId}`}>+ Entrada</a>
          </Button>
          <DarBaixaDialog
            lotes={lotes}
            unidade={unidade ?? ""}
            especificacao={especificacao}
            mostrarIndisponivel={false}
            triggerClassName="inline-flex h-8 items-center rounded-md border border-danger-strong/40 bg-card px-3 text-xs font-medium text-danger-strong hover:bg-danger-soft"
          />
          {podeCorrigirQuantidade && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setCorrigindo(true)}>
              Corrigir quantidade
            </Button>
          )}
        </div>
      </div>

      {lotes.length > 0 ? (
        <ul className="mt-2 divide-y divide-border rounded-md border border-border bg-card text-xs">
          {lotes.slice(0, 6).map((lote) => (
            <li key={lote.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2.5 py-1.5">
              <a
                href={`/estoque/lotes/${lote.id}`}
                className="font-medium text-brand-700 hover:underline dark:text-brand-400"
              >
                Lote {lote.codigoLote}
              </a>
              <span className="text-muted-foreground">
                validade {lote.validade ? formatDate(lote.validade) : "—"}
              </span>
              <span className="tabular-nums">
                {formatNumber(lote.quantidadeAtual)} {lote.modeloQuantidade === "EMBALAGEM_FECHADA" ? "emb." : unidade ?? ""}
              </span>
              <Badge variant="muted">{ROTULO_STATUS_LOTE[lote.status] ?? lote.status}</Badge>
            </li>
          ))}
          {lotes.length > 6 && (
            <li className="px-2.5 py-1.5 text-muted-foreground">
              +{lotes.length - 6} lote(s) — veja todos em Estoque.
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Nenhum lote com saldo. Quantidade atual: {quantidadeAtual}.
        </p>
      )}

      {podeCorrigirQuantidade && corrigindo && (
        <CorrigirQuantidadeDialog
          open={corrigindo}
          onOpenChange={setCorrigindo}
          insumoId={insumoId}
          quantidadeAtual={quantidadeAtual}
        />
      )}
    </section>
  );
}

function CorrigirQuantidadeDialog({
  open,
  onOpenChange,
  insumoId,
  quantidadeAtual,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  insumoId: number;
  quantidadeAtual: number;
}) {
  const router = useRouter();
  // o diálogo monta a cada abertura: cada correção é uma operação nova
  const [operacaoId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState<FormState, FormData>(
    corrigirQuantidadeEmbalagens,
    { ok: false },
  );

  useEffect(() => {
    if (!state.ok) return;
    router.refresh();
    onOpenChange(false);
  }, [state.ok, router, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-w-sm" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Corrigir quantidade</DialogTitle>
          <DialogDescription>
            Requer papel coordenador ou superior. A diferença fica registrada com o motivo informado
            — não sobrescreve o histórico.
          </DialogDescription>
        </DialogHeader>

        <form action={action} {...formularioSemPerda(state)} className="mt-2 grid gap-3">
          <input type="hidden" name="insumo_id" value={insumoId} />
          <input type="hidden" name="operacao_id" value={operacaoId} />
          <div>
            <Label htmlFor="corrigir-quantidade_alvo" className="block">Quantidade correta (embalagens fechadas)</Label>
            <Input
              id="corrigir-quantidade_alvo"
              name="quantidade_alvo"
              type="number"
              min={0}
              step="1"
              defaultValue={quantidadeAtual}
              className={cn(
                "mt-1",
                state.errors?.quantidade_alvo && "border-destructive focus-visible:ring-destructive",
              )}
            />
            {state.errors?.quantidade_alvo && (
              <p className="mt-1 text-xs text-destructive">{state.errors.quantidade_alvo}</p>
            )}
          </div>
          <div>
            <Label htmlFor="corrigir-motivo" className="block">Motivo</Label>
            <Input
              id="corrigir-motivo"
              name="motivo"
              required
              placeholder="Ex.: contagem física divergente do cadastro"
              className={cn(
                "mt-1",
                state.errors?.motivo && "border-destructive focus-visible:ring-destructive",
              )}
            />
            {state.errors?.motivo && (
              <p className="mt-1 text-xs text-destructive">{state.errors.motivo}</p>
            )}
          </div>

          <MensagemAcao estado={state.ok ? null : state} className="rounded-md bg-destructive/10 px-3 py-2 text-xs" />

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Voltar
            </Button>
            <SubmitButton size="sm" pendingLabel="Corrigindo…">
              Corrigir
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CampoInput({
  campo,
  valor,
  erro,
}: {
  campo: Campo;
  valor: unknown;
  erro?: string;
}) {
  const base =
    "mt-1 " +
    (erro
      ? "border-destructive focus-visible:ring-destructive"
      : "");
  const span = campo.colSpan === 2 ? "sm:col-span-2" : "sm:col-span-1";
  const valorInicial = valor == null ? campo.valorPadrao : valor;
  const v = valorInicial == null ? "" : String(valorInicial);
  const idBase = useId();
  const inputId = `campo-${campo.name}`;
  const erroId = erro ? `${inputId}-erro` : undefined;
  const avisoId = campo.aviso ? `${inputId}-aviso` : undefined;
  const descritoPor = [avisoId, erroId].filter(Boolean).join(" ") || undefined;
  // inativos só aparecem quando já são o valor atual (CAD2-4)
  const opcoes = (campo.opcoes ?? []).filter((o) => !o.inativo || String(o.value) === v);

  if (campo.somenteLeitura) {
    // Calculado no servidor: sem `name`, nada é enviado e o valor não muda.
    const notaId = `${idBase}-calc`;
    return (
      <div className={span}>
        <div className="flex min-h-5 items-center gap-0.5">
          <Label htmlFor={inputId} className="block">
            {campo.label}
          </Label>
        </div>
        <Input
          id={inputId}
          value={campo.tipo === "date" && v ? formatDate(v) : v || "—"}
          readOnly
          disabled
          aria-describedby={campo.ajuda ? notaId : undefined}
          className="mt-1"
        />
        {campo.ajuda && (
          <p id={notaId} className="mt-1 text-xs text-muted-foreground">
            <TextoAjuda texto={campo.ajuda} />
          </p>
        )}
      </div>
    );
  }

  if (campo.mascarado) {
    // Sem permissão: o servidor já trocou o valor por "XXX". O input não tem
    // `name`, então nada é enviado e o valor atual é preservado no banco.
    const mascaradoId = `${idBase}-valor`;
    const notaId = `${idBase}-nota`;
    return (
      <div className={span}>
        <Label htmlFor={mascaradoId} className="block">
          {campo.label}
        </Label>
        <Input
          id={mascaradoId}
          value={VALOR_MASCARADO}
          readOnly
          disabled
          aria-describedby={notaId}
          className="mt-1"
        />
        <p id={notaId} className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" aria-hidden="true" />
          {NOTA_VALOR_MASCARADO}
        </p>
      </div>
    );
  }

  return (
    <div className={span}>
      <div className="flex min-h-5 items-center gap-0.5">
        <Label htmlFor={inputId} className="block">
          {campo.label}
          {campo.obrigatorio && <span className="text-destructive"> *</span>}
        </Label>
        {campo.ajuda && (
          <HelpTip title={campo.label}>
            <p>
              <TextoAjuda texto={campo.ajuda} />
            </p>
            {campo.exemplo && (
              <HelpExample>
                <TextoAjuda texto={campo.exemplo} />
              </HelpExample>
            )}
          </HelpTip>
        )}
      </div>

      {campo.tipo === "textarea" ? (
        <Textarea
          id={inputId}
          aria-invalid={erro ? true : undefined}
          aria-describedby={descritoPor}
          name={campo.name}
          defaultValue={v}
          rows={3}
          placeholder={campo.placeholder}
          className={cn(
            "mt-1",
            erro && "border-destructive focus-visible:ring-destructive",
          )}
        />
      ) : campo.tipo === "select" ? (
        <Select
          id={inputId}
          aria-invalid={erro ? true : undefined}
          aria-describedby={descritoPor}
          name={campo.name}
          defaultValue={v}
          className={cn(
            "mt-1",
            erro && "border-destructive focus-visible:ring-destructive",
          )}
        >
          <option value="">—</option>
          {opcoes.map((o) => (
            <option key={o.value} value={o.value}>
              {o.inativo ? `${o.label} (inativo)` : o.label}
            </option>
          ))}
        </Select>
      ) : campo.tipo === "checkbox" ? (
        <div className="mt-2">
          <Checkbox
            id={inputId}
            name={campo.name}
            defaultChecked={valor === undefined ? Boolean(campo.padraoLigado) : Boolean(valor)}
          />
        </div>
      ) : (
        <Input
          id={inputId}
          aria-invalid={erro ? true : undefined}
          aria-describedby={descritoPor}
          name={campo.name}
          defaultValue={v}
          placeholder={campo.placeholder}
          type={
            campo.tipo === "date"
              ? "date"
              : campo.tipo === "text"
                ? "text"
                : "number"
          }
          step={
            campo.step ??
            (campo.tipo === "currency"
              ? "0.01"
              : campo.tipo === "percent"
                ? "0.1"
                : undefined)
          }
          min={campo.min}
          max={campo.max}
          className={base}
        />
      )}

      {campo.aviso && (
        <p id={avisoId} className="mt-1 text-xs text-muted-foreground">
          {campo.aviso}
        </p>
      )}
      {erro && (
        <p id={erroId} className="mt-1 text-xs text-destructive">
          {erro}
        </p>
      )}
    </div>
  );
}
