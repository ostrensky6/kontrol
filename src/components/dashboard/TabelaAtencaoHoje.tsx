"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { FiltroChips, type OpcaoChip } from "@/components/common/FiltroChips";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  LIMITE_ATENCAO_HOJE,
  ROTULO_GRAVIDADE,
  contarPorOrigem,
  filtrarPorOrigem,
  type FiltroOrigemAtencao,
  type GravidadeAtencao,
  type LinhaAtencaoHoje,
  type OrigemAtencao,
} from "@/lib/inicio/atencao-hoje";
import { cn } from "@/lib/utils";

const TOM_SITUACAO: Record<GravidadeAtencao, string> = {
  urgente: "border-danger-strong/30 bg-danger-soft text-danger-strong",
  atencao: "border-warning-strong/30 bg-warning-soft text-warning-strong",
  andamento: "border-info-strong/30 bg-info-soft text-info-strong",
};

const NOME_ORIGEM: Record<OrigemAtencao, string> = {
  Estoque: "Estoque",
  Validade: "Validade",
  Compras: "Compras",
  Aviso: "Avisos",
};

/**
 * Tabela "Precisa de atenção hoje" do Início: uma linha por item, do mais
 * grave para o menos grave, com as quatro origens que o Início tinha em
 * listas separadas (estoque, validade, compras e avisos). Mostra 10 linhas;
 * "Ver todos" abre o resto na própria tabela.
 */
export function TabelaAtencaoHoje({
  linhas,
  origens,
  semDado,
  listas,
}: {
  /** já na ordem da tabela (ordenarAtencaoHoje) */
  linhas: LinhaAtencaoHoje[];
  /** origens que o usuário pode abrir: só elas viram botão de filtro */
  origens: OrigemAtencao[];
  /** leituras que falharam: a tabela avisa em vez de mostrar menos linhas em silêncio */
  semDado: string[];
  /** onde fica a lista completa de cada origem */
  listas: { rotulo: string; href: string }[];
}) {
  const [filtro, setFiltro] = useState<FiltroOrigemAtencao>("todas");
  const [todas, setTodas] = useState(false);
  const contagem = useMemo(() => contarPorOrigem(linhas), [linhas]);
  const opcoes: OpcaoChip<FiltroOrigemAtencao>[] = [
    { valor: "todas", rotulo: "Todas", contagem: linhas.length, tom: "neutro" },
    ...origens.map((origem) => ({
      valor: origem,
      rotulo: NOME_ORIGEM[origem],
      contagem: contagem[origem],
      tom: linhas.some((l) => l.origem === origem && l.gravidade === "urgente") ? ("red" as const) : ("amber" as const),
    })),
  ];
  const filtradas = filtrarPorOrigem(linhas, filtro);
  const visiveis = todas ? filtradas : filtradas.slice(0, LIMITE_ATENCAO_HOJE);

  function mudarFiltro(valor: FiltroOrigemAtencao) {
    setFiltro(valor);
    setTodas(false);
  }

  return (
    <div className="space-y-3">
      {semDado.map((aviso) => (
        <p key={aviso} role="status" className="rounded-md border border-warning-strong/30 bg-warning-soft px-3 py-2 text-sm text-warning-strong">
          {aviso}
        </p>
      ))}

      {origens.length > 1 && <FiltroChips opcoes={opcoes} valor={filtro} aoMudar={mudarFiltro} rotulo="Filtrar por origem" />}

      {filtradas.length === 0 ? (
        <p className="rounded-md bg-muted/50 px-3 py-3 text-sm text-muted-foreground" data-testid="atencao-vazia">
          {filtro === "todas"
            ? semDado.length > 0
              ? "Nenhuma linha para mostrar com o que foi lido."
              : "Nada precisa de atenção agora."
            : `Nada em ${NOME_ORIGEM[filtro]} precisa de atenção agora.`}
        </p>
      ) : (
        <>
        {/* no celular a tabela não cabe: cada item vira um cartão com as mesmas cinco informações */}
        <ul aria-label="Precisa de atenção hoje" className="space-y-2 sm:hidden">
          {visiveis.map((linha) => (
            <li key={linha.chave} data-gravidade={linha.gravidade} className="rounded-md border border-border/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">{linha.origem}</span>
                <Situacao linha={linha} />
              </div>
              <p className="mt-1.5 break-words text-sm font-medium text-foreground">{linha.item}</p>
              {linha.detalhe && <p className="break-words text-xs text-muted-foreground">{linha.detalhe}</p>}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  Prazo: <span className="tabular-nums text-foreground">{linha.prazo}</span>
                </span>
                <Acao linha={linha} />
              </div>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto rounded-md border border-border/70 sm:block">
          <Table className="min-w-[600px]">
            <caption className="sr-only">Precisa de atenção hoje, do mais grave para o menos grave</caption>
            <TableHeader>
              <TableRow className="border-border/70 hover:bg-transparent">
                <TableHead scope="col" className="w-24">
                  Origem
                </TableHead>
                <TableHead scope="col" className="min-w-40">
                  Item
                </TableHead>
                <TableHead scope="col" className="w-52">
                  Situação
                </TableHead>
                <TableHead scope="col" className="w-40">
                  Prazo
                </TableHead>
                <TableHead scope="col" className="w-40 text-right">
                  Ação
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((linha) => (
                <TableRow key={linha.chave} data-gravidade={linha.gravidade} className="border-border/60">
                  <TableCell className="text-xs font-medium text-muted-foreground">{linha.origem}</TableCell>
                  <TableCell className="max-w-0">
                    <span className="block truncate font-medium text-foreground" title={linha.item}>
                      {linha.item}
                    </span>
                    {linha.detalhe && (
                      <span className="block truncate text-xs text-muted-foreground" title={linha.detalhe}>
                        {linha.detalhe}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Situacao linha={linha} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm tabular-nums text-foreground">{linha.prazo}</TableCell>
                  <TableCell className="text-right">
                    <Acao linha={linha} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {filtradas.length > LIMITE_ATENCAO_HOJE ? (
          <button
            type="button"
            aria-expanded={todas}
            onClick={() => setTodas((valor) => !valor)}
            className="min-h-8 text-sm font-medium text-primary hover:underline"
          >
            {todas ? `Mostrar só os ${LIMITE_ATENCAO_HOJE} primeiros` : `Ver todos (${filtradas.length})`}
          </button>
        ) : (
          <span data-testid="atencao-contagem">
            {filtradas.length === 1 ? "1 item" : `${filtradas.length} itens`}
          </span>
        )}
        {listas.length > 0 && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            Listas completas:
            {listas.map((lista) => (
              <Link key={lista.href} href={lista.href} className="font-medium text-primary hover:underline">
                {lista.rotulo}
              </Link>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

/** A situação, com a cor da gravidade; o leitor de tela ouve a gravidade antes. */
function Situacao({ linha }: { linha: LinhaAtencaoHoje }) {
  return (
    <span className={cn("inline-block rounded-full border px-2 py-0.5 text-xs font-medium", TOM_SITUACAO[linha.gravidade])}>
      <span className="sr-only">{ROTULO_GRAVIDADE[linha.gravidade]}: </span>
      {linha.situacao}
    </span>
  );
}

function Acao({ linha }: { linha: LinhaAtencaoHoje }) {
  return (
    <Link
      href={linha.acao.href}
      aria-label={`${linha.acao.rotulo}: ${linha.item}`}
      className="inline-flex min-h-8 items-center gap-0.5 whitespace-nowrap rounded-sm text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {linha.acao.rotulo}
      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}
