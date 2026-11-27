"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, FileText, X } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/common/DataTable";
import { FiltroChips } from "@/components/common/FiltroChips";
import { SubmitButton } from "@/components/common/SubmitButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { FormState } from "@/lib/actions/cadastros";
import {
  aprovarAnaliseAdministrativa,
  decidirAprovacaoPedido,
  decidirCoordenacaoLaboratorio,
  devolverParaCompras,
  devolverParaSolicitante,
  reprovarPedidoInterno,
  validarInformacoes,
} from "@/lib/actions/pedidos-internos";
import { formularioSemPerda } from "@/lib/formulario-sem-perda";
import { COLUNAS_QUADRO, type ChaveAprovacao, type SituacaoAprovacao } from "@/lib/pedido/quadro-aprovacoes";
import { cn } from "@/lib/utils";

export type ColunaDoQuadro = {
  situacao: SituacaoAprovacao;
  rotulo: string;
  /** nome de quem decidiu (ou o e-mail, quando não há perfil) */
  quem: string | null;
  quando: string | null;
  motivo: string | null;
  /** quem deve decidir, quando é a vez desta coordenação */
  responsavel: string | null;
};

export type DecisaoNoQuadro = {
  chave: ChaveAprovacao;
  /** o financeiro só autoriza depois de registrar fonte e rubrica no pedido */
  noPedido?: string;
  /** 0188: ordem nova (decidir_aprovacao_pedido; o financeiro escolhe a fonte ali) */
  fluxoNovo?: boolean;
};

export type LinhaQuadro = {
  id: number;
  numero: string;
  titulo: string;
  projeto: string;
  solicitante: string;
  data: string;
  dataOrdem: string;
  itens: string;
  totalItens: number;
  termoHref: string | null;
  laboratorio: string | null;
  colunas: Record<ChaveAprovacao, ColunaDoQuadro>;
  decisao: DecisaoNoQuadro | null;
  encerrado: boolean;
};

/** Cores de Antonio (27/11): verde aprovado, amarelo devolvido, vermelho reprovado. */
const COR_BOLINHA: Record<SituacaoAprovacao, string> = {
  aprovado: "bg-success-strong border-success-strong",
  // amarelo vivo nos dois temas (o token de aviso é marrom no tema claro)
  devolvido: "bg-amber-400 border-amber-500",
  reprovado: "bg-danger-strong border-danger-strong",
  aguardando: "bg-info-soft border-info-strong",
  futura: "bg-card border-border",
  nao_se_aplica: "border-transparent",
};

const TOM_TEXTO: Record<SituacaoAprovacao, string> = {
  aprovado: "text-success-strong",
  devolvido: "text-warning-strong",
  reprovado: "text-danger-strong",
  aguardando: "text-info-strong",
  futura: "text-muted-foreground",
  nao_se_aplica: "text-muted-foreground",
};

const COM_MOTIVO = new Set<SituacaoAprovacao>(["devolvido", "reprovado"]);

/** Bolinha e o texto embaixo; clicando, abre quem decidiu, quando e o motivo. */
function Bolinha({ coluna, titulo, numero }: { coluna: ColunaDoQuadro; titulo: string; numero: string }) {
  const temDetalhe = coluna.situacao !== "nao_se_aplica";
  const conteudo = (
    <span className="flex flex-col items-center gap-1">
      {coluna.situacao === "nao_se_aplica" ? (
        <span aria-hidden className="text-sm leading-4 text-muted-foreground">—</span>
      ) : (
        <span
          aria-hidden
          className={cn("flex h-4 w-4 items-center justify-center rounded-full border-2", COR_BOLINHA[coluna.situacao])}
        >
          {coluna.situacao === "aprovado" && <Check className="h-2.5 w-2.5 text-white" strokeWidth={4} />}
          {coluna.situacao === "reprovado" && <X className="h-2.5 w-2.5 text-white" strokeWidth={4} />}
          {coluna.situacao === "devolvido" && <span className="h-0.5 w-2 rounded bg-amber-950" />}
        </span>
      )}
      <span className={cn("whitespace-nowrap text-xs font-medium", TOM_TEXTO[coluna.situacao])}>{coluna.rotulo}</span>
    </span>
  );
  if (!temDetalhe) return <div className="flex justify-center">{conteudo}</div>;
  return (
    <div className="flex justify-center">
      <Popover>
        <PopoverTrigger
          className="rounded-md px-2 py-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${titulo} do pedido ${numero}: ${coluna.rotulo}. Ver detalhes`}
        >
          {conteudo}
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3 text-sm" align="center">
          <p className="font-semibold text-foreground">{titulo}</p>
          <p className={cn("mt-0.5 font-medium", TOM_TEXTO[coluna.situacao])}>{coluna.rotulo}</p>
          {coluna.quem && (
            <p className="mt-2 text-muted-foreground">
              {coluna.situacao === "devolvido" ? "Devolvido por " : coluna.situacao === "reprovado" ? "Reprovado por " : "Por "}
              <span className="text-foreground">{coluna.quem}</span>
              {coluna.quando ? ` em ${coluna.quando}` : ""}
            </p>
          )}
          {COM_MOTIVO.has(coluna.situacao) && (
            <div className={cn("mt-2 rounded-md px-2 py-1.5", coluna.situacao === "reprovado" ? "bg-danger-soft" : "bg-warning-soft")}>
              <p className={cn("text-xs font-semibold", TOM_TEXTO[coluna.situacao])}>Motivo</p>
              <p className="text-foreground">{coluna.motivo ?? "Sem motivo escrito."}</p>
            </div>
          )}
          {coluna.situacao === "devolvido" && (
            <p className="mt-2 text-xs text-muted-foreground">O solicitante corrige e reenvia; o pedido não recomeça.</p>
          )}
          {coluna.situacao === "reprovado" && <p className="mt-2 text-xs text-muted-foreground">O pedido foi encerrado.</p>}
          {coluna.situacao === "aprovado" && coluna.motivo && <p className="mt-2 text-muted-foreground">{coluna.motivo}</p>}
          {coluna.situacao === "aprovado" && !coluna.quem && (
            <p className="mt-2 text-muted-foreground">Aprovado antes do registro de quem aprova.</p>
          )}
          {coluna.situacao === "aguardando" && (
            <p className="mt-2 text-muted-foreground">
              {coluna.responsavel ? `É a vez de ${coluna.responsavel}.` : "É a vez desta coordenação."}
            </p>
          )}
          {coluna.situacao === "futura" && (
            <p className="mt-2 text-muted-foreground">O pedido ainda não chegou nesta aprovação.</p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const ACOES: Record<
  ChaveAprovacao,
  { aprovar: Action; devolver: Action; devolverPara: string; extraAprovar?: Record<string, string>; extraDevolver?: Record<string, string> }
> = {
  projeto: { aprovar: validarInformacoes, devolver: devolverParaSolicitante, devolverPara: "ao solicitante" },
  laboratorio: {
    aprovar: decidirCoordenacaoLaboratorio,
    devolver: decidirCoordenacaoLaboratorio,
    devolverPara: "ao solicitante",
    extraAprovar: { decisao: "aprovado" },
    extraDevolver: { decisao: "devolvido" },
  },
  // no fluxo de hoje o financeiro decide depois de Compras formalizar: a correção volta a Compras
  financeiro: { aprovar: aprovarAnaliseAdministrativa, devolver: devolverParaCompras, devolverPara: "a Compras" },
};

/** 0188: na ordem nova as três coordenações decidem pela mesma ação; a devolução vai a quem pediu. */
const ACAO_FLUXO_NOVO = {
  aprovar: decidirAprovacaoPedido,
  devolver: decidirAprovacaoPedido,
  devolverPara: "ao solicitante",
  extraAprovar: { decisao: "aprovado" },
  extraDevolver: { decisao: "devolvido" },
};

function useAcao(action: Action) {
  const router = useRouter();
  const [state, formAction] = useActionState<FormState, FormData>(action, { ok: false });
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  return [state, formAction] as const;
}

/** Devolver (amarelo) e Reprovar (vermelho) pedem o motivo, que o solicitante vê ao clicar na bolinha. */
function DecisaoComMotivo({
  id,
  rotulo,
  ariaLabel,
  pergunta,
  dica,
  confirmar,
  pendente,
  tom,
  action,
  estado,
  extra,
  pedidoId,
}: {
  id: string;
  rotulo: string;
  ariaLabel: string;
  pergunta: string;
  dica: string;
  confirmar: string;
  pendente: string;
  tom: "amarelo" | "vermelho";
  action: (fd: FormData) => void;
  estado: FormState;
  extra?: Record<string, string>;
  pedidoId: number;
}) {
  const [aberto, setAberto] = useState(false);
  const cores =
    tom === "amarelo"
      ? "border-amber-500/60 text-warning-strong hover:bg-warning-soft"
      : "border-danger-strong/30 text-danger-strong hover:bg-danger-soft";
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger className={cn("h-8 rounded-md border bg-card px-3 text-sm font-medium", cores)} aria-label={ariaLabel}>
        {rotulo}
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <form action={action} {...formularioSemPerda(estado)} className="space-y-2">
          <input type="hidden" name="pedido_interno_id" value={pedidoId} />
          {Object.entries(extra ?? {}).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <label htmlFor={id} className="block text-sm font-semibold text-foreground">
            {pergunta}
          </label>
          <textarea id={id} name="observacao" required rows={3} placeholder={dica} className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm" />
          <SubmitButton
            size="sm"
            pendingLabel={pendente}
            variant={tom === "vermelho" ? "destructive" : "outline"}
            className={tom === "amarelo" ? cn("h-8", cores) : "h-8"}
          >
            {confirmar}
          </SubmitButton>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Aprovar, devolver ou reprovar ali mesmo, para quem é a vez de decidir. */
function Decidir({ linha, fontes }: { linha: LinhaQuadro; fontes: string[] }) {
  const decisao = linha.decisao!;
  const acoes = decisao.fluxoNovo ? ACAO_FLUXO_NOVO : ACOES[decisao.chave];
  const pedeFonte = Boolean(decisao.fluxoNovo && decisao.chave === "financeiro");
  const [estadoAprovar, aprovar] = useAcao(acoes.aprovar);
  const [estadoDevolver, devolver] = useAcao(acoes.devolver);
  const [estadoReprovar, reprovar] = useAcao(reprovarPedidoInterno);
  const titulo = COLUNAS_QUADRO.find((c) => c.chave === decisao.chave)?.titulo ?? "Aprovação";

  if (decisao.noPedido) {
    return (
      <Link href={decisao.noPedido} className="text-sm font-medium text-primary hover:underline">
        Registrar fonte e rubrica
      </Link>
    );
  }
  const ultimo = [estadoAprovar, estadoDevolver, estadoReprovar].find((e) => e.message);
  return (
    <div className="flex min-w-40 flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <form action={aprovar} {...formularioSemPerda(estadoAprovar)}>
          <input type="hidden" name="pedido_interno_id" value={linha.id} />
          {Object.entries(acoes.extraAprovar ?? {}).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {/* 0188: o financeiro aprova escolhendo a fonte de pagamento */}
          {pedeFonte && (
            <select
              name="fonte_recurso"
              required
              defaultValue=""
              aria-label={`Fonte de pagamento do pedido ${linha.numero}`}
              className="mb-1.5 h-8 w-full rounded-md border border-input bg-card px-2 text-sm"
            >
              <option value="">Fonte de pagamento…</option>
              {fontes.map((nome) => (
                <option key={nome} value={nome}>
                  {nome}
                </option>
              ))}
            </select>
          )}
          <SubmitButton
            size="sm"
            pendingLabel="Aprovando…"
            className="h-8 bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-500"
            aria-label={`Aprovar o pedido ${linha.numero} (${titulo})`}
          >
            Aprovar
          </SubmitButton>
        </form>
        <DecisaoComMotivo
          id={`devolver-${linha.id}`}
          rotulo="Devolver"
          ariaLabel={`Devolver o pedido ${linha.numero} ${acoes.devolverPara}`}
          pergunta={`O que precisa ser corrigido no pedido ${linha.numero}?`}
          dica="O pedido volta para correção, sem recomeçar. O motivo aparece na bolinha amarela."
          confirmar="Devolver com este motivo"
          pendente="Devolvendo…"
          tom="amarelo"
          action={devolver}
          estado={estadoDevolver}
          extra={acoes.extraDevolver}
          pedidoId={linha.id}
        />
        <DecisaoComMotivo
          id={`reprovar-${linha.id}`}
          rotulo="Reprovar"
          ariaLabel={`Reprovar o pedido ${linha.numero}`}
          pergunta={`Por que o pedido ${linha.numero} foi reprovado?`}
          dica="Reprovar encerra o pedido e avisa o solicitante com este motivo."
          confirmar="Reprovar e encerrar"
          pendente="Reprovando…"
          tom="vermelho"
          action={reprovar}
          estado={estadoReprovar}
          pedidoId={linha.id}
        />
      </div>
      {ultimo && <p className={cn("max-w-56 text-xs", ultimo.ok ? "text-success-strong" : "text-danger-strong")}>{ultimo.message}</p>}
    </div>
  );
}

function colunas(temDecisao: boolean, fontes: string[]): ColumnDef<LinhaQuadro, unknown>[] {
  const cols: ColumnDef<LinhaQuadro, unknown>[] = [
    {
      id: "pedido",
      accessorFn: (l) => `${l.numero} ${l.titulo} ${l.projeto} ${l.itens}`,
      header: "Pedido",
      cell: ({ row }) => (
        <div className="min-w-44 max-w-64">
          <Link href={`/pedido/${row.original.id}`} className="font-medium text-primary hover:underline">
            <span className="tabular-nums text-muted-foreground">{row.original.numero}</span> · {row.original.titulo}
          </Link>
          <p className="text-xs text-muted-foreground">{row.original.projeto !== "—" ? row.original.projeto : "Sem projeto"}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-foreground" title={row.original.itens}>
            {row.original.itens}
          </p>
        </div>
      ),
    },
    {
      // solicitante e data juntos: sobra largura para as três aprovações
      id: "solicitante",
      accessorFn: (l) => `${l.dataOrdem} ${l.solicitante}`,
      header: "Solicitante e data",
      cell: ({ row }) => (
        <div className="min-w-32">
          <p className="text-sm">{row.original.solicitante}</p>
          <p className="text-xs tabular-nums text-muted-foreground">{row.original.data}</p>
        </div>
      ),
    },
    {
      id: "termo",
      accessorFn: (l) => (l.termoHref ? "sim" : "não"),
      header: "Termo",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.termoHref ? (
          <a
            href={row.original.termoHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-primary hover:underline"
            aria-label={`Abrir o termo de referência do pedido ${row.original.numero}`}
          >
            <FileText className="h-4 w-4" aria-hidden />
            Abrir
          </a>
        ) : (
          <span className="whitespace-nowrap text-sm text-muted-foreground">Sem termo</span>
        ),
    },
    ...COLUNAS_QUADRO.map<ColumnDef<LinhaQuadro, unknown>>((c) => ({
      id: c.chave,
      accessorFn: (l) => l.colunas[c.chave].rotulo,
      header: () => (
        <span className="block text-center">
          {c.tituloCurto}
        </span>
      ),
      meta: { align: "center" },
      enableSorting: false,
      cell: ({ row }) => (
        <div>
          <Bolinha coluna={row.original.colunas[c.chave]} titulo={c.titulo} numero={row.original.numero} />
          {c.chave === "laboratorio" && row.original.laboratorio && row.original.colunas.laboratorio.situacao !== "nao_se_aplica" && (
            <p className="text-center text-xs text-muted-foreground">{row.original.laboratorio}</p>
          )}
        </div>
      ),
    })),
  ];
  if (temDecisao) {
    cols.push({
      id: "decidir",
      header: "Sua decisão",
      enableSorting: false,
      cell: ({ row }) => (row.original.decisao ? <Decidir linha={row.original} fontes={fontes} /> : null),
    });
  }
  return cols;
}

type Filtro = "andamento" | "minha_vez" | "todos";

/**
 * Quadro de aprovações: o que foi pedido, por quem, e onde já foi aprovado.
 * Para quem coordena, a coluna "Sua decisão" aprova ou devolve ali mesmo.
 */
export function QuadroAprovacoes({ linhas, fontes = [] }: { linhas: LinhaQuadro[]; fontes?: string[] }) {
  const minhaVez = linhas.filter((l) => l.decisao).length;
  const [filtro, setFiltro] = useState<Filtro>(minhaVez > 0 ? "minha_vez" : "andamento");
  const visiveis = useMemo(
    () =>
      linhas.filter((l) =>
        filtro === "todos" ? true : filtro === "minha_vez" ? Boolean(l.decisao) : !l.encerrado,
      ),
    [linhas, filtro],
  );
  const temDecisao = visiveis.some((l) => l.decisao);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FiltroChips<Filtro>
          rotulo="Mostrar no quadro"
          valor={filtro}
          aoMudar={setFiltro}
          opcoes={[
            ...(minhaVez > 0 ? [{ valor: "minha_vez" as const, rotulo: "Esperando sua decisão", contagem: minhaVez, tom: "amber" as const }] : []),
            { valor: "andamento", rotulo: "Em andamento", contagem: linhas.filter((l) => !l.encerrado).length },
            { valor: "todos", rotulo: "Todos" },
          ]}
        />
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Legenda situacao="aprovado" texto="aprovado" />
          <Legenda situacao="devolvido" texto="devolvido para corrigir" />
          <Legenda situacao="reprovado" texto="reprovado" />
          <Legenda situacao="aguardando" texto="aguardando" />
          <Legenda situacao="futura" texto="ainda não chegou" />
          <span>Clique na bolinha para ver quem decidiu e o motivo.</span>
        </p>
      </div>
      <DataTable
        data={visiveis}
        columns={colunas(temDecisao, fontes)}
        searchPlaceholder="Buscar pedido, item, projeto ou solicitante..."
        emptyText={
          filtro === "minha_vez"
            ? "Nenhum pedido esperando a sua decisão."
            : linhas.length
              ? "Nenhum pedido em andamento."
              : "Nenhum pedido ainda. Use “Novo pedido” para começar."
        }
        getMobileTitle={(l) => (
          <Link href={`/pedido/${l.id}`} className="text-primary hover:underline">
            <span className="text-sm tabular-nums text-muted-foreground">{l.numero}</span> · {l.titulo}
          </Link>
        )}
        getMobileDescription={(l) => (
          <span className="block space-y-2">
            <span className="block text-xs">
              {l.solicitante} · {l.data}
            </span>
            <span className="block text-xs text-foreground">{l.itens}</span>
            <span className="grid grid-cols-3 gap-1">
              {COLUNAS_QUADRO.map((c) => (
                <span key={c.chave} className="flex flex-col items-center">
                  <span className="text-xs text-muted-foreground">{c.tituloCurto}</span>
                  <Bolinha coluna={l.colunas[c.chave]} titulo={c.titulo} numero={l.numero} />
                </span>
              ))}
            </span>
          </span>
        )}
        getMobileMeta={(l) => (
          <div className="flex flex-col items-end gap-1.5">
            {l.termoHref && (
              <a href={l.termoHref} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-primary hover:underline">
                Termo de referência
              </a>
            )}
            {l.decisao && <Decidir linha={l} fontes={fontes} />}
          </div>
        )}
      />
    </div>
  );
}

function Legenda({ situacao, texto }: { situacao: SituacaoAprovacao; texto: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className={cn("inline-block h-2.5 w-2.5 rounded-full border-2", COR_BOLINHA[situacao])} />
      {texto}
    </span>
  );
}
