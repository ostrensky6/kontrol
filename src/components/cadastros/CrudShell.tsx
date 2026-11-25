"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  CHAVE_LINHAS_POR_PAGINA,
  LINHAS_POR_PAGINA_PADRAO,
  TODAS_AS_LINHAS,
  linhasGuardadas,
  mostraRodapeDePaginas,
  opcoesDeLinhas,
} from "@/lib/tabela-linhas";
import { ChevronDown, ChevronUp, ChevronsUpDown, Plus, Search } from "lucide-react";
import { contemBusca } from "@/lib/busca";
import { useRolagemLateral } from "@/components/common/useRolagemLateral";
import type { Campo, Coluna } from "@/lib/cadastros/config";
import { type PreAprovadoOpcao } from "@/lib/cadastros/pessoas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { HelpTip } from "@/components/common/HelpTip";
import { DownloadButton } from "@/components/common/DownloadButton";
import { MensagemAcao } from "@/components/common/MensagemAcao";
import { type FormState } from "@/lib/actions/cadastros";
import { cn } from "@/lib/utils";
import { type Registro, fmt } from "@/components/cadastros/crud/apoio";
import { RowActions } from "@/components/cadastros/crud/AcoesDaLinha";
import { CadastroDrawer } from "@/components/cadastros/crud/CadastroDrawer";

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
  podeMovimentarEstoque = false,
  podeCorrigirEstoque = false,
  novoComCodigo,
  abrirNovo,
  apenasEditar = false,
  podeCadastrarPessoa = false,
  preAprovados = [],
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
  /** insumos: permissão "estoque.movimentar" (+ Entrada e Dar baixa na seção Lotes) */
  podeMovimentarEstoque?: boolean;
  /** insumos: permissão "estoque.lote.gerir" (Corrigir quantidade na seção Lotes) */
  podeCorrigirEstoque?: boolean;
  /** insumos: abre "Novo insumo" com este código de barras (código lido e não reconhecido) */
  novoComCodigo?: string;
  /** abre o formulário de novo registro ao entrar (link "Cadastrar insumo" do painel) */
  abrirNovo?: boolean;
  /** linhas fixas (ex.: responsáveis do administrativo e do pagamento): só editar */
  apenasEditar?: boolean;
  /** só o Administrador cadastra usuário: os campos de usuário oferecem "Cadastrar nova pessoa" */
  podeCadastrarPessoa?: boolean;
  /** pré-aprovados sem conta (só o Administrador os vê): aparecem nos campos de usuário */
  preAprovados?: PreAprovadoOpcao[];
}) {
  const [aberto, setAberto] = useState(false);
  const [codigosNovo, setCodigosNovo] = useState<string[]>([]);
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
    setCodigosNovo([]);
    setAberto(true);
  }, []);

  useEffect(() => {
    if (!(novoComCodigo || abrirNovo) || somenteLeitura) return;
    setEditando(null);
    setCodigosNovo(novoComCodigo ? [novoComCodigo] : []);
    setAberto(true);
  }, [novoComCodigo, abrirNovo, somenteLeitura]);
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
      if (key === "ativo" && typeof value === "boolean") return value ? "Ativo" : "Inativo";
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
      return contemBusca(formatted, filterValue);
    },
    [exibir, tipoPorKey],
  );

  const columns = useMemo<ColumnDef<Registro>[]>(() => {
    const dataCols: ColumnDef<Registro>[] = colunas.map((c) => ({
      id: c.key,
      accessorFn: (row) => row[c.key],
      header: c.label,
      cell: (ctx) => {
        const value = ctx.getValue();
        if (c.key === "ativo" && typeof value === "boolean") {
          return <Badge variant={value ? "secondary" : "muted"}>{value ? "Ativo" : "Inativo"}</Badge>;
        }
        return exibir(c.key, value, c.tipo);
      },
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
          key={`${slug}-${String(ctx.row.original.id)}-${String(ctx.row.original.ativo)}-${String(ctx.row.original[rotulo] ?? "")}`}
          onEdit={() => editar(ctx.row.original)}
          onRetorno={setRetorno}
          slug={slug}
          id={ctx.row.original.id as number}
          rotulo={String(ctx.row.original[rotulo] ?? "")}
          ativo={typeof ctx.row.original.ativo === "boolean" ? ctx.row.original.ativo : undefined}
          semExcluir={apenasEditar}
        />
      ),
    });
    return dataCols;
  }, [campos, colunas, slug, rotulo, editar, exibir, somenteLeitura, apenasEditar]);

  const rolagem = useRolagemLateral<HTMLDivElement>().props;
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
      pagination: { pageSize: LINHAS_POR_PAGINA_PADRAO },
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
          const opcoes = campo.name === "ativo"
            ? [
                { value: "true", label: "Ativo" },
                { value: "false", label: "Inativo" },
              ]
            : [
                { value: "true", label: "Sim" },
                { value: "false", label: "Não" },
              ];
          return {
            fieldId: campo.name,
            columnId,
            label: campo.label,
            opcoes,
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

  // Linhas por página: a escolha da pessoa vale em todas as tabelas deste navegador.
  const setPageSize = table.setPageSize;
  useEffect(() => {
    try {
      const guardadas = linhasGuardadas(window.localStorage.getItem(CHAVE_LINHAS_POR_PAGINA));
      if (guardadas) setPageSize(guardadas);
    } catch {
      // Preferência opcional.
    }
  }, [setPageSize]);

  function mudarLinhasPorPagina(linhas: number) {
    table.setPageSize(linhas);
    try {
      // "Todos" vale só para esta visita: não vira o padrão das outras tabelas
      if (linhasGuardadas(String(linhas))) window.localStorage.setItem(CHAVE_LINHAS_POR_PAGINA, String(linhas));
    } catch {
      // Preferência opcional.
    }
  }

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
          ) : apenasEditar ? null : (
            <Button onClick={novo}>
              <Plus />
              Novo {singular}
            </Button>
          )}
        </div>
      </div>

      <MensagemAcao estado={retorno} className="mt-3" />

      {/* Tabela */}
      <div {...rolagem} className="mt-4 overflow-x-auto rounded-lg border border-border bg-card text-xs shadow-sm">
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
                      scope="col"
                      aria-sort={
                        header.column.getCanSort()
                          ? sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                          : undefined
                      }
                      className={cn(
                        "h-9 px-3 py-2 text-xs",
                        alinhaDir ? "text-right" : "text-left",
                        meta?.calculada && "text-primary",
                        meta?.largura && larguraClasse[meta.largura],
                        header.column.id === "_acoes" && "app-coluna-acoes",
                      )}
                    >
                      {header.column.getCanSort() ? (
                        <Tooltip content={`Ordenar por ${String(header.column.columnDef.header)}`}>
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className={cn(
                              "toque-texto inline-flex items-center gap-1 hover:text-foreground",
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
                      ? "app-coluna-acoes whitespace-nowrap px-3 py-2 text-right"
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
      {mostraRodapeDePaginas(totalFiltrado) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Linhas por página</span>
            <Select
              value={pageSize}
              onChange={(e) => mudarLinhasPorPagina(Number(e.target.value))}
              className="h-8 w-auto px-2 py-1.5 text-xs"
              aria-label="Linhas por página"
            >
              {opcoesDeLinhas(LINHAS_POR_PAGINA_PADRAO).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              <option value={TODAS_AS_LINHAS}>Todos</option>
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
          podeMovimentarEstoque={podeMovimentarEstoque}
          podeCorrigirEstoque={podeCorrigirEstoque}
          podeCadastrarPessoa={podeCadastrarPessoa}
          preAprovados={podeCadastrarPessoa ? preAprovados : []}
          codigosNovo={codigosNovo}
        />
      )}
    </div>
  );
}
